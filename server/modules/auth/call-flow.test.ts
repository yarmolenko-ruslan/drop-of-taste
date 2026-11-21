// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { createAuthService } from './service.ts'
import { createMemoryAuthStore } from './memory-store.ts'
import { CallProviderError } from './types.ts'
import { createTestCallProvider } from '../../tests/fixtures/call-provider.ts'
const phone = '+79991234567'
function setup() {
  let now = Date.now()
  const store = createMemoryAuthStore()
  const provider = createTestCallProvider()
  const start = vi.spyOn(provider, 'start')
  const status = vi.spyOn(provider, 'status')
  const auth = createAuthService({ store, provider, now: () => now })
  return {
    auth,
    store,
    start,
    status,
    advance: (ms: number) => {
      now += ms
    },
  }
}

test.each([true, false])('refunds quota only for definite rejection (%s)', async (definite) => {
  const { auth, start } = setup()
  start.mockRejectedValue(new CallProviderError(definite))
  expect((await auth.startCall(phone, '127.0.0.1')).status).toBe('unavailable')
  expect((await auth.startCall(phone, '127.0.0.1')).status).toBe(
    definite ? 'unavailable' : 'limited',
  )
  expect(start).toHaveBeenCalledTimes(definite ? 2 : 1)
})

test('30 simultaneous registrations create only one provider request', async () => {
  const { auth, start } = setup()
  const results = await Promise.all(
    Array.from({ length: 30 }, () => auth.startCall(phone, '127.0.0.1')),
  )
  expect(results.filter((r) => r.status === 'accepted')).toHaveLength(1)
  expect(results.filter((r) => r.status === 'limited')).toHaveLength(29)
  expect(start).toHaveBeenCalledTimes(1)
})

test('a late rejection cannot erase a newer attempt or refund its quota', async () => {
  const { auth, start, advance } = setup()
  let fail!: (reason: Error) => void
  start.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject
      }),
  )
  const pending = auth.startCall(phone, '127.0.0.1')
  await vi.waitFor(() => expect(fail).toBeDefined())
  advance(300_000)
  const next = await auth.startCall(phone, '127.0.0.1')
  if (next.status !== 'accepted') throw new Error('Expected started')
  fail(new CallProviderError(true))
  expect((await pending).status).toBe('unavailable')
  expect((await auth.startCall(phone, '127.0.0.1')).status).toBe('limited')
  expect((await auth.checkCall(next.attemptToken)).status).toBe('verified')
})

test('provider failure on a retry leaves the previous attempt usable', async () => {
  const { auth, start, advance } = setup()
  const first = await auth.startCall(phone, '127.0.0.1')
  if (first.status !== 'accepted') throw new Error('Expected started')
  advance(60_000)
  start.mockRejectedValueOnce(new Error('timeout'))
  expect((await auth.startCall(phone, '127.0.0.1')).status).toBe('unavailable')
  expect((await auth.checkCall(first.attemptToken)).status).toBe('verified')
})

test('completing an earlier attempt preserves a pending replacement', async () => {
  const { auth, start, advance } = setup()
  const first = await auth.startCall(phone, '127.0.0.1')
  if (first.status !== 'accepted') throw new Error('Expected started')
  advance(60_000)
  let finish!: (value: { checkId: string; callPhone: string }) => void
  start.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const pending = auth.startCall(phone, '127.0.0.1')
  await vi.waitFor(() => expect(finish).toBeDefined())
  expect((await auth.checkCall(first.attemptToken)).status).toBe('verified')
  const replacement = { checkId: randomUUID(), callPhone: '+78005008275' }
  finish(replacement)
  const second = await pending
  expect(second.status).toBe('accepted')
})

test('the five-minute deadline includes provider and database delay', async () => {
  const { auth, start, advance, status } = setup()
  start.mockImplementationOnce(async () => {
    advance(300_000)
    return { checkId: 'late', callPhone: '+78005008275' }
  })
  expect((await auth.startCall(phone, '127.0.0.1')).status).toBe('unavailable')
  expect(status).not.toHaveBeenCalled()
})

test('no registration is made after a reservation takes the entire validity window', async () => {
  const { auth, store, start, advance } = setup()
  const reserve = store.reserveCall.bind(store)
  vi.spyOn(store, 'reserveCall').mockImplementation(async (input) => {
    const result = await reserve(input)
    advance(300_000)
    return result
  })
  expect((await auth.startCall(phone, '127.0.0.1')).status).toBe('unavailable')
  expect(start).not.toHaveBeenCalled()
})

test('a provider confirmation arriving after expiry cannot authorize', async () => {
  const { auth, status, advance } = setup()
  const attempt = await auth.startCall(phone, '127.0.0.1')
  if (attempt.status !== 'accepted') throw new Error('Expected started')
  status.mockImplementationOnce(async () => {
    advance(300_000)
    return 'verified'
  })
  expect((await auth.checkCall(attempt.attemptToken)).status).toBe('expired')
})

test('failed consent lookup does not consume the attempt', async () => {
  let now = Date.now()
  const consentVersion = vi
    .fn()
    .mockRejectedValueOnce(new Error('consent unavailable'))
    .mockResolvedValue('v2')
  const auth = createAuthService({
    store: createMemoryAuthStore(),
    provider: createTestCallProvider(),
    now: () => now,
    consentVersion,
  })
  const attempt = await auth.startCall(phone, '127.0.0.1')
  if (attempt.status !== 'accepted') throw new Error('Expected started')
  await expect(auth.checkCall(attempt.attemptToken)).rejects.toThrow('consent unavailable')
  now += 3000
  expect((await auth.checkCall(attempt.attemptToken)).status).toBe('verified')
})

test('a fixed global quota applies across all phone numbers and IPs', async () => {
  const { auth, start } = setup()
  const results = await Promise.all(
    Array.from({ length: 250 }, (_, i) =>
      auth.startCall('+7999' + String(i).padStart(7, '0'), '203.0.113.' + (i + 1)),
    ),
  )
  expect(results.filter((r) => r.status === 'accepted')).toHaveLength(200)
  expect(start).toHaveBeenCalledTimes(200)
})

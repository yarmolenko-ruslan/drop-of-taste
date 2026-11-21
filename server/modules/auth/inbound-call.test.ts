// @vitest-environment node
import { createAuthService } from './service.ts'
import { createMemoryAuthStore } from './memory-store.ts'
import { createApp } from '../../app.ts'

const phone = '+79991234567'
const origin = 'http://localhost:5173'

function setup() {
  let now = Date.now()
  let sequence = 0
  const provider = {
    start: vi.fn(async () => ({ checkId: `202611-${++sequence}`, callPhone: '+78005008275' })),
    status: vi.fn(async (): Promise<'waiting' | 'verified' | 'expired'> => 'waiting'),
  }
  const store = createMemoryAuthStore()
  const auth = createAuthService({ store, provider, now: () => now })
  return {
    auth,
    provider,
    store,
    advance: (ms: number) => {
      now += ms
    },
  }
}

test('starts a call check and only exposes an opaque attempt token and dial number', async () => {
  const { auth, provider } = setup()
  const result = await auth.startCall(phone, '127.0.0.1')
  expect(result.status).toBe('accepted')
  if (result.status !== 'accepted') throw new Error('Expected accepted')
  expect(result.attemptToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(result.callPhone).toBe('+78005008275')
  expect(result.retryAfterSeconds).toBe(60)
  expect(JSON.stringify(result)).not.toContain('checkId')
  expect(provider.start).toHaveBeenCalledWith(phone, '127.0.0.1')
  expect(provider.status).not.toHaveBeenCalled()
})

test('waiting never creates a session; only provider confirmation permits sign-in', async () => {
  const { auth, provider, advance } = setup()
  const start = await auth.startCall(phone, '127.0.0.1')
  if (start.status !== 'accepted') throw new Error('Expected accepted')
  expect((await auth.checkCall(start.attemptToken)).status).toBe('waiting')
  advance(3000)
  provider.status.mockResolvedValue('verified')
  const verified = await auth.checkCall(start.attemptToken)
  expect(verified.status).toBe('verified')
  if (verified.status !== 'verified') throw new Error('Expected verified')
  expect(verified.account.phone).toBe(phone)
  expect(await auth.getAccount(verified.token)).toEqual(verified.account)
  expect((await auth.checkCall(start.attemptToken)).status).toBe('expired')
  await auth.logout(verified.token)
  expect(await auth.getAccount(verified.token)).toBeNull()
})

test('guessed tokens or a phone number cannot be used to check another browser attempt', async () => {
  const { auth, provider } = setup()
  await auth.startCall(phone, '127.0.0.1')
  for (const token of [phone, '202611-1', 'A'.repeat(43), '1234'])
    expect((await auth.checkCall(token)).status).toBe('expired')
  expect(provider.status).not.toHaveBeenCalled()
})

test('100 concurrent polls contact the provider only once per three seconds', async () => {
  const { auth, provider, advance } = setup()
  const start = await auth.startCall(phone, '127.0.0.1')
  if (start.status !== 'accepted') throw new Error('Expected accepted')
  const results = await Promise.all(
    Array.from({ length: 100 }, () => auth.checkCall(start.attemptToken)),
  )
  expect(results.every((result) => result.status === 'waiting')).toBe(true)
  expect(provider.status).toHaveBeenCalledTimes(1)
  advance(3000)
  await auth.checkCall(start.attemptToken)
  expect(provider.status).toHaveBeenCalledTimes(2)
  expect(provider.start).toHaveBeenCalledTimes(1)
})

test('expired checks and status errors never create another provider registration', async () => {
  const { auth, provider, advance } = setup()
  const start = await auth.startCall(phone, '127.0.0.1')
  if (start.status !== 'accepted') throw new Error('Expected accepted')
  provider.status.mockRejectedValueOnce(new Error('network'))
  expect((await auth.checkCall(start.attemptToken)).status).toBe('unavailable')
  advance(3000)
  provider.status.mockResolvedValue('expired')
  expect((await auth.checkCall(start.attemptToken)).status).toBe('expired')
  advance(300_000)
  expect((await auth.checkCall(start.attemptToken)).status).toBe('expired')
  expect(provider.start).toHaveBeenCalledTimes(1)
})

test('registration limits apply across successful logins and closing a browser', async () => {
  const { auth, provider, advance } = setup()
  provider.status.mockResolvedValue('verified')
  for (let i = 0; i < 5; i++) {
    const start = await auth.startCall(phone, '127.0.0.1')
    if (start.status !== 'accepted') throw new Error('Expected accepted')
    expect((await auth.checkCall(start.attemptToken)).status).toBe('verified')
    expect((await auth.startCall(phone, '127.0.0.1')).status).toBe('limited')
    advance(60_000)
  }
  expect((await auth.startCall(phone, '127.0.0.1')).status).toBe('limited')
  expect(provider.start).toHaveBeenCalledTimes(5)
})

test('a replaced attempt cannot authenticate even if its status request finishes late', async () => {
  const { auth, provider, advance } = setup()
  const first = await auth.startCall(phone, '127.0.0.1')
  if (first.status !== 'accepted') throw new Error('Expected accepted')
  let finish!: (status: 'verified') => void
  provider.status.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const pending = auth.checkCall(first.attemptToken)
  await vi.waitFor(() => expect(finish).toBeDefined())
  advance(60_000)
  const second = await auth.startCall(phone, '127.0.0.1')
  if (second.status !== 'accepted') throw new Error('Expected accepted')
  finish('verified')
  expect((await pending).status).toBe('expired')
  provider.status.mockResolvedValue('verified')
  expect((await auth.checkCall(second.attemptToken)).status).toBe('verified')
})

test('routes require consent and reject the old OTP flow and forged confirmation flags', async () => {
  const { auth, provider } = setup()
  const app = createApp(auth, { origins: [origin], secureCookies: false })
  try {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/call/start',
          headers: { origin },
          payload: { phone },
        })
      ).statusCode,
    ).toBe(400)
    const start = await app.inject({
      method: 'POST',
      url: '/api/auth/call/start',
      headers: { origin },
      payload: { phone, consent: true },
    })
    expect(start.statusCode).toBe(202)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/call/status',
          headers: { origin },
          payload: { attemptToken: start.json().attemptToken, consent: true, verified: true },
        })
      ).statusCode,
    ).toBe(400)
    expect(provider.status).not.toHaveBeenCalled()
    for (const url of ['/api/auth/request-code', '/api/auth/verify-code'])
      expect(
        (
          await app.inject({
            method: 'POST',
            url,
            headers: { origin },
            payload: { phone, code: '1234', consent: true },
          })
        ).statusCode,
      ).toBe(404)
  } finally {
    await app.close()
  }
})

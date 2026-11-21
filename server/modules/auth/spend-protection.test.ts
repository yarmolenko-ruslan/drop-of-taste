// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MongoClient } from 'mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { createApp } from '../../app.ts'
import { createMemoryAuthStore } from './memory-store.ts'
import { createMongoAuthStore, ensureAuthIndexes } from './mongo-store.ts'
import { createAuthService } from './service.ts'
import { createSmsRuCallProvider } from './sms-ru.ts'
import { DAY_MS, SEND_COOLDOWN_MS } from './limits.ts'

const phone = '+79991234567'
const origin = 'http://localhost:5173'
const provider = () =>
  createSmsRuCallProvider('synthetic-stress-key-never-a-real-credential', { allowLocalIp: true })

beforeEach(() => {
  // Never delegate to a native fetch: even an unexpected URL cannot reach the network.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('External network disabled in spend tests')
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

function simulateProvider(response: () => Response | Promise<Response>) {
  const simulated = vi.fn(async (url: string) => {
    expect(url).toBe('https://sms.ru/callcheck/add')
    return response()
  })
  vi.stubGlobal('fetch', simulated)
  return simulated
}

async function burst<T>(count: number, concurrency: number, action: (index: number) => Promise<T>) {
  const results = new Array<T>(count)
  let next = 0
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < count) {
        const index = next++
        results[index] = await action(index)
      }
    }),
  )
  return results
}

test('1500 duplicate, malformed and verification requests cause only one simulated registration', async () => {
  const simulated = simulateProvider(() =>
    Response.json({
      status: 'OK',
      status_code: 100,
      check_id: 'test-check',
      call_phone: '78005008275',
    }),
  )
  const auth = createAuthService({
    store: createMemoryAuthStore(),
    provider: provider(),
  })
  const app = createApp(auth, { origins: [origin], secureCookies: false })
  try {
    const requests = await burst(500, 50, () =>
      app.inject({
        method: 'POST',
        url: '/api/auth/call/start',
        headers: { origin },
        payload: { phone, consent: true },
      }),
    )
    expect(requests.filter((result) => result.statusCode === 202)).toHaveLength(1)
    expect(requests.filter((result) => result.statusCode === 429)).toHaveLength(499)
    await burst(500, 50, () =>
      app.inject({
        method: 'POST',
        url: '/api/auth/call/status',
        headers: { origin },
        payload: { attemptToken: 'A'.repeat(43), consent: true },
      }),
    )
    await burst(500, 50, (index) =>
      app.inject({
        method: 'POST',
        url: '/api/auth/call/start',
        headers: { origin: index % 2 ? origin : 'https://foreign.invalid' },
        payload: { phone: 'bad-number' },
      }),
    )
    expect(simulated).toHaveBeenCalledTimes(1)
  } finally {
    await app.close()
  }
})

test.each(['timeout', 'internal_error', 'bad_json'])(
  '%s cannot reset the budget or cause an automatic registration retry',
  async (failure) => {
    let now = Date.now()
    const simulated = simulateProvider(() => {
      if (failure === 'timeout') throw new DOMException('Timeout', 'TimeoutError')
      return failure === 'internal_error'
        ? Response.json({ status: 'ERROR', status_code: 500 })
        : new Response('incomplete response')
    })
    const auth = createAuthService({
      store: createMemoryAuthStore(),
      provider: provider(),
      now: () => now,
    })
    for (let i = 0; i < 5; i++) {
      const results = await burst(200, 40, () => auth.startCall(phone, '127.0.0.1'))
      expect(results.filter((result) => result.status === 'unavailable')).toHaveLength(1)
      expect(results.filter((result) => result.status === 'limited')).toHaveLength(199)
      now += SEND_COOLDOWN_MS
    }
    expect((await auth.startCall(phone, '127.0.0.1')).status).toBe('limited')
    expect(simulated).toHaveBeenCalledTimes(5)
  },
)

test('a failed reservation or confirmation never retries the provider', async () => {
  const simulated = simulateProvider(() =>
    Response.json({
      status: 'OK',
      status_code: 100,
      check_id: 'test-check',
      call_phone: '78005008275',
    }),
  )
  const store = createMemoryAuthStore()
  const auth = createAuthService({ store, provider: provider() })
  vi.spyOn(store, 'reserveCall').mockRejectedValueOnce(new Error('database unavailable'))
  await expect(auth.startCall(phone, '127.0.0.1')).rejects.toThrow('database unavailable')
  expect(simulated).not.toHaveBeenCalled()
  vi.spyOn(store, 'confirmCall').mockRejectedValueOnce(new Error('lost DB acknowledgment'))
  await expect(auth.startCall(phone, '127.0.0.1')).rejects.toThrow('lost DB acknowledgment')
  expect((await auth.startCall(phone, '127.0.0.1')).status).toBe('limited')
  expect(simulated).toHaveBeenCalledTimes(1)
})

test('MongoDB enforces phone, IP and global spend limits across independent API instances', async () => {
  const replica = await MongoMemoryReplSet.create({
    binary: { downloadDir: join(tmpdir(), 'drop-of-taste-mongodb') },
    replSet: { count: 1 },
  })
  const client = new MongoClient(replica.getUri())
  await client.connect()
  const db = client.db(`spend_${randomUUID().replaceAll('-', '')}`)
  let now = Date.now()
  const simulated = simulateProvider(() =>
    Response.json({
      status: 'OK',
      status_code: 100,
      check_id: 'test-check',
      call_phone: '78005008275',
    }),
  )
  try {
    await ensureAuthIndexes(db)
    const services = Array.from({ length: 3 }, () =>
      createAuthService({
        store: createMongoAuthStore(client, db),
        provider: provider(),
        now: () => now,
      }),
    )
    const request = (index: number, number = phone, ip = '203.0.113.10') =>
      services[index % services.length]!.startCall(number, ip)
    for (let round = 0; round < 5; round++) {
      const results = await burst(100, 16, (index) => request(index))
      expect(results.filter((result) => result.status === 'accepted')).toHaveLength(1)
      expect(results.filter((result) => result.status === 'limited')).toHaveLength(99)
      now += SEND_COOLDOWN_MS
    }
    const blocked = await burst(100, 16, (index) => request(index))
    expect(blocked.every((result) => result.status === 'limited')).toBe(true)
    expect(simulated).toHaveBeenCalledTimes(5)

    // The first phone has consumed five of this IP's 20 hourly requests.
    const ipResults = await burst(100, 8, (index) =>
      request(index, `+7998${String(index).padStart(7, '0')}`),
    )
    expect(ipResults.filter((result) => result.status === 'accepted')).toHaveLength(15)
    expect(simulated).toHaveBeenCalledTimes(20)

    const globalResults = await burst(600, 8, (index) =>
      request(index, `+7997${String(index).padStart(7, '0')}`, `203.0.113.${(index % 250) + 1}`),
    )
    expect(globalResults.filter((result) => result.status === 'accepted')).toHaveLength(180)
    expect(globalResults.filter((result) => result.status === 'limited')).toHaveLength(420)
    expect(simulated).toHaveBeenCalledTimes(200)
    expect((await request(0, '+79960000001', '198.51.100.1')).status).toBe('limited')
    expect(simulated).toHaveBeenCalledTimes(200)
    now += DAY_MS
    expect((await request(0, phone)).status).toBe('accepted')
    expect(simulated).toHaveBeenCalledTimes(201)
  } finally {
    await db.dropDatabase()
    await client.close()
    await replica.stop()
  }
}, 120_000)

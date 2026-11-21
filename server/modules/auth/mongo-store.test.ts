// @vitest-environment node
import { createTestCallProvider } from '../../tests/fixtures/call-provider.ts'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MongoClient } from 'mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { createApp } from '../../app.ts'
import { createMongoAuthStore, ensureAuthIndexes } from './mongo-store.ts'
import { createAuthService } from './service.ts'
import { CallProviderError } from './types.ts'
import { getCatalog, seedCatalog } from '../catalog/mongo-catalog.ts'

let replica: MongoMemoryReplSet
let client: MongoClient

beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({
    binary: { downloadDir: join(tmpdir(), 'drop-of-taste-mongodb') },
    replSet: { count: 1 },
  })
  client = new MongoClient(replica.getUri())
  await client.connect()
}, 120_000)

afterAll(async () => {
  await client?.close()
  await replica?.stop()
})

test('MongoDB keeps the session after rebuilding the API and consumes one call check once', async () => {
  const db = client.db(`auth_${randomUUID()}`)
  await ensureAuthIndexes(db)
  let now = Date.now()
  const options = {
    store: createMongoAuthStore(client, db),
    provider: createTestCallProvider(),
    now: () => now,
  }
  const origin = 'http://localhost:5173'
  const app = createApp(createAuthService(options), { origins: [origin], secureCookies: false })
  try {
    const send = await app.inject({
      method: 'POST',
      url: '/api/auth/call/start',
      headers: { origin },
      payload: { phone: '+79991234567', consent: true },
    })
    expect(send.statusCode).toBe(202)
    const withoutConsent = await app.inject({
      method: 'POST',
      url: '/api/auth/call/status',
      headers: { origin },
      payload: { attemptToken: send.json().attemptToken },
    })
    expect(withoutConsent.statusCode).toBe(400)
    const verify = () =>
      app.inject({
        method: 'POST',
        url: '/api/auth/call/status',
        headers: { origin },
        payload: { attemptToken: send.json().attemptToken, consent: true },
      })
    const responses = await Promise.all([verify(), verify()])
    expect(responses.filter((response) => response.headers['set-cookie'])).toHaveLength(1)
    const storedUser = await db.collection('users').findOne({ phone: '+79991234567' })
    expect(storedUser?.consentVersion).toBe('2026-11-06')
    expect(storedUser?.consentAcceptedAt).toBeInstanceOf(Date)
    const cookie = responses.find((response) => response.headers['set-cookie'])?.headers[
      'set-cookie'
    ] as string
    await app.close()

    const restarted = createApp(createAuthService(options), {
      origins: [origin],
      secureCookies: false,
    })
    try {
      expect(
        (await restarted.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } }))
          .statusCode,
      ).toBe(200)
      now += 7 * 24 * 60 * 60_000
      expect(
        (await restarted.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } }))
          .statusCode,
      ).toBe(401)
    } finally {
      await restarted.close()
    }
  } finally {
    await app.close()
    await db.dropDatabase()
  }
}, 30_000)

test('MongoDB expires a session seven days after sign-in even when used', async () => {
  const db = client.db(`auth_${randomUUID()}`)
  await ensureAuthIndexes(db)
  let now = Date.now()
  const origin = 'http://localhost:5173'
  const app = createApp(
    createAuthService({
      store: createMongoAuthStore(client, db),
      provider: createTestCallProvider(),
      now: () => now,
    }),
    { origins: [origin], secureCookies: false },
  )
  try {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/call/start',
      headers: { origin },
      payload: { phone: '+79991234567', consent: true },
    })
    expect(login.statusCode).toBe(202)
    const verified = await app.inject({
      method: 'POST',
      url: '/api/auth/call/status',
      headers: { origin },
      payload: { attemptToken: login.json().attemptToken, consent: true },
    })
    const cookie = verified.headers['set-cookie']!.toString().split(';')[0]!
    const me = () => app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })

    now += 4 * 24 * 60 * 60_000
    const active = await me()
    expect(active.statusCode).toBe(200)
    expect(active.headers['set-cookie']).toBeUndefined()
    now += 4 * 24 * 60 * 60_000
    expect((await me()).statusCode).toBe(401)
  } finally {
    await app.close()
    await db.dropDatabase()
  }
}, 30_000)

test('MongoDB rolls back rate limits when registration is definitely rejected', async () => {
  const db = client.db(`auth_${randomUUID()}`)
  await ensureAuthIndexes(db)
  let now = Date.now()
  let failing = true
  const origin = 'http://localhost:5173'
  const app = createApp(
    createAuthService({
      store: createMongoAuthStore(client, db),
      provider: {
        ...createTestCallProvider(),
        async start() {
          if (failing) throw new CallProviderError(true)
          return { checkId: randomUUID(), callPhone: '+78005008275' }
        },
      },
      now: () => now,
    }),
    { origins: [origin], secureCookies: false },
  )
  const request = () =>
    app.inject({
      method: 'POST',
      url: '/api/auth/call/start',
      headers: { origin },
      payload: { phone: '+79991234567', consent: true },
    })
  try {
    // Дневной лимит — 5 проверок. Сколько бы раз ни упал провайдер,
    // отказы не должны съедать этот бюджет.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      expect((await request()).statusCode).toBe(503)
    }
    failing = false
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await request()).statusCode).toBe(202)
      now += 61_000
    }
    // Шестая регистрация упирается в дневной лимит.
    expect((await request()).statusCode).toBe(429)
  } finally {
    await app.close()
    await db.dropDatabase()
  }
}, 30_000)

test('catalog seed is repeatable and preserves a manually changed template price', async () => {
  const db = client.db(`catalog_${randomUUID()}`)
  try {
    await seedCatalog(db)
    expect((await getCatalog(db)).categories.flatMap((category) => category.products)).toHaveLength(
      42,
    )
    const catalog = db.collection<{ _id: string; priceKopecks: number }>('catalog')
    await catalog.updateOne({ _id: 'borscht' }, { $set: { priceKopecks: 44_400 } })
    await seedCatalog(db)
    expect(await catalog.countDocuments()).toBe(42)
    expect((await catalog.findOne({ _id: 'borscht' }))?.priceKopecks).toBe(44_400)
  } finally {
    await db.dropDatabase()
  }
}, 30_000)

test('MongoDB persists five-call daily limits across service restarts and concurrent requests', async () => {
  const db = client.db(`auth_${randomUUID()}`)
  await ensureAuthIndexes(db)
  let now = Date.now()
  const started = now
  const provider = createTestCallProvider()
  const send = vi.spyOn(provider, 'start')
  const makeAuth = () =>
    createAuthService({
      store: createMongoAuthStore(client, db),
      provider,
      now: () => now,
    })
  const phone = '+79991234567'
  try {
    for (let i = 0; i < 5; i++) {
      const outcomes = await Promise.all([
        makeAuth().startCall(phone, '127.0.0.1'),
        makeAuth().startCall(phone, '127.0.0.1'),
      ])
      expect(outcomes.map((result) => result.status).sort()).toEqual(['accepted', 'limited'])
      now += 60_000
    }
    now += 60 * 60_000
    expect((await makeAuth().startCall(phone, '127.0.0.1')).status).toBe('limited')
    expect(send).toHaveBeenCalledTimes(5)
    expect((await makeAuth().startCall('+79991234568', '127.0.0.1')).status).toBe('accepted')
    now = started + 24 * 60 * 60_000
    const last = await makeAuth().startCall(phone, '127.0.0.1')
    if (last.status !== 'accepted') throw new Error('Expected started')
    expect((await makeAuth().checkCall(last.attemptToken)).status).toBe('verified')
  } finally {
    await db.dropDatabase()
  }
}, 30_000)

test('MongoDB rolls back call check consumption and account creation when writing a session fails', async () => {
  const db = client.db(`auth_${randomUUID()}`)
  await ensureAuthIndexes(db)
  const sessions = db.collection('sessions')
  const originalCollection = db.collection.bind(db)
  const collectionSpy = vi
    .spyOn(db, 'collection')
    .mockImplementation((name, options) =>
      name === 'sessions' ? sessions : originalCollection(name, options),
    )
  const store = createMongoAuthStore(client, db)
  collectionSpy.mockRestore()
  const insertSession = vi
    .spyOn(sessions, 'insertOne')
    .mockRejectedValueOnce(new Error('session write failed'))
  const provider = createTestCallProvider()
  const send = vi.spyOn(provider, 'start')
  let now = Date.now()
  const auth = createAuthService({ store, provider, now: () => now })
  const phone = '+79991234567'
  try {
    const started = await auth.startCall(phone, '127.0.0.1')
    if (started.status !== 'accepted') throw new Error('Expected started')
    await expect(auth.checkCall(started.attemptToken)).rejects.toThrow('session write failed')
    expect(await db.collection('users').countDocuments()).toBe(0)
    now += 3000
    expect((await auth.checkCall(started.attemptToken)).status).toBe('verified')
    expect(send).toHaveBeenCalledTimes(1)
    expect(await sessions.countDocuments()).toBe(1)
  } finally {
    insertSession.mockRestore()
    await db.dropDatabase()
  }
}, 30_000)

test('signing in again preserves profile, birthday, addresses and existing sessions', async () => {
  const db = client.db(`auth_${randomUUID()}`)
  await ensureAuthIndexes(db)
  let now = Date.now()
  const auth = createAuthService({
    store: createMongoAuthStore(client, db),
    provider: createTestCallProvider(),
    now: () => now,
  })
  const phone = '+79991234567'
  try {
    const firstStart = await auth.startCall(phone, '127.0.0.1')
    if (firstStart.status !== 'accepted') throw new Error('Expected started')
    const first = await auth.checkCall(firstStart.attemptToken)
    if (first.status !== 'verified') throw new Error('first sign-in failed')
    await db
      .collection('users')
      .updateOne(
        { phone },
        { $set: { name: 'Анна', birthday: '1990-05-20', email: 'anna@example.ru' } },
      )
    await db
      .collection('addresses')
      .insertOne({ accountId: first.account.id, label: 'Сохранённый адрес' })
    now += 60_000
    const secondStart = await auth.startCall(phone, '127.0.0.1')
    if (secondStart.status !== 'accepted') throw new Error('Expected started')
    const second = await auth.checkCall(secondStart.attemptToken)
    if (second.status !== 'verified') throw new Error('second sign-in failed')
    expect(second.account).toEqual({ ...first.account, name: 'Анна' })
    expect((await db.collection('users').findOne({ phone }))?.birthday).toBe('1990-05-20')
    expect((await db.collection('users').findOne({ phone }))?.email).toBe('anna@example.ru')
    expect(await db.collection('users').countDocuments()).toBe(1)
    expect(await db.collection('addresses').countDocuments({ accountId: second.account.id })).toBe(
      1,
    )
    expect(await auth.getAccount(first.token)).toEqual(second.account)
    expect(await auth.getAccount(second.token)).toEqual(second.account)
  } finally {
    await db.dropDatabase()
  }
}, 30_000)

test('independent API instances share the three-second status lease and store no raw attempt token', async () => {
  const db = client.db('auth_' + randomUUID())
  await ensureAuthIndexes(db)
  let now = Date.now()
  const provider = createTestCallProvider()
  const status = vi.spyOn(provider, 'status').mockResolvedValue('waiting')
  const services = Array.from({ length: 3 }, () =>
    createAuthService({
      store: createMongoAuthStore(client, db),
      provider,
      now: () => now,
    }),
  )
  try {
    const registered = await services[0]!.startCall('+79991234567', '127.0.0.1')
    if (registered.status !== 'accepted') throw new Error('Expected started')
    const challenges = await db.collection('auth_challenges').find().toArray()
    expect(JSON.stringify(challenges)).not.toContain(registered.attemptToken)
    for (let round = 0; round < 2; round++) {
      const results = await Promise.all(
        Array.from({ length: 60 }, (_, index) =>
          services[index % services.length]!.checkCall(registered.attemptToken),
        ),
      )
      expect(results.every((result) => result.status === 'waiting')).toBe(true)
      expect(status).toHaveBeenCalledTimes(round + 1)
      now += 3000
    }
    status.mockResolvedValue('verified')
    const results = await Promise.all(
      services.map((service) => service.checkCall(registered.attemptToken)),
    )
    expect(results.filter((result) => result.status === 'verified')).toHaveLength(1)
    expect(await db.collection('sessions').countDocuments()).toBe(1)
    expect(await db.collection('auth_challenges').countDocuments()).toBe(0)
  } finally {
    await db.dropDatabase()
  }
}, 30_000)

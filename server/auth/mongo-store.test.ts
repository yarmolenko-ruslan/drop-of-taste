// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MongoClient } from 'mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { createApp } from '../app.ts'
import { createMongoAuthStore, ensureAuthIndexes } from './mongo-store.ts'
import { createAuthService } from './service.ts'
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

test('MongoDB keeps the session after rebuilding the API and consumes one code once', async () => {
  const db = client.db(`auth_${randomUUID()}`)
  await ensureAuthIndexes(db)
  let now = Date.now()
  const options = {
    store: createMongoAuthStore(client, db),
    sender: { async send() {} },
    secret: 'test-secret',
    now: () => now,
    developmentCode: '123456',
  }
  const origin = 'http://localhost:5173'
  const app = createApp(createAuthService(options), { origins: [origin], secureCookies: false })
  try {
    const send = await app.inject({
      method: 'POST',
      url: '/api/auth/request-code',
      headers: { origin },
      payload: { phone: '+79991234567' },
    })
    expect(send.statusCode).toBe(202)
    const withoutConsent = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-code',
      headers: { origin },
      payload: { phone: '+79991234567', code: '123456' },
    })
    expect(withoutConsent.statusCode).toBe(400)
    const verify = () =>
      app.inject({
        method: 'POST',
        url: '/api/auth/verify-code',
        headers: { origin },
        payload: { phone: '+79991234567', code: '123456', consent: true },
      })
    const responses = await Promise.all([verify(), verify()])
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 400])
    const storedUser = await db.collection('users').findOne({ phone: '+79991234567' })
    expect(storedUser?.consentVersion).toBe('2026-11-06')
    expect(storedUser?.consentAcceptedAt).toBeInstanceOf(Date)
    const cookie = responses.find((response) => response.statusCode === 200)?.headers[
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
      sender: { async send() {} },
      secret: 'test-secret',
      now: () => now,
      developmentCode: '123456',
    }),
    { origins: [origin], secureCookies: false },
  )
  try {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/request-code',
      headers: { origin },
      payload: { phone: '+79991234567' },
    })
    expect(login.statusCode).toBe(202)
    const verified = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-code',
      headers: { origin },
      payload: { phone: '+79991234567', code: '123456', consent: true },
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

test('MongoDB rolls back rate limits when SMS delivery fails', async () => {
  const db = client.db(`auth_${randomUUID()}`)
  await ensureAuthIndexes(db)
  let now = Date.now()
  let failing = true
  const origin = 'http://localhost:5173'
  const app = createApp(
    createAuthService({
      store: createMongoAuthStore(client, db),
      sender: {
        async send() {
          if (failing) throw new Error('provider unavailable')
        },
      },
      secret: 'test-secret',
      now: () => now,
      developmentCode: '123456',
    }),
    { origins: [origin], secureCookies: false },
  )
  const request = () =>
    app.inject({
      method: 'POST',
      url: '/api/auth/request-code',
      headers: { origin },
      payload: { phone: '+79991234567' },
    })
  try {
    // Часовой лимит — 5 отправок. Сколько бы раз ни упал провайдер,
    // отказы не должны съедать этот бюджет.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      expect((await request()).statusCode).toBe(503)
    }
    failing = false
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await request()).statusCode).toBe(202)
      now += 61_000
    }
    // Шестая успешная отправка упирается в часовой лимит.
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

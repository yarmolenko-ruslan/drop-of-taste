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
    const verify = () =>
      app.inject({
        method: 'POST',
        url: '/api/auth/verify-code',
        headers: { origin },
        payload: { phone: '+79991234567', code: '123456' },
      })
    const responses = await Promise.all([verify(), verify()])
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 400])
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

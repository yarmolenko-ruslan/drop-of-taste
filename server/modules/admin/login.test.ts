// @vitest-environment node
import Fastify from 'fastify'
import type { Db, MongoClient } from 'mongodb'
import { registerAdminRoutes } from './routes.ts'

const hashing = vi.hoisted(() => ({ active: 0, peak: 0 }))
vi.mock('node:crypto', async (original) => {
  const crypto = await original<typeof import('node:crypto')>()
  return {
    ...crypto,
    scrypt(
      password: string,
      salt: Buffer,
      length: number,
      done: (error: Error | null, key: Buffer) => void,
    ) {
      hashing.active++
      hashing.peak = Math.max(hashing.peak, hashing.active)
      crypto.scrypt(password, salt, length, (error, key) => {
        hashing.active--
        done(error, key)
      })
    },
  }
})

function memoryDatabase() {
  let credential: { version: string } | undefined
  return {
    collection: (name: string) =>
      name === 'admin_credentials'
        ? {
            findOne: async (filter: { version?: string }) =>
              credential && (!filter.version || filter.version === credential.version)
                ? credential
                : null,
            insertOne: async (next: { version: string }) => {
              credential = next
            },
          }
        : { createIndex: async () => 'index' },
  } as unknown as Db
}

test('changing source IPs cannot create an unbounded password-hashing queue', async () => {
  const app = Fastify()
  const db = memoryDatabase()
  try {
    await registerAdminRoutes(
      app,
      db,
      ['http://localhost:5173'],
      'correct-password',
      {} as MongoClient,
    )
    hashing.peak = 0
    const responses = await Promise.all(
      Array.from({ length: 80 }, (_, index) =>
        app.inject({
          method: 'POST',
          url: '/api/admin/login',
          remoteAddress: `127.0.0.${index + 1}`,
          headers: { origin: 'http://localhost:5173' },
          payload: { password: 'wrong' },
        }),
      ),
    )
    expect(hashing.peak).toBeLessThanOrEqual(8)
    expect(responses.filter((response) => response.statusCode === 503)).toHaveLength(72)
    expect(hashing.active).toBe(0)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/admin/login',
          remoteAddress: '127.0.0.200',
          headers: { origin: 'http://localhost:5173' },
          payload: { password: 'wrong' },
        })
      ).statusCode,
    ).toBe(401)
  } finally {
    await app.close()
  }
})

test('параллельные попытки входа не обходят лимит асинхронной проверки пароля', async () => {
  const app = Fastify()
  const db = memoryDatabase()
  try {
    await registerAdminRoutes(
      app,
      db,
      ['http://localhost:5173'],
      'correct-password',
      {} as MongoClient,
    )
    const attempts = await Promise.all(
      Array.from({ length: 20 }, () =>
        app.inject({
          method: 'POST',
          url: '/api/admin/login',
          remoteAddress: '127.0.0.77',
          headers: { origin: 'http://localhost:5173' },
          payload: { password: 'wrong' },
        }),
      ),
    )
    expect(attempts.filter((result) => result.statusCode === 401)).toHaveLength(5)
    expect(attempts.filter((result) => result.statusCode === 429)).toHaveLength(15)
  } finally {
    await app.close()
  }
})

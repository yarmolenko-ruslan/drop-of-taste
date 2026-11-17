// @vitest-environment node
import Fastify from 'fastify'
import type { Db, MongoClient } from 'mongodb'
import { registerIikoRoutes } from './iiko.ts'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

test('unexpected integration failures never return internal credentials or topology', async () => {
  for (const key of [
    'IIKO_APP_ID',
    'IIKO_CLIENT_SECRET',
    'IIKO_API_KEY',
    'IIKO_ORGANIZATION_ID',
    'IIKO_EXTERNAL_MENU_ID',
  ])
    vi.stubEnv(key, 'audit-placeholder')
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.endsWith('access_token')
              ? { token: 'audit-token' }
              : {
                  itemGroups: [
                    { id: 'g', name: 'Menu', items: [{ id: 'p', name: 'Dish', price: 100 }] },
                  ],
                },
          ),
        ),
    ),
  )
  const app = Fastify()
  const db = { collection: () => ({}) } as unknown as Db
  const mongo = {
    startSession: () => {
      throw new Error('mongodb://internal-user:private-password@internal-db:27017')
    },
  } as unknown as MongoClient
  registerIikoRoutes(app, db, mongo)
  try {
    const response = await app.inject({ method: 'POST', url: '/api/admin/iiko/sync' })
    expect(response.statusCode).toBe(502)
    expect(response.body).not.toContain('private-password')
    expect(response.body).not.toContain('internal-db')
    expect(response.json().error.code).toBe('IIKO_SYNC_FAILED')
  } finally {
    await app.close()
  }
})

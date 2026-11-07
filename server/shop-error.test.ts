// @vitest-environment node
import type { Db, MongoClient } from 'mongodb'
import type { AuthService } from './auth/service.ts'
import { createApp } from './app.ts'
import { registerShopRoutes } from './shop.ts'

test('сбой базы при расчёте возвращает 500 без внутреннего текста ошибки', async () => {
  const origin = 'http://localhost:5173'
  const auth = {} as AuthService
  const db = {
    collection: () => ({
      find: () => ({
        toArray: async () => {
          throw new Error('mongodb://internal-user:secret@private-host')
        },
      }),
    }),
  } as unknown as Db
  const app = createApp(auth, { origins: [origin], secureCookies: false })
  registerShopRoutes(app, db, {} as MongoClient, auth, [origin])
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/checkout/quote',
      headers: { origin },
      payload: {
        lines: [{ productId: 'borscht', quantity: 1, extras: [] }],
        fulfillment: { mode: 'pickup', label: 'г. Красноярск, улица Петра Подзолкова, 3и' },
      },
    })
    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Не удалось выполнить запрос' },
    })
    expect(response.body).not.toContain('secret')
  } finally {
    await app.close()
  }
})

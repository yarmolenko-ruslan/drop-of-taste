// @vitest-environment node
import fastify from 'fastify'
import type { Db, MongoClient } from 'mongodb'
import type { AuthService } from './auth/service.ts'
import { registerShopRoutes } from './shop.ts'

test('сервер отдаёт этапы только запрошенных заказов текущего клиента', async () => {
  const orders = [
    {
      _id: 'old-order',
      accountId: 'user-1',
      status: 'test',
      fulfillmentStatus: 'preparing',
      payment: { status: 'succeeded' },
    },
    { _id: 'other-order', accountId: 'user-2', status: 'test', fulfillmentStatus: 'new' },
  ]
  const db = {
    collection(name: string) {
      if (name === 'payment_events') return {}
      if (name === 'orders')
        return {
          find(query: { accountId: string; _id: { $in: string[] } }) {
            if ('createdAt' in query || !query.accountId) return { async *[Symbol.asyncIterator]() {} }
            return {
              project() {
                return {
                  async toArray() {
                    return orders.filter(
                      (order) =>
                        order.accountId === query.accountId && query._id.$in.includes(order._id),
                    )
                  },
                }
              },
            }
          },
        }
      throw new Error(`Неожиданная коллекция: ${name}`)
    },
  } as unknown as Db
  const getAccount = vi.fn(async (): Promise<{ id: string } | null> => ({ id: 'user-1' }))
  const auth = { getAccount } as unknown as AuthService
  const app = fastify()
  registerShopRoutes(app, db, {} as MongoClient, auth)
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/orders/statuses',
      headers: { origin: 'http://localhost:5173' },
      payload: { ids: ['old-order', 'other-order'] },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      statuses: [
        {
          _id: 'old-order',
          status: 'test',
          fulfillmentStatus: 'preparing',
          paymentStatus: 'succeeded',
          canceledAt: null,
          completedAt: null,
          fulfilledAt: null,
        },
      ],
    })
    getAccount.mockResolvedValueOnce(null)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/orders/statuses',
          headers: { origin: 'http://localhost:5173' },
          payload: { ids: ['old-order'] },
        })
      ).statusCode,
    ).toBe(401)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/orders/statuses',
          headers: { origin: 'http://localhost:5173' },
          payload: { ids: [] },
        })
      ).statusCode,
    ).toBe(400)
  } finally {
    await app.close()
  }
})

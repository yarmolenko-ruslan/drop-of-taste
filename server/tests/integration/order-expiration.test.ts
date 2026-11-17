// @vitest-environment node
import Fastify from 'fastify'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MongoClient, type Document } from 'mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { registerShopRoutes } from '../../modules/orders/routes.ts'
import { registerAdminRoutes } from '../../modules/admin/routes.ts'
import type { AuthService } from '../../modules/auth/service.ts'
import type { YooPayment } from '../../modules/payments/yookassa.ts'
import { PAYMENT_WINDOW_MS } from '../../../shared/order-payment.ts'

test('срок оплаты: граница 15 минут, старые заказы, оплата перед отменой и запрет повторной оплаты', async () => {
  const repl = await MongoMemoryReplSet.create({
    binary: { downloadDir: join(tmpdir(), 'drop-of-taste-mongodb') },
    replSet: { count: 1 },
  })
  const mongo = new MongoClient(repl.getUri())
  await mongo.connect()
  const db = mongo.db(`expiration_${randomUUID().replaceAll('-', '')}`)
  const auth = { getAccount: async () => ({ id: 'u1' }) } as unknown as AuthService
  const now = new Date('2026-11-14T12:00:00Z')
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)
  const order = (id: string, age: number, extra = {}) => ({
    _id: id,
    accountId: 'u1',
    status: 'test',
    fulfillmentStatus: 'new',
    requiresPayment: true,
    createdAt: new Date(now.getTime() - age),
    input: { fulfillment: { mode: 'pickup', label: 'Кафе' } },
    quote: { totalKopecks: 32400, lines: [], discountKopecks: 0, deliveryKopecks: 0 },
    ...extra,
  })
  const payment = (id: string) => ({
    id,
    status: 'pending',
    attemptKey: id,
    createdAt: now,
    updatedAt: now,
    confirmationUrl: 'https://yoomoney.ru/test',
  })
  const gateway = {
    create: vi.fn(),
    get: vi.fn(async (id: string): Promise<YooPayment> => ({
      id,
      status: id === 'paid' ? 'succeeded' : 'pending',
      paid: id === 'paid',
      test: true,
      amount: { value: '324.00', currency: 'RUB' },
    })),
  }
  const app = Fastify()
  try {
    await db
      .collection<Document & { _id: string }>('orders')
      .insertMany([
        order('before', PAYMENT_WINDOW_MS - 1),
        order('deadline', PAYMENT_WINDOW_MS),
        order('legacy', PAYMENT_WINDOW_MS + 1, { requiresPayment: undefined }),
        order('paid', PAYMENT_WINDOW_MS, { payment: payment('paid') }),
        order('pending', PAYMENT_WINDOW_MS, { payment: payment('pending') }),
        order('free', PAYMENT_WINDOW_MS, { quote: { totalKopecks: 0 } }),
        order('offline', PAYMENT_WINDOW_MS, { requiresPayment: false }),
        order('preparing', PAYMENT_WINDOW_MS, { fulfillmentStatus: 'preparing' }),
        order('completed', PAYMENT_WINDOW_MS, { status: 'completed' }),
      ])
    registerShopRoutes(app, db, mongo, auth, ['http://localhost:5173'], false, gateway)
    await registerAdminRoutes(app, db, ['http://localhost:5173'], 'test-password', mongo)
    const response = await app.inject({ method: 'GET', url: '/api/orders' })
    expect(response.statusCode).toBe(200)
    const stored = await db.collection<Document & { _id: string }>('orders').find().toArray()
    expect(
      stored
        .filter((item) => item.canceledAt)
        .map((item) => item._id)
        .sort(),
    ).toEqual(['deadline', 'legacy', 'pending'])
    expect(stored.find((item) => item._id === 'paid')?.payment.status).toBe('succeeded')
    expect(stored.find((item) => item._id === 'pending')?.payment.status).toBe('pending')
    expect(
      response.json().orders.find((item: { _id: string }) => item._id === 'before')
        .paymentExpiresAt,
    ).toBe(new Date(now.getTime() + 1).toISOString())
    const retry = await app.inject({
      method: 'POST',
      url: '/api/orders/deadline/pay',
      headers: { origin: 'http://localhost:5173' },
    })
    expect(retry.statusCode).toBe(409)
    expect(retry.json().error.code).toBe('ORDER_CANCELED')
    expect(gateway.create).not.toHaveBeenCalled()
    const complete = await app.inject({
      method: 'POST',
      url: '/api/orders/deadline/complete',
      headers: { origin: 'http://localhost:5173' },
    })
    expect(complete.statusCode).toBe(409)
    const statuses = await app.inject({
      method: 'POST',
      url: '/api/orders/statuses',
      headers: { origin: 'http://localhost:5173' },
      payload: { ids: ['deadline'] },
    })
    expect(statuses.json().statuses[0].canceledAt).toBe(now.toISOString())
    const login = await app.inject({
      method: 'POST',
      url: '/api/admin/login',
      headers: { origin: 'http://localhost:5173' },
      payload: { password: 'test-password' },
    })
    const cookie = login.headers['set-cookie']!.toString().split(';')[0]!
    const adminOrders = await app.inject({
      method: 'GET',
      url: '/api/admin/orders?stage=new',
      headers: { cookie },
    })
    expect(adminOrders.statusCode).toBe(200)
    expect(adminOrders.json().orders.some((item: { _id: string }) => item._id === 'deadline')).toBe(
      false,
    )
    const advance = await app.inject({
      method: 'PATCH',
      url: '/api/admin/orders/deadline/stage',
      headers: { origin: 'http://localhost:5173', cookie },
      payload: { stage: 'preparing' },
    })
    expect(advance.statusCode).toBe(409)
    gateway.get.mockResolvedValueOnce({
      id: 'pending',
      status: 'succeeded',
      paid: true,
      test: true,
      amount: { value: '324.00', currency: 'RUB' },
    })
    const latePayment = await app.inject({ method: 'GET', url: '/api/orders/pending/payment' })
    expect(latePayment.json()).toEqual({
      status: 'succeeded',
      orderCanceled: true,
      canceledAt: now.toISOString(),
    })
    const lateOrder = await db
      .collection<Document & { _id: string }>('orders')
      .findOne({ _id: 'pending' })
    expect(lateOrder?.canceledAt).toBeTruthy()
    expect(lateOrder?.payment.status).toBe('succeeded')
    vi.setSystemTime(new Date(now.getTime() + 1))
    await app.inject({ method: 'GET', url: '/api/orders' })
    expect(
      (await db.collection<Document & { _id: string }>('orders').findOne({ _id: 'before' }))
        ?.canceledAt,
    ).toBeTruthy()
  } finally {
    await app.close()
    vi.useRealTimers()
    await mongo.close()
    await repl.stop()
  }
})

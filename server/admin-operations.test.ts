// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { MongoClient } from 'mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { expect, test } from 'vitest'
import { registerAdminRoutes } from './admin.ts'

const origin = 'http://localhost:5173'

test('администратор ведёт заказ по этапам и находит историю клиента', async () => {
  const replica = await MongoMemoryReplSet.create({
    binary: { downloadDir: join(tmpdir(), 'drop-of-taste-mongodb') },
    replSet: { count: 1 },
  })
  const mongo = new MongoClient(replica.getUri())
  await mongo.connect()
  const db = mongo.db(`test_${randomUUID().replaceAll('-', '')}`)
  const app = Fastify()
  try {
    await registerAdminRoutes(app, db, [origin], 'test-admin-password')
    await db
      .collection<{ _id: string; id: string; name: string; phone: string; email: string }>('users')
      .insertOne({
        _id: 'customer-1',
        id: 'customer-1',
        name: 'Анна',
        phone: '+79991234567',
        email: 'anna@example.com',
      })
    await db
      .collection<{
        _id: string
        accountId: string
        createdAt: Date
        input: unknown
        quote: unknown
      }>('orders')
      .insertOne({
        _id: 'order-1',
        accountId: 'customer-1',
        createdAt: new Date(),
        input: { fulfillment: { mode: 'delivery', label: 'Красноярск, Ленина, 1' } },
        quote: {
          lines: [{ name: 'Борщ', quantity: 1, lineTotalKopecks: 35000 }],
          totalKopecks: 35000,
          discountKopecks: 0,
          deliveryKopecks: 0,
        },
      })
    const unauthorized = await app.inject({ method: 'GET', url: '/api/admin/orders?stage=new' })
    expect(unauthorized.statusCode).toBe(401)
    const login = await app.inject({
      method: 'POST',
      url: '/api/admin/login',
      headers: { origin },
      payload: { password: 'test-admin-password' },
    })
    const cookie = login.headers['set-cookie']!.toString().split(';')[0]
    const headers = { origin, cookie }
    await db
      .collection<{
        _id: string
        accountId: string
        createdAt: Date
        requiresPayment: boolean
        payment: { status: string }
        input: unknown
        quote: unknown
      }>('orders')
      .insertOne({
        _id: 'unpaid-order',
        accountId: 'customer-1',
        createdAt: new Date(),
        requiresPayment: true,
        payment: { status: 'pending' },
        input: { fulfillment: { mode: 'delivery', label: 'Красноярск, Ленина, 1' } },
        quote: { lines: [], totalKopecks: 35000, discountKopecks: 0, deliveryKopecks: 0 },
      })
    const list = async (stage: string) =>
      (await app.inject({ method: 'GET', url: `/api/admin/orders?stage=${stage}`, headers })).json()
        .orders
    expect((await list('new')).map((order: { _id: string }) => order._id)).toEqual(['order-1'])
    const unpaidAdvance = await app.inject({
      method: 'PATCH',
      url: '/api/admin/orders/unpaid-order/stage',
      headers,
      payload: { stage: 'preparing' },
    })
    expect(unpaidAdvance.statusCode).toBe(409)
    const skipped = await app.inject({
      method: 'PATCH',
      url: '/api/admin/orders/order-1/stage',
      headers,
      payload: { stage: 'delivering' },
    })
    expect(skipped.statusCode).toBe(409)
    for (const [from, to] of [
      ['new', 'preparing'],
      ['preparing', 'delivering'],
      ['delivering', 'completed'],
    ] as const) {
      const changed = await app.inject({
        method: 'PATCH',
        url: '/api/admin/orders/order-1/stage',
        headers,
        payload: { stage: to },
      })
      expect(changed.statusCode).toBe(200)
      expect(await list(from)).toHaveLength(0)
      expect(await list(to)).toHaveLength(1)
    }
    await db
      .collection<{
        _id: string
        accountId: string
        createdAt: Date
        status: string
        input: unknown
        quote: unknown
      }>('orders')
      .insertOne({
        _id: 'legacy-completed',
        accountId: 'customer-1',
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        status: 'completed',
        input: { fulfillment: { mode: 'pickup', label: 'Кафе' } },
        quote: { lines: [], totalKopecks: 10000, discountKopecks: 0, deliveryKopecks: 0 },
      })
    expect((await list('completed')).map((order: { _id: string }) => order._id)).toContain(
      'legacy-completed',
    )
    expect((await list('new')).map((order: { _id: string }) => order._id)).not.toContain(
      'legacy-completed',
    )
    await db
      .collection<{ _id: string }>('orders')
      .updateOne({ _id: 'unpaid-order' }, { $set: { 'payment.status': 'succeeded' } })
    expect((await list('new')).map((order: { _id: string }) => order._id)).toEqual(['unpaid-order'])
    const search = await app.inject({
      method: 'GET',
      url: '/api/admin/clients?q=anna&filter=ordered',
      headers,
    })
    expect(search.json().clients[0].phone).toBe('+79991234567')
    await db.collection<{ _id: string; accountId: string; label: string }>('addresses').insertOne({
      _id: 'address-1',
      accountId: 'customer-1',
      label: 'Красноярск, Ленина, 1',
    })
    const profile = await app.inject({
      method: 'GET',
      url: '/api/admin/clients/customer-1',
      headers,
    })
    expect(profile.json().addresses).toEqual(['Красноярск, Ленина, 1'])
    expect(
      profile.json().orders.find((order: { _id: string }) => order._id === 'order-1'),
    ).toMatchObject({
      _id: 'order-1',
      fulfillmentStatus: 'completed',
    })
    expect(
      profile.json().orders.find((order: { _id: string }) => order._id === 'order-1').fulfilledAt,
    ).toBeTruthy()
    const sameTime = new Date('2026-01-01T12:00:00.000Z')
    await db
      .collection<{
        _id: string
        accountId: string
        createdAt: Date
        input: unknown
        quote: unknown
      }>('orders')
      .insertMany(
        Array.from({ length: 51 }, (_, index) => ({
          _id: `batch-${String(index).padStart(2, '0')}`,
          accountId: 'customer-1',
          createdAt: sameTime,
          input: { fulfillment: { mode: 'pickup', label: 'Кафе' } },
          quote: { lines: [], totalKopecks: 10000, discountKopecks: 0, deliveryKopecks: 0 },
        })),
      )
    const firstPage = (
      await app.inject({ method: 'GET', url: '/api/admin/orders?stage=new', headers })
    ).json()
    const secondPage = (
      await app.inject({
        method: 'GET',
        url: `/api/admin/orders?stage=new&before=${encodeURIComponent(firstPage.nextBefore)}`,
        headers,
      })
    ).json()
    expect(firstPage.orders).toHaveLength(50)
    expect(secondPage.orders).toHaveLength(2)
    expect(
      new Set(
        [...firstPage.orders, ...secondPage.orders].map((order: { _id: string }) => order._id),
      ).size,
    ).toBe(52)
    const refreshed = (
      await app.inject({ method: 'GET', url: '/api/admin/orders?stage=new&limit=52', headers })
    ).json()
    expect(refreshed.orders).toHaveLength(52)
    expect(refreshed.nextBefore).toBeNull()
    await db
      .collection<{ _id: string; id: string; name: string; phone: string }>('users')
      .insertMany(
        Array.from({ length: 51 }, (_, index) => ({
          _id: `client-${String(index).padStart(2, '0')}`,
          id: `client-${String(index).padStart(2, '0')}`,
          name: `Клиент ${index}`,
          phone: `+7999000${String(index).padStart(4, '0')}`,
        })),
      )
    const firstClients = (
      await app.inject({ method: 'GET', url: '/api/admin/clients', headers })
    ).json()
    const secondClients = (
      await app.inject({
        method: 'GET',
        url: `/api/admin/clients?before=${encodeURIComponent(firstClients.nextBefore)}`,
        headers,
      })
    ).json()
    expect(firstClients.clients).toHaveLength(50)
    expect(secondClients.clients).toHaveLength(2)
    const withoutOrders = (
      await app.inject({ method: 'GET', url: '/api/admin/clients?filter=without-orders', headers })
    ).json()
    expect(withoutOrders.clients).toHaveLength(50)
    expect(withoutOrders.nextBefore).toBeTruthy()
    const orderedClients = (
      await app.inject({ method: 'GET', url: '/api/admin/clients?filter=ordered', headers })
    ).json()
    expect(orderedClients.clients.map((client: { _id: string }) => client._id)).toEqual([
      'customer-1',
    ])
  } finally {
    await app.close()
    await mongo.close()
    await replica.stop()
  }
}, 60_000)

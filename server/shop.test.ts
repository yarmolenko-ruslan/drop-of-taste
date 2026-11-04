// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MongoClient } from 'mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { createApp } from './app.ts'
import { createMongoAuthStore, ensureAuthIndexes } from './auth/mongo-store.ts'
import { createAuthService } from './auth/service.ts'
import { seedCatalog } from './catalog/mongo-catalog.ts'
import { registerProfileRoutes } from './profile.ts'
import { ensureShopIndexes, registerShopRoutes } from './shop.ts'

const origin = 'http://localhost:5173'
const pickup = { mode: 'pickup', label: 'г. Красноярск, улица Петра Подзолкова, 3и' }
const delivery = {
  mode: 'delivery',
  label: 'ул. Мира, 10, подъезд 2, 3 этаж, квартира 25',
  details: {
    street: 'ул. Мира, 10',
    entrance: '2',
    floor: '3',
    flat: '25',
    comment: '',
    isHouse: false,
  },
}
const lines = (quantity: number) => [{ productId: 'borscht', quantity, extras: [] }]

test('MongoDB сохраняет профиль и тестовый заказ; расчёт и идемпотентность работают', async () => {
  const repl = await MongoMemoryReplSet.create({
    binary: { downloadDir: join(tmpdir(), 'drop-of-taste-mongodb') },
    replSet: { count: 1 },
  })
  const mongo = new MongoClient(repl.getUri())
  await mongo.connect()
  const db = mongo.db(`test_${randomUUID().replaceAll('-', '')}`)
  const app = createApp(
    createAuthService({
      store: createMongoAuthStore(mongo, db),
      sender: { async send() {} },
      secret: 'test-secret',
      developmentCode: '123456',
    }),
    { origins: [origin], secureCookies: false },
  )
  try {
    await ensureAuthIndexes(db)
    await seedCatalog(db)
    await ensureShopIndexes(db)
    const auth = createAuthService({
      store: createMongoAuthStore(mongo, db),
      sender: { async send() {} },
      secret: 'test-secret',
      developmentCode: '123456',
    })
    registerShopRoutes(app, db, mongo, auth)
    registerProfileRoutes(app, db, auth)
    const phone = '+79991234567'
    const request = await app.inject({
      method: 'POST',
      url: '/api/auth/request-code',
      headers: { origin },
      payload: { phone },
    })
    expect(request.statusCode).toBe(202)
    const verified = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-code',
      headers: { origin },
      payload: { phone, code: '123456' },
    })
    expect(verified.statusCode).toBe(200)
    const cookie = verified.headers['set-cookie']!.toString().split(';')[0]

    const pickupQuote = await app.inject({
      method: 'POST',
      url: '/api/checkout/quote',
      headers: { origin },
      payload: { lines: lines(1), fulfillment: pickup },
    })
    expect(pickupQuote.json()).toMatchObject({
      subtotalKopecks: 36000,
      discountKopecks: 3600,
      deliveryKopecks: 0,
      totalKopecks: 32400,
      eligible: true,
    })
    const smallDelivery = await app.inject({
      method: 'POST',
      url: '/api/checkout/quote',
      headers: { origin },
      payload: { lines: lines(1), fulfillment: delivery },
    })
    expect(smallDelivery.json()).toMatchObject({ deliveryKopecks: 25000, eligible: false })
    const minimumDelivery = await app.inject({
      method: 'POST',
      url: '/api/checkout/quote',
      headers: { origin },
      payload: {
        lines: [
          { productId: 'syrniki', quantity: 1, extras: [] },
          { productId: 'oatmeal', quantity: 1, extras: [] },
        ],
        fulfillment: delivery,
      },
    })
    expect(minimumDelivery.json()).toMatchObject({
      subtotalKopecks: 50000,
      deliveryKopecks: 25000,
      eligible: true,
    })
    const thresholdDelivery = await app.inject({
      method: 'POST',
      url: '/api/checkout/quote',
      headers: { origin },
      payload: {
        lines: [
          { productId: 'lunch', quantity: 1, extras: [] },
          { productId: 'kurnik', quantity: 1, extras: [] },
          { productId: 'latte', quantity: 1, extras: [] },
        ],
        fulfillment: delivery,
      },
    })
    expect(thresholdDelivery.json()).toMatchObject({
      subtotalKopecks: 150000,
      deliveryKopecks: 0,
      eligible: true,
    })
    const freeDelivery = await app.inject({
      method: 'POST',
      url: '/api/checkout/quote',
      headers: { origin },
      payload: { lines: lines(5), fulfillment: delivery },
    })
    expect(freeDelivery.json()).toMatchObject({
      deliveryKopecks: 0,
      totalKopecks: 180000,
      eligible: true,
    })
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/checkout/quote',
          headers: { origin },
          payload: {
            lines: [{ productId: 'missing', quantity: 1, extras: [] }],
            fulfillment: pickup,
          },
        })
      ).statusCode,
    ).toBe(400)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/checkout/quote',
          headers: { origin },
          payload: {
            lines: [
              { productId: 'borscht', quantity: 1, extras: [{ name: 'Сметана', quantity: 1 }] },
            ],
            fulfillment: pickup,
          },
        })
      ).statusCode,
    ).toBe(400)

    const body = { lines: lines(1), fulfillment: pickup, expectedTotalKopecks: 32400 }
    const headers = { origin, cookie, 'idempotency-key': randomUUID() }
    const first = await app.inject({ method: 'POST', url: '/api/orders', headers, payload: body })
    const repeated = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers,
      payload: body,
    })
    expect(first.statusCode).toBe(201)
    expect(repeated.statusCode).toBe(200)
    expect(repeated.json().order._id).toBe(first.json().order._id)
    expect(await db.collection('orders').countDocuments()).toBe(1)
    expect((await app.inject({ method: 'GET', url: '/api/orders' })).statusCode).toBe(401)
    const stale = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { ...headers, 'idempotency-key': randomUUID() },
      payload: { ...body, expectedTotalKopecks: 123 },
    })
    expect(stale.statusCode).toBe(409)
    expect(stale.json().error.code).toBe('PRICE_CHANGED')
    expect(await db.collection('orders').countDocuments()).toBe(1)

    const updated = await app.inject({
      method: 'PUT',
      url: '/api/profile',
      headers: { origin, cookie },
      payload: {
        name: 'Руслан',
        email: 'test@example.ru',
        birthday: '1992-02-29',
        notifications: { push: false, email: true, sms: false },
      },
    })
    expect(updated.statusCode).toBe(200)
    const profile = await app.inject({ method: 'GET', url: '/api/profile', headers: { cookie } })
    expect(profile.json().profile).toMatchObject({
      name: 'Руслан',
      email: 'test@example.ru',
      birthday: '1992-02-29',
    })
    const address = await app.inject({
      method: 'POST',
      url: '/api/addresses',
      headers: { origin, cookie },
      payload: {
        label: delivery.label,
        details: {
          street: 'ул. Мира, 10',
          entrance: '2',
          floor: '3',
          flat: '25',
          comment: '',
          isHouse: false,
        },
      },
    })
    expect(address.statusCode).toBe(201)
    expect(
      (await app.inject({ method: 'GET', url: '/api/addresses', headers: { cookie } })).json()
        .addresses,
    ).toHaveLength(1)
    const addressId = address.json().address.id as string
    const select = await app.inject({
      method: 'PUT',
      url: '/api/profile/delivery-selection',
      headers: { origin, cookie },
      payload: { addressId },
    })
    expect(select.statusCode).toBe(200)
    const selectedProfile = await app.inject({
      method: 'GET',
      url: '/api/profile',
      headers: { cookie },
    })
    expect(selectedProfile.json().profile.selectedAddressId).toBe(addressId)
    const otherPhone = '+79991234568'
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/request-code',
          headers: { origin },
          payload: { phone: otherPhone },
        })
      ).statusCode,
    ).toBe(202)
    const otherLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-code',
      headers: { origin },
      payload: { phone: otherPhone, code: '123456' },
    })
    const otherCookie = otherLogin.headers['set-cookie']!.toString().split(';')[0]
    expect(
      (
        await app.inject({ method: 'GET', url: '/api/orders', headers: { cookie: otherCookie } })
      ).json().orders,
    ).toHaveLength(0)
    expect(
      (
        await app.inject({ method: 'GET', url: '/api/addresses', headers: { cookie: otherCookie } })
      ).json().addresses,
    ).toHaveLength(0)
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/addresses/${address.json().address.id}`,
          headers: { origin, cookie: otherCookie },
        })
      ).statusCode,
    ).toBe(404)
    expect(
      (await app.inject({ method: 'GET', url: '/api/addresses', headers: { cookie } })).json()
        .addresses,
    ).toHaveLength(1)
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/profile/delivery-selection',
          headers: { origin, cookie: otherCookie },
          payload: { addressId },
        })
      ).statusCode,
    ).toBe(404)
    const cleared = await app.inject({
      method: 'PUT',
      url: '/api/profile/delivery-selection',
      headers: { origin, cookie },
      payload: { addressId: null },
    })
    expect(cleared.statusCode).toBe(200)
    expect(
      (await app.inject({ method: 'GET', url: '/api/profile', headers: { cookie } })).json().profile
        .selectedAddressId,
    ).toBeNull()

    const orderId = first.json().order._id as string
    const completed = await app.inject({
      method: 'POST',
      url: `/api/orders/${orderId}/complete`,
      headers: { origin, cookie },
    })
    expect(completed.statusCode).toBe(200)
    expect(completed.json().order.status).toBe('completed')
    expect(completed.json().order.completedAt).toBeTruthy()
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/orders/${orderId}/complete`,
          headers: { origin, cookie },
        })
      ).statusCode,
    ).toBe(404)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/orders/${orderId}/complete`,
          headers: { origin, cookie: otherCookie },
        })
      ).statusCode,
    ).toBe(404)
  } finally {
    await app.close()
    await mongo.close()
    await repl.stop()
  }
}, 60_000)

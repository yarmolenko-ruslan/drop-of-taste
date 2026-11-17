// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MongoClient } from 'mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { createApp } from '../../app.ts'
import { createMongoAuthStore, ensureAuthIndexes } from '../../modules/auth/mongo-store.ts'
import { createAuthService } from '../../modules/auth/service.ts'
import { seedCatalog } from '../../modules/catalog/mongo-catalog.ts'
import { registerProfileRoutes } from '../../modules/profile/routes.ts'
import { ensureShopIndexes, registerShopRoutes } from '../../modules/orders/routes.ts'
import type { PaymentGateway } from '../../modules/payments/yookassa.ts'
import { defaultSiteContent } from '../../../shared/site-content.ts'

test('одна скидка на праздничный год: гонка заказов, отмена и успешная оплата', async () => {
  const repl = await MongoMemoryReplSet.create({
    binary: { downloadDir: join(tmpdir(), 'drop-of-taste-mongodb') },
    replSet: { count: 1 },
  })
  const mongo = new MongoClient(repl.getUri())
  await mongo.connect()
  const db = mongo.db(`birthday_${randomUUID().replaceAll('-', '')}`)
  const origin = 'http://localhost:5173'
  const auth = createAuthService({
    store: createMongoAuthStore(mongo, db),
    sender: { async send() {} },
    secret: 'test-secret',
    developmentCode: '123456',
  })
  const app = createApp(auth, { origins: [origin], secureCookies: false })
  let gatewayStatus: 'pending' | 'succeeded' | 'canceled' = 'succeeded'
  let invalidConfirmation = false
  const paymentAmounts = new Map<string, number>()
  const gateway: PaymentGateway = {
    async create(id, total) {
      paymentAmounts.set(id, total)
      return {
        id,
        status: gatewayStatus,
        paid: gatewayStatus === 'succeeded',
        test: true,
        amount: { value: (total / 100).toFixed(2), currency: 'RUB' },
        ...(gatewayStatus === 'pending' && {
          confirmation: {
            confirmation_url: invalidConfirmation
              ? 'https://example.invalid/pay'
              : 'https://yoomoney.ru/test',
          },
        }),
      }
    },
    async get(id) {
      return {
        id,
        status: gatewayStatus,
        paid: gatewayStatus === 'succeeded',
        test: true,
        amount: { value: ((paymentAmounts.get(id) ?? 0) / 100).toFixed(2), currency: 'RUB' },
      }
    },
  }
  try {
    await ensureAuthIndexes(db)
    await ensureShopIndexes(db)
    await seedCatalog(db)
    registerProfileRoutes(app, db, mongo, auth, [origin])
    registerShopRoutes(app, db, mongo, auth, [origin], false, gateway)
    const phone = '+79991234567'
    await app.inject({
      method: 'POST',
      url: '/api/auth/request-code',
      headers: { origin },
      payload: { phone },
    })
    const verified = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-code',
      headers: { origin },
      payload: { phone, code: '123456', consent: true },
    })
    const cookie = verified.headers['set-cookie']!.toString().split(';')[0]
    const local = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Krasnoyarsk',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date())
    const part = (type: string) => local.find((item) => item.type === type)!.value
    const birthday = `1992-${part('month')}-${part('day')}`
    const saved = await app.inject({
      method: 'PUT',
      url: '/api/profile',
      headers: { origin, cookie },
      payload: {
        name: 'Руслан',
        email: '',
        birthday,
        notifications: { push: false, email: false, sms: false },
      },
    })
    expect(saved.statusCode).toBe(200)
    const input = {
      lines: [{ productId: 'borscht', quantity: 1, extras: [] }],
      fulfillment: { mode: 'pickup', label: 'г. Красноярск, улица Петра Подзолкова, 3и' },
      birthdayDiscount: true,
    }
    const headers = { origin, cookie }
    const quoted = await app.inject({
      method: 'POST',
      url: '/api/checkout/quote',
      headers,
      payload: input,
    })
    expect(quoted.statusCode).toBe(200)
    expect(quoted.json().birthdayDiscountKopecks).toBeGreaterThan(0)
    const payload = { ...input, expectedTotalKopecks: quoted.json().totalKopecks }
    const create = () =>
      app.inject({
        method: 'POST',
        url: '/api/orders',
        headers: { ...headers, 'idempotency-key': randomUUID() },
        payload,
      })
    const [first, second] = await Promise.all([create(), create()])
    expect([first.statusCode, second.statusCode].sort()).toEqual([201, 409])
    const orderId = (first.statusCode === 201 ? first : second).json().order._id
    expect(
      (await app.inject({ method: 'POST', url: `/api/orders/${orderId}/cancel`, headers })).json(),
    ).toEqual({ status: 'canceled' })
    const next = await create()
    expect(next.statusCode).toBe(201)
    const paidId = next.json().order._id
    const payment = await app.inject({ method: 'POST', url: `/api/orders/${paidId}/pay`, headers })
    expect(payment.json().status).toBe('succeeded')
    const rejected = await create()
    expect(rejected.statusCode).toBe(409)
    expect(rejected.json().error.code).toBe('BIRTHDAY_ALREADY_USED')

    await db.collection<{ _id: string }>('site_content').updateOne(
      { _id: 'public' },
      {
        $set: {
          promotions: defaultSiteContent.promotions.map((promotion) =>
            promotion.id === 'birthday' ? { ...promotion, discountPercent: 100 } : promotion,
          ),
        },
      },
      { upsert: true },
    )
    const otherPhone = '+79991234568'
    await app.inject({
      method: 'POST',
      url: '/api/auth/request-code',
      headers: { origin },
      payload: { phone: otherPhone },
    })
    const otherLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-code',
      headers: { origin },
      payload: { phone: otherPhone, code: '123456', consent: true },
    })
    const otherHeaders = {
      origin,
      cookie: otherLogin.headers['set-cookie']!.toString().split(';')[0],
    }
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/profile',
          headers: otherHeaders,
          payload: {
            name: 'Другой',
            email: '',
            birthday,
            notifications: { push: false, email: false, sms: false },
          },
        })
      ).statusCode,
    ).toBe(200)
    const zeroQuote = await app.inject({
      method: 'POST',
      url: '/api/checkout/quote',
      headers: otherHeaders,
      payload: input,
    })
    expect(zeroQuote.json().totalKopecks).toBe(0)
    const freeOrder = () =>
      app.inject({
        method: 'POST',
        url: '/api/orders',
        headers: { ...otherHeaders, 'idempotency-key': randomUUID() },
        payload: { ...input, expectedTotalKopecks: 0 },
      })
    const canceledOrder = await freeOrder()
    expect(canceledOrder.statusCode).toBe(201)
    const canceledId = canceledOrder.json().order._id
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/orders/${canceledId}/cancel`,
          headers: otherHeaders,
        })
      ).json().status,
    ).toBe('canceled')
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/orders/${canceledId}/complete`,
          headers: otherHeaders,
        })
      ).statusCode,
    ).toBe(409)
    const free = await freeOrder()
    expect(free.statusCode).toBe(201)
    const freeId = free.json().order._id
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/orders/${freeId}/complete`,
          headers: otherHeaders,
        })
      ).statusCode,
    ).toBe(200)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/orders/${freeId}/cancel`,
          headers: otherHeaders,
        })
      ).statusCode,
    ).toBe(409)
    expect((await freeOrder()).statusCode).toBe(409)

    await db.collection<{ _id: string }>('site_content').updateOne(
      { _id: 'public' },
      {
        $set: { promotions: defaultSiteContent.promotions },
      },
    )
    const thirdPhone = '+79991234569'
    await app.inject({
      method: 'POST',
      url: '/api/auth/request-code',
      headers: { origin },
      payload: { phone: thirdPhone },
    })
    const thirdLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-code',
      headers: { origin },
      payload: { phone: thirdPhone, code: '123456', consent: true },
    })
    const thirdHeaders = {
      origin,
      cookie: thirdLogin.headers['set-cookie']!.toString().split(';')[0],
    }
    await app.inject({
      method: 'PUT',
      url: '/api/profile',
      headers: thirdHeaders,
      payload: {
        name: 'Третий',
        email: '',
        birthday,
        notifications: { push: false, email: false, sms: false },
      },
    })
    const thirdQuote = await app.inject({
      method: 'POST',
      url: '/api/checkout/quote',
      headers: thirdHeaders,
      payload: input,
    })
    const thirdOrder = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { ...thirdHeaders, 'idempotency-key': randomUUID() },
      payload: { ...input, expectedTotalKopecks: thirdQuote.json().totalKopecks },
    })
    expect(thirdOrder.statusCode).toBe(201)
    const thirdId = thirdOrder.json().order._id
    gatewayStatus = 'pending'
    invalidConfirmation = true
    const paymentWithoutUrl = await app.inject({
      method: 'POST',
      url: `/api/orders/${thirdId}/pay`,
      headers: thirdHeaders,
    })
    expect(paymentWithoutUrl.statusCode).toBe(502)
    expect(paymentWithoutUrl.json().error.code).toBe('PAYMENT_CONFIRMATION_UNAVAILABLE')
    expect(
      (
        await db
          .collection<{ _id: string; payment?: { id?: string } }>('orders')
          .findOne({ _id: thirdId })
      )?.payment?.id,
    ).toBe(thirdId)
    const stillPending = await app.inject({
      method: 'POST',
      url: `/api/orders/${thirdId}/cancel`,
      headers: thirdHeaders,
    })
    expect(stillPending.statusCode).toBe(409)
    expect(stillPending.json().error.code).toBe('PAYMENT_PENDING')
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/checkout/quote',
          headers: thirdHeaders,
          payload: input,
        })
      ).json().error.code,
    ).toBe('BIRTHDAY_ALREADY_USED')
    gatewayStatus = 'canceled'
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/orders/${thirdId}/cancel`,
          headers: thirdHeaders,
        })
      ).json().status,
    ).toBe('canceled')
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/checkout/quote',
          headers: thirdHeaders,
          payload: input,
        })
      ).statusCode,
    ).toBe(200)
  } finally {
    await app.close()
    await mongo.close()
    await repl.stop()
  }
})

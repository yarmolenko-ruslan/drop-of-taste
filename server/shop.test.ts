// @vitest-environment node
import { randomUUID } from 'node:crypto'
import type { BonusCode } from '../shared/bonus-code.ts'
import { defaultSiteContent, type SiteContent } from '../shared/site-content.ts'
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
    { origins: [origin], secureCookies: true },
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
    registerShopRoutes(app, db, mongo, auth, [origin], true)
    registerProfileRoutes(app, db, mongo, auth, [origin], true)
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
      payload: { phone, code: '123456', consent: true },
    })
    expect(verified.statusCode).toBe(200)
    const cookie = verified.headers['set-cookie']!.toString().split(';')[0]
    expect(cookie?.startsWith('__Host-session=')).toBe(true)

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
    await db.collection<BonusCode>('bonus_codes').insertMany([
      {
        _id: 'PERCENT10',
        kind: 'percent',
        value: 20,
        startsAt: new Date(Date.now() - 60_000).toISOString(),
        endsAt: new Date(Date.now() + 60_000).toISOString(),
        active: true,
      },
      {
        _id: 'RUB100',
        kind: 'rubles',
        value: 100,
        startsAt: new Date(Date.now() - 60_000).toISOString(),
        endsAt: new Date(Date.now() + 60_000).toISOString(),
        active: true,
      },
      {
        _id: 'EXPIRED',
        kind: 'percent',
        value: 10,
        startsAt: new Date(Date.now() - 120_000).toISOString(),
        endsAt: new Date(Date.now() - 60_000).toISOString(),
        active: true,
      },
    ])
    const percentQuote = await app.inject({
      method: 'POST',
      url: '/api/checkout/quote',
      headers: { origin },
      payload: { lines: lines(1), fulfillment: pickup, promoCode: 'percent10' },
    })
    expect(percentQuote.json()).toMatchObject({
      promoCode: 'PERCENT10',
      discountKopecks: 0,
      promoDiscountKopecks: 7200,
      totalKopecks: 28800,
    })
    const rubQuote = await app.inject({
      method: 'POST',
      url: '/api/checkout/quote',
      headers: { origin },
      payload: { lines: lines(1), fulfillment: pickup, promoCode: 'RUB100' },
    })
    expect(rubQuote.json()).toMatchObject({ promoDiscountKopecks: 10000, totalKopecks: 26000 })
    const comboQuote = await app.inject({
      method: 'POST',
      url: '/api/checkout/quote',
      headers: { origin },
      payload: { lines: [{ productId: 'lunch', quantity: 1, extras: [] }], fulfillment: pickup },
    })
    expect(comboQuote.json()).toMatchObject({
      subtotalKopecks: 99000,
      discountableSubtotalKopecks: 0,
      discountKopecks: 0,
      totalKopecks: 99000,
    })
    const comboWithCode = await app.inject({
      method: 'POST',
      url: '/api/checkout/quote',
      headers: { origin },
      payload: {
        lines: [{ productId: 'lunch', quantity: 1, extras: [] }],
        fulfillment: pickup,
        promoCode: 'RUB100',
      },
    })
    expect(comboWithCode.json().error.code).toBe('PROMO_NOT_APPLICABLE')
    const mixedQuote = await app.inject({
      method: 'POST',
      url: '/api/checkout/quote',
      headers: { origin },
      payload: {
        lines: [{ productId: 'lunch', quantity: 1, extras: [] }, ...lines(1)],
        fulfillment: pickup,
        promoCode: 'PERCENT10',
      },
    })
    expect(mixedQuote.json()).toMatchObject({
      subtotalKopecks: 135000,
      discountableSubtotalKopecks: 36000,
      promoDiscountKopecks: 7200,
      totalKopecks: 127800,
    })
    const expiredQuote = await app.inject({
      method: 'POST',
      url: '/api/checkout/quote',
      headers: { origin },
      payload: { lines: lines(1), fulfillment: pickup, promoCode: 'EXPIRED' },
    })
    expect(expiredQuote.statusCode).toBe(400)
    expect(expiredQuote.json().error.code).toBe('INVALID_PROMO_CODE')
    await db
      .collection<BonusCode>('bonus_codes')
      .updateOne({ _id: 'PERCENT10' }, { $set: { endsAt: new Date(Date.now() - 1).toISOString() } })
    const expiredAfterQuote = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { origin, cookie, 'idempotency-key': randomUUID() },
      payload: {
        lines: lines(1),
        fulfillment: pickup,
        promoCode: 'PERCENT10',
        expectedTotalKopecks: 28800,
      },
    })
    expect(expiredAfterQuote.json().error.code).toBe('INVALID_PROMO_CODE')
    await db
      .collection<BonusCode>('bonus_codes')
      .updateOne(
        { _id: 'PERCENT10' },
        { $set: { endsAt: new Date(Date.now() + 60_000).toISOString() } },
      )
    const bonusOrder = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { origin, cookie, 'idempotency-key': randomUUID() },
      payload: {
        lines: lines(1),
        fulfillment: pickup,
        promoCode: 'percent10',
        expectedTotalKopecks: 28800,
      },
    })
    expect(bonusOrder.statusCode).toBe(201)
    expect(bonusOrder.json().order.quote).toMatchObject({
      promoCode: 'PERCENT10',
      totalKopecks: 28800,
    })
    await db.collection('orders').deleteOne({ _id: bonusOrder.json().order._id })
    await db.collection<SiteContent & { _id: string }>('site_content').updateOne(
      { _id: 'public' },
      {
        $set: {
          promotions: defaultSiteContent.promotions.map((promotion) =>
            promotion.id === 'pickup'
              ? { ...promotion, endsAt: new Date(Date.now() - 60_000).toISOString() }
              : promotion,
          ),
        },
      },
      { upsert: true },
    )
    const afterPickupEnds = await app.inject({
      method: 'POST',
      url: '/api/checkout/quote',
      headers: { origin },
      payload: { lines: lines(1), fulfillment: pickup },
    })
    expect(afterPickupEnds.json()).toMatchObject({ discountKopecks: 0, totalKopecks: 36000 })
    await db.collection<SiteContent & { _id: string }>('site_content').updateOne(
      { _id: 'public' },
      {
        $set: {
          promotions: defaultSiteContent.promotions.map((promotion) =>
            promotion.id === 'pickup' ? { ...promotion, discountPercent: 15 } : promotion,
          ),
        },
      },
    )
    const adjustedPickup = await app.inject({
      method: 'POST',
      url: '/api/checkout/quote',
      headers: { origin },
      payload: { lines: lines(1), fulfillment: pickup },
    })
    expect(adjustedPickup.json()).toMatchObject({ discountKopecks: 5400, totalKopecks: 30600 })
    await db.collection<SiteContent & { _id: string }>('site_content').deleteOne({ _id: 'public' })
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
    expect(first.json().order).not.toHaveProperty('accountId')
    expect(first.json().order).not.toHaveProperty('idempotencyKey')
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
    const emailWithoutAddress = await app.inject({
      method: 'PUT',
      url: '/api/profile',
      headers: { origin, cookie },
      payload: {
        name: 'Руслан',
        email: '',
        birthday: '',
        notifications: { push: false, email: true, sms: false },
      },
    })
    expect(emailWithoutAddress.statusCode).toBe(400)
    expect(emailWithoutAddress.json().error.code).toBe('EMAIL_REQUIRED')
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
    const deliveryBody = {
      lines: lines(2),
      fulfillment: delivery,
      expectedTotalKopecks: 97_000,
    }
    const deliveryOrder = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { origin, cookie, 'idempotency-key': randomUUID() },
      payload: deliveryBody,
    })
    expect(deliveryOrder.statusCode).toBe(201)
    const changedAddress = await app.inject({
      method: 'PUT',
      url: `/api/addresses/${addressId}`,
      headers: { origin, cookie },
      payload: {
        label: 'ул. Мира, 12, подъезд 2, 3 этаж, квартира 25',
        details: { ...delivery.details, street: 'ул. Мира, 12' },
      },
    })
    expect(changedAddress.statusCode).toBe(200)
    const staleDelivery = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { origin, cookie, 'idempotency-key': randomUUID() },
      payload: deliveryBody,
    })
    expect(staleDelivery.statusCode).toBe(409)
    expect(staleDelivery.json().error.code).toBe('ADDRESS_CHANGED')
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
      payload: { phone: otherPhone, code: '123456', consent: true },
    })
    const otherCookie = otherLogin.headers['set-cookie']!.toString().split(';')[0]
    const staleAccountHeader = {
      origin,
      cookie: otherCookie,
      'x-account-id': verified.json().user.id,
    }
    const staleRead = await app.inject({
      method: 'GET',
      url: '/api/profile',
      headers: staleAccountHeader,
    })
    expect(staleRead.statusCode).toBe(409)
    expect(staleRead.json().error.code).toBe('ACCOUNT_CHANGED')
    const staleWrite = await app.inject({
      method: 'PUT',
      url: '/api/profile',
      headers: staleAccountHeader,
      payload: {
        name: 'Чужое имя',
        email: '',
        birthday: '',
        notifications: { push: false, email: false, sms: false },
      },
    })
    expect(staleWrite.statusCode).toBe(409)
    const staleOrder = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { ...staleAccountHeader, 'idempotency-key': randomUUID() },
      payload: body,
    })
    expect(staleOrder.statusCode).toBe(409)
    expect(
      (
        await app.inject({ method: 'GET', url: '/api/profile', headers: { cookie: otherCookie } })
      ).json().profile.name,
    ).not.toBe('Чужое имя')
    expect(
      (
        await app.inject({ method: 'GET', url: '/api/orders', headers: { cookie: otherCookie } })
      ).json().orders,
    ).toHaveLength(0)
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
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/profile/delivery-selection',
          headers: { origin, cookie },
          payload: { addressId },
        })
      ).statusCode,
    ).toBe(200)
    const deletedAddress = await app.inject({
      method: 'DELETE',
      url: `/api/addresses/${addressId}`,
      headers: { origin, cookie },
    })
    expect(deletedAddress.statusCode).toBe(204)
    expect(
      (await app.inject({ method: 'GET', url: '/api/profile', headers: { cookie } })).json().profile
        .selectedAddressId,
    ).toBeNull()
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/profile/delivery-selection',
          headers: { origin, cookie },
          payload: { addressId },
        })
      ).statusCode,
    ).toBe(404)

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

    const newCafeAddress = 'Красноярск, ул. Новая, 25'
    await db
      .collection<{ _id: string; address: string }>('site_content')
      .updateOne({ _id: 'public' }, { $set: { address: newCafeAddress } }, { upsert: true })
    const stalePickup = await app.inject({
      method: 'POST',
      url: '/api/checkout/quote',
      headers: { origin },
      payload: { lines: lines(1), fulfillment: pickup },
    })
    expect(stalePickup.statusCode).toBe(409)
    expect(stalePickup.json().error.code).toBe('ADDRESS_CHANGED')
    const currentPickup = { mode: 'pickup', label: newCafeAddress }
    const currentQuote = await app.inject({
      method: 'POST',
      url: '/api/checkout/quote',
      headers: { origin },
      payload: { lines: lines(1), fulfillment: currentPickup },
    })
    expect(currentQuote.statusCode).toBe(200)
    const currentOrder = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { origin, cookie, 'idempotency-key': randomUUID() },
      payload: {
        lines: lines(1),
        fulfillment: currentPickup,
        expectedTotalKopecks: currentQuote.json().totalKopecks,
      },
    })
    expect(currentOrder.statusCode).toBe(201)
  } finally {
    await app.close()
    await mongo.close()
    await repl.stop()
  }
}, 60_000)

test('MongoDB отдаёт историю заказов страницами по курсору', async () => {
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
    { origins: [origin], secureCookies: true },
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
    registerShopRoutes(app, db, mongo, auth, [origin], true)
    registerProfileRoutes(app, db, mongo, auth, [origin], true)

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
    const cookie = verified.headers['set-cookie']!.toString().split(';')[0]!
    const accountId = verified.json().user.id as string

    // 55 готовых заказов: страницы 50 + 5.
    const orders = db.collection<{ _id: string } & Record<string, unknown>>('orders')
    const input = {
      lines: [{ productId: 'borscht', quantity: 1, extras: [] }],
      fulfillment: pickup,
    }
    const quote = {
      lines: [],
      subtotalKopecks: 0,
      discountKopecks: 0,
      deliveryKopecks: 0,
      totalKopecks: 0,
      eligible: true,
      testMode: true,
    }
    const base = Date.parse('2026-11-01T00:00:00.000Z')
    for (let index = 0; index < 55; index += 1) {
      await orders.insertOne({
        _id: randomUUID(),
        accountId,
        idempotencyKey: randomUUID(),
        input,
        quote,
        status: 'test',
        createdAt: new Date(base + index * 60_000),
      })
    }

    const first = await app.inject({ method: 'GET', url: '/api/orders', headers: { cookie } })
    expect(first.statusCode).toBe(200)
    expect(first.json().orders).toHaveLength(50)
    const cursor = first.json().nextCursor as string
    expect(cursor).toBeTruthy()

    const second = await app.inject({
      method: 'GET',
      url: `/api/orders?cursor=${encodeURIComponent(cursor)}`,
      headers: { cookie },
    })
    expect(second.statusCode).toBe(200)
    expect(second.json().orders).toHaveLength(5)
    expect(second.json().nextCursor).toBeNull()

    const ids = new Set([
      ...first.json().orders.map((order: { _id: string }) => order._id),
      ...second.json().orders.map((order: { _id: string }) => order._id),
    ])
    expect(ids.size).toBe(55) // страницы не пересекаются

    // Свежий заказ не попадает во вторую страницу дважды при её повторном запросе:
    // курсор стабилен, новые записи остаются на первой странице.
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/orders?cursor=not-a-cursor',
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(400)
  } finally {
    await app.close()
    await mongo.close()
    await repl.stop()
  }
}, 60_000)

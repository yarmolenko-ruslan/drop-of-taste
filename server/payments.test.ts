// @vitest-environment node
import { randomUUID } from 'node:crypto'
import type { BonusCode } from '../shared/bonus-code.ts'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MongoClient } from 'mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { createApp } from './app.ts'
import { createMongoAuthStore, ensureAuthIndexes } from './auth/mongo-store.ts'
import { createAuthService } from './auth/service.ts'
import { seedCatalog } from './catalog/mongo-catalog.ts'
import { ensureShopIndexes, registerShopRoutes } from './shop.ts'
import type { PaymentGateway, YooPayment } from './yookassa.ts'

const origin = 'http://localhost:5173'
const pickup = { mode: 'pickup', label: 'г. Красноярск, улица Петра Подзолкова, 3и' }

test('тестовая оплата создаётся один раз по серверной сумме и подтверждается через API ЮKassa', async () => {
  const repl = await MongoMemoryReplSet.create({
    binary: { downloadDir: join(tmpdir(), 'drop-of-taste-mongodb') },
    replSet: { count: 1 },
  })
  const mongo = new MongoClient(repl.getUri())
  await mongo.connect()
  const db = mongo.db(`test_${randomUUID().replaceAll('-', '')}`)
  const auth = createAuthService({
    store: createMongoAuthStore(mongo, db),
    sender: { async send() {} },
    secret: 'payment-test-secret',
    developmentCode: '123456',
  })
  const app = createApp(auth, { origins: [origin], secureCookies: true })
  let providerStatus: YooPayment['status'] = 'pending'
  const payment = (): YooPayment => ({
    id: 'test-payment-1',
    status: providerStatus,
    paid: providerStatus === 'succeeded',
    test: true,
    amount: { value: '324.00', currency: 'RUB' },
    confirmation: { confirmation_url: 'https://yoomoney.ru/test-payment' },
  })
  const gateway: PaymentGateway = {
    create: vi.fn(async () => payment()),
    get: vi.fn(async () => payment()),
  }
  try {
    await ensureAuthIndexes(db)
    await seedCatalog(db)
    await ensureShopIndexes(db)
    registerShopRoutes(app, db, mongo, auth, [origin], true, gateway)
    await app.inject({
      method: 'POST',
      url: '/api/auth/request-code',
      headers: { origin },
      payload: { phone: '+79991234567' },
    })
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-code',
      headers: { origin },
      payload: { phone: '+79991234567', code: '123456', consent: true },
    })
    const cookie = login.headers['set-cookie']!.toString().split(';')[0]
    const order = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { origin, cookie, 'idempotency-key': randomUUID() },
      payload: {
        lines: [{ productId: 'borscht', quantity: 1, extras: [] }],
        fulfillment: pickup,
        expectedTotalKopecks: 32400,
      },
    })
    expect(order.statusCode).toBe(201)
    const id = order.json().order._id as string
    await app.inject({
      method: 'POST',
      url: '/api/auth/request-code',
      headers: { origin },
      payload: { phone: '+79991234568' },
    })
    const otherLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-code',
      headers: { origin },
      payload: { phone: '+79991234568', code: '123456', consent: true },
    })
    const otherCookie = otherLogin.headers['set-cookie']!.toString().split(';')[0]
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/orders/${id}/pay`,
          headers: { origin, cookie: otherCookie },
        })
      ).statusCode,
    ).toBe(404)
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/orders/${id}/payment`,
          headers: { cookie: otherCookie },
        })
      ).statusCode,
    ).toBe(404)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/orders/${id}/complete`,
          headers: { origin, cookie },
        })
      ).statusCode,
    ).toBe(409)
    const pay = () =>
      app.inject({
        method: 'POST',
        url: `/api/orders/${id}/pay`,
        headers: { origin, cookie },
      })
    const first = await pay()
    expect(first.statusCode).toBe(200)
    expect(first.json().confirmationUrl).toBe('https://yoomoney.ru/test-payment')
    expect(gateway.create).toHaveBeenCalledWith(id, 32400, `${origin}/payment/return?orderId=${id}`)
    expect((await pay()).json().confirmationUrl).toBe(first.json().confirmationUrl)
    expect(gateway.create).toHaveBeenCalledTimes(1)
    expect((await app.inject({ method: 'GET', url: `/api/orders/${id}/payment` })).statusCode).toBe(
      401,
    )
    providerStatus = 'succeeded'
    const [paidByPay, paidByCheck] = await Promise.all([
      pay(),
      app.inject({ method: 'GET', url: `/api/orders/${id}/payment`, headers: { cookie } }),
    ])
    expect(paidByPay.json()).toEqual({ status: 'succeeded' })
    expect(paidByCheck.json()).toEqual({ status: 'succeeded' })
    const stored = await db
      .collection<{ _id: string; payment?: { status: string } }>('orders')
      .findOne({ _id: id })
    expect(stored?.payment?.status).toBe('succeeded')
    expect(
      (await db.collection('payment_events').find({ orderId: id }).toArray()).map(
        (event) => event.status,
      ),
    ).toEqual(['creating', 'pending', 'succeeded'])
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/orders/${id}/complete`,
          headers: { origin, cookie },
        })
      ).statusCode,
    ).toBe(200)
    await db.collection<BonusCode>('bonus_codes').insertOne({
      _id: 'FREE100',
      kind: 'percent',
      value: 100,
      startsAt: new Date(Date.now() - 60_000).toISOString(),
      endsAt: new Date(Date.now() + 60_000).toISOString(),
      active: true,
    })
    const freeOrder = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { origin, cookie, 'idempotency-key': randomUUID() },
      payload: {
        lines: [{ productId: 'borscht', quantity: 1, extras: [] }],
        fulfillment: pickup,
        promoCode: 'FREE100',
        expectedTotalKopecks: 0,
      },
    })
    expect(freeOrder.statusCode).toBe(201)
    const freeId = freeOrder.json().order._id as string
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/orders/${freeId}/complete`,
          headers: { origin, cookie },
        })
      ).statusCode,
    ).toBe(200)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/orders/${freeId}/complete`,
          headers: { origin, cookie },
        })
      ).statusCode,
    ).toBe(200)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/orders/${freeId}/pay`,
          headers: { origin, cookie },
        })
      ).statusCode,
    ).toBe(409)
    expect((await pay()).statusCode).toBe(409)
    expect(gateway.create).toHaveBeenCalledTimes(1)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/orders/${id}/pay`,
          headers: { origin: 'http://evil.example', cookie },
        })
      ).statusCode,
    ).toBe(403)

    const secondOrder = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { origin, cookie, 'idempotency-key': randomUUID() },
      payload: {
        lines: [{ productId: 'borscht', quantity: 1, extras: [] }],
        fulfillment: pickup,
        expectedTotalKopecks: 32400,
      },
    })
    const secondId = secondOrder.json().order._id as string
    vi.mocked(gateway.create).mockResolvedValueOnce({
      ...payment(),
      amount: { value: '999.00', currency: 'RUB' },
    })
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/orders/${secondId}/pay`,
          headers: { origin, cookie },
        })
      ).statusCode,
    ).toBe(502)
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/orders/${secondId}/payment`,
          headers: { cookie },
        })
      ).json(),
    ).toEqual({ status: 'error' })

    const thirdOrder = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { origin, cookie, 'idempotency-key': randomUUID() },
      payload: {
        lines: [{ productId: 'borscht', quantity: 1, extras: [] }],
        fulfillment: pickup,
        expectedTotalKopecks: 32400,
      },
    })
    const thirdId = thirdOrder.json().order._id as string
    providerStatus = 'pending'
    let finishCreate!: (value: YooPayment) => void
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    vi.mocked(gateway.create).mockImplementationOnce(() => {
      markStarted()
      return new Promise<YooPayment>((resolve) => {
        finishCreate = resolve
      })
    })
    const firstAttempt = app.inject({
      method: 'POST',
      url: `/api/orders/${thirdId}/pay`,
      headers: { origin, cookie },
    })
    await started
    const simultaneous = await app.inject({
      method: 'POST',
      url: `/api/orders/${thirdId}/pay`,
      headers: { origin, cookie },
    })
    expect(simultaneous.statusCode).toBe(409)
    finishCreate(payment())
    expect((await firstAttempt).statusCode).toBe(200)
  } finally {
    await app.close()
    await mongo.close()
    await repl.stop()
  }
}, 60_000)

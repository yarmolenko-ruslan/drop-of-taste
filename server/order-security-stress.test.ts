// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { MongoClient, type Document } from 'mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { createApp } from './app.ts'
import { ensureShopIndexes, registerShopRoutes } from './shop.ts'
import type { AuthService } from './auth/service.ts'
import type { PaymentGateway, YooPayment } from './yookassa.ts'
import { PAYMENT_WINDOW_MS } from '../shared/order-payment.ts'

const origin = 'http://localhost:5173'
const headers = { origin, cookie: 'dev_session=valid-u1', 'x-account-id': 'u1' }
let replica: MongoMemoryReplSet
let mongo: MongoClient
beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({
    binary: { downloadDir: join(tmpdir(), 'drop-of-taste-mongodb') },
    replSet: { count: 1 },
  })
  mongo = new MongoClient(replica.getUri())
  await mongo.connect()
}, 20000)
afterAll(async () => {
  await mongo?.close()
  await replica?.stop()
})
afterEach(() => vi.useRealTimers())

function remote(id = 'payment-1', extra: Partial<YooPayment> = {}): YooPayment {
  return {
    id,
    status: 'pending',
    paid: false,
    test: true,
    amount: { value: '324.00', currency: 'RUB' },
    confirmation: { confirmation_url: 'https://yoomoney.ru/test-payment' },
    ...extra,
  }
}
function stored(id = 'order-1', age = 0, extra: Document = {}) {
  const now = new Date()
  return {
    _id: id,
    accountId: 'u1',
    idempotencyKey: id,
    status: 'test',
    requiresPayment: true,
    fulfillmentStatus: 'new',
    createdAt: new Date(now.getTime() - age),
    input: { fulfillment: { mode: 'pickup', label: 'Кафе' } },
    quote: { lines: [], totalKopecks: 32400, discountKopecks: 0, deliveryKopecks: 0 },
    ...extra,
  }
}
const pendingPayment = (id = 'payment-1') => ({
  id,
  status: 'pending',
  attemptKey: 'order-1',
  createdAt: new Date(),
  updatedAt: new Date(),
  confirmationUrl: 'https://yoomoney.ru/test-payment',
})
async function setup(gateway?: PaymentGateway, initialOrders: ReturnType<typeof stored>[] = []) {
  const db = mongo.db(`stress_${randomUUID().replaceAll('-', '')}`)
  await ensureShopIndexes(db)
  const auth = {
    getAccount: async (token?: string) => (token === 'valid-u1' ? { id: 'u1' } : null),
  } as unknown as AuthService
  const app = createApp(auth, { origins: [origin], secureCookies: false })
  registerShopRoutes(app, db, mongo, auth, [origin], false, gateway)
  if (initialOrders.length)
    await db.collection<Document & { _id: string }>('orders').insertMany(initialOrders)
  await app.ready()
  // Дожидаемся первого пустого прохода фонового задания перед наполнением сценария.
  await app.inject({ method: 'GET', url: '/api/orders', headers })
  const orders = db.collection<Document & { _id: string }>('orders')
  return { app, db, orders }
}

test('1000 запросов без прав, чужие ID, подмена аккаунта и NoSQL-входы не меняют заказы', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  const gateway = { create: vi.fn(), get: vi.fn(async () => remote()) }
  const { app, orders } = await setup(gateway)
  try {
    await orders.insertOne(
      stored('victim', PAYMENT_WINDOW_MS + 1000, { accountId: 'u2', payment: pendingPayment() }),
    )
    const start = performance.now()
    const responses = await Promise.all(
      Array.from({ length: 1000 }, (_, index) => {
        switch (index % 5) {
          case 0:
            return app.inject({
              method: 'GET',
              url: '/api/orders',
              headers: { cookie: 'dev_session=forged' },
            })
          case 1:
            return app.inject({ method: 'POST', url: '/api/orders/victim/pay', headers })
          case 2:
            return app.inject({ method: 'POST', url: '/api/orders/victim/cancel', headers })
          case 3:
            return app.inject({ method: 'POST', url: '/api/orders/victim/complete', headers })
          default:
            return app.inject({ method: 'GET', url: '/api/orders/victim/payment', headers })
        }
      }),
    )
    expect(
      responses.every((response, index) => response.statusCode === (index % 5 === 0 ? 401 : 404)),
    ).toBe(true)
    expect(gateway.get).not.toHaveBeenCalled()
    expect(gateway.create).not.toHaveBeenCalled()
    expect((await orders.findOne({ _id: 'victim' }))?.canceledAt).toBeUndefined()
    for (const ids of [[{ $ne: null }], Array(201).fill('victim'), ['x'.repeat(101)], []]) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/orders/statuses',
        headers,
        payload: { ids },
      })
      expect(response.statusCode).toBe(400)
    }
    const leaked = await app.inject({
      method: 'POST',
      url: '/api/orders/statuses',
      headers,
      payload: { ids: ['victim'] },
    })
    expect(leaked.json()).toEqual({ statuses: [] })
    const changedAccount = await app.inject({
      method: 'POST',
      url: '/api/orders/victim/pay',
      headers: { ...headers, 'x-account-id': 'u2' },
    })
    expect(changedAccount.statusCode).toBe(409)
    for (const badOrigin of [
      'https://attacker.example',
      'null',
      'http://localhost.attacker.example',
      'https://localhost',
    ]) {
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/orders/victim/pay',
            headers: { ...headers, origin: badOrigin },
          })
        ).statusCode,
      ).toBe(403)
    }
    const oversized = await app.inject({
      method: 'POST',
      url: '/api/orders/statuses',
      headers,
      payload: { ids: ['x'.repeat(70000)] },
    })
    expect(oversized.statusCode).toBe(413)
    for (const cursor of [
      'null',
      '{}',
      JSON.stringify({ d: new Date().toISOString(), i: { $gt: '' } }),
    ]) {
      expect(
        (
          await app.inject({
            method: 'GET',
            url: `/api/orders?cursor=${Buffer.from(cursor).toString('base64url')}`,
            headers,
          })
        ).statusCode,
      ).toBe(400)
    }
    console.info(
      `security stress: 1000 denied requests in ${Math.round(performance.now() - start)} ms; provider calls: 0`,
    )
  } finally {
    await app.close()
  }
}, 20000)

test('100 параллельных попыток оплаты создают один платёж и одну цепочку событий', async () => {
  let release!: (payment: YooPayment) => void
  const gateway = {
    create: vi.fn(
      () =>
        new Promise<YooPayment>((resolve) => {
          release = resolve
        }),
    ),
    get: vi.fn(async () => remote()),
  }
  const { app, orders, db } = await setup(gateway)
  try {
    await orders.insertOne(stored())
    const requests = Array.from({ length: 100 }, () =>
      app.inject({ method: 'POST', url: '/api/orders/order-1/pay', headers }),
    )
    await vi.waitFor(() => expect(gateway.create).toHaveBeenCalledTimes(1))
    release(remote())
    const responses = await Promise.all(requests)
    expect(responses.every((response) => [200, 409].includes(response.statusCode))).toBe(true)
    expect(gateway.create).toHaveBeenCalledTimes(1)
    expect(await db.collection('payment_events').countDocuments({ status: 'creating' })).toBe(1)
    expect(await db.collection('payment_events').countDocuments({ status: 'pending' })).toBe(1)
    expect((await orders.findOne({ _id: 'order-1' }))?.payment.id).toBe('payment-1')
  } finally {
    release?.(remote())
    await app.close()
  }
}, 20000)

test('500 параллельных запросов статуса не создают параллельные дубли к ЮKassa', async () => {
  let release!: (payment: YooPayment) => void
  const result = new Promise<YooPayment>((resolve) => {
    release = resolve
  })
  let active = 0
  let maxActive = 0
  const gateway = {
    create: vi.fn(),
    get: vi.fn(async () => {
      active++
      maxActive = Math.max(maxActive, active)
      try {
        return await result
      } finally {
        active--
      }
    }),
  }
  const { app, orders } = await setup(gateway)
  try {
    await orders.insertOne(stored('order-1', 0, { payment: pendingPayment() }))
    const responses = Array.from({ length: 500 }, () =>
      app.inject({ method: 'GET', url: '/api/orders/order-1/payment', headers }),
    )
    await vi.waitFor(() => expect(gateway.get).toHaveBeenCalledTimes(1))
    release(remote())
    expect((await Promise.all(responses)).every((response) => response.statusCode === 200)).toBe(
      true,
    )
    expect(maxActive).toBe(1)
  } finally {
    release?.(remote())
    await app.close()
  }
}, 20000)

test('повтор оплаты, начатый за 1 мс до срока, не возвращает ссылку после истечения времени', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  const now = new Date('2026-11-14T12:00:00Z')
  vi.setSystemTime(now)
  let release!: (payment: YooPayment) => void
  const gateway = {
    create: vi.fn(),
    get: vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<YooPayment>((resolve) => {
            release = resolve
          }),
      )
      .mockResolvedValue(remote()),
  }
  const { app, orders } = await setup(gateway)
  try {
    await orders.insertOne(stored('order-1', PAYMENT_WINDOW_MS - 1, { payment: pendingPayment() }))
    const attempt = app.inject({ method: 'POST', url: '/api/orders/order-1/pay', headers })
    await vi.waitFor(() => expect(gateway.get).toHaveBeenCalledTimes(1))
    vi.setSystemTime(new Date(now.getTime() + 1))
    release(remote())
    const response = await attempt
    expect(response.statusCode).toBe(409)
    expect(response.json().error.code).toBe('ORDER_CANCELED')
    expect(response.json().confirmationUrl).toBeUndefined()
    expect((await orders.findOne({ _id: 'order-1' }))?.canceledAt).toBeTruthy()
  } finally {
    release?.(remote())
    await app.close()
  }
})

test('проверка платежа через границу срока возвращает отмену в том же ответе', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  const now = new Date('2026-11-14T12:00:00Z')
  vi.setSystemTime(now)
  let release!: (payment: YooPayment) => void
  const gateway = {
    create: vi.fn(),
    get: vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<YooPayment>((resolve) => {
            release = resolve
          }),
      )
      .mockResolvedValue(remote()),
  }
  const { app, orders } = await setup(gateway)
  try {
    await orders.insertOne(stored('order-1', PAYMENT_WINDOW_MS - 1, { payment: pendingPayment() }))
    const check = app.inject({ method: 'GET', url: '/api/orders/order-1/payment', headers })
    await vi.waitFor(() => expect(gateway.get).toHaveBeenCalledTimes(1))
    vi.setSystemTime(new Date(now.getTime() + 1))
    release(remote())
    expect((await check).json()).toEqual({
      status: 'pending',
      orderCanceled: true,
      canceledAt: new Date(now.getTime() + 1).toISOString(),
    })
  } finally {
    release?.(remote())
    await app.close()
  }
})

test('отключение провайдера не разрешает завершить неоплаченный онлайн-заказ', async () => {
  const { app, orders } = await setup()
  try {
    await orders.insertMany([
      stored(),
      stored('offline', 0, { requiresPayment: false }),
      stored('free', 0, { requiresPayment: false, quote: { totalKopecks: 0 } }),
    ])
    expect(
      (await app.inject({ method: 'POST', url: '/api/orders/order-1/complete', headers }))
        .statusCode,
    ).toBe(409)
    expect((await orders.findOne({ _id: 'order-1' }))?.status).toBe('test')
    for (const id of ['offline', 'free'])
      expect(
        (await app.inject({ method: 'POST', url: `/api/orders/${id}/complete`, headers }))
          .statusCode,
      ).toBe(200)
  } finally {
    await app.close()
  }
})

test('старый отказ создания платежа не перезаписывает новую попытку', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  const now = new Date('2026-11-14T12:00:00Z')
  vi.setSystemTime(now)
  let rejectOld!: (error: Error) => void
  let releaseNew!: (payment: YooPayment) => void
  const gateway = {
    create: vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectOld = reject
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<YooPayment>((resolve) => {
            releaseNew = resolve
          }),
      ),
    get: vi.fn(async () => remote()),
  }
  const { app, orders } = await setup(gateway)
  try {
    await orders.insertOne(stored())
    const first = app.inject({ method: 'POST', url: '/api/orders/order-1/pay', headers })
    await vi.waitFor(() => expect(gateway.create).toHaveBeenCalledTimes(1))
    vi.setSystemTime(new Date(now.getTime() + 31000))
    const second = app.inject({ method: 'POST', url: '/api/orders/order-1/pay', headers })
    await vi.waitFor(() => expect(gateway.create).toHaveBeenCalledTimes(2))
    rejectOld(new Error('provider timeout'))
    expect((await first).statusCode).toBe(502)
    expect((await orders.findOne({ _id: 'order-1' }))?.payment.status).toBe('creating')
    releaseNew(remote())
    expect((await second).statusCode).toBe(200)
    expect((await orders.findOne({ _id: 'order-1' }))?.payment.status).toBe('pending')
  } finally {
    releaseNew?.(remote())
    await app.close()
  }
})

test.each([
  ['вовремя', -1, false],
  ['на границе', 0, true],
  ['позже', 1, true],
] as const)(
  'задержанный ответ успешной оплаты: %s определяется по времени списания',
  async (_label, offset, canceled) => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    const now = new Date('2026-11-14T12:00:00Z')
    vi.setSystemTime(now)
    const gateway = {
      create: vi.fn(),
      get: vi.fn(async () =>
        remote('payment-1', {
          status: 'succeeded',
          paid: true,
          captured_at: new Date(now.getTime() + offset).toISOString(),
        }),
      ),
    }
    const { app, orders } = await setup(gateway)
    try {
      await orders.insertOne(
        stored('order-1', PAYMENT_WINDOW_MS, { payment: pendingPayment(), canceledAt: now }),
      )
      const response = await app.inject({
        method: 'GET',
        url: '/api/orders/order-1/payment',
        headers,
      })
      expect(response.json().status).toBe('succeeded')
      expect(Boolean(response.json().orderCanceled)).toBe(canceled)
      expect(Boolean((await orders.findOne({ _id: 'order-1' }))?.canceledAt)).toBe(canceled)
    } finally {
      await app.close()
    }
  },
)

test('2000 просроченных заказов обрабатываются порциями, не задерживая другой аккаунт', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  const { app, orders, db } = await setup({ create: vi.fn(), get: vi.fn(async () => remote()) })
  try {
    await orders.insertMany(
      Array.from({ length: 2000 }, (_, index) =>
        stored(`backlog-${index.toString().padStart(4, '0')}`, PAYMENT_WINDOW_MS + 60000, {
          accountId: 'u2',
        }),
      ),
    )
    await vi.advanceTimersByTimeAsync(5000)
    const response = await app.inject({ method: 'GET', url: '/api/orders', headers })
    expect(response.statusCode).toBe(200)
    expect(response.json().orders).toEqual([])
    await vi.waitFor(async () =>
      expect(await orders.countDocuments({ canceledAt: { $exists: true } })).toBe(100),
    )
    // Следующий проход продвигает очередь; не повторяет первые 100 записей.
    await vi.waitFor(
      async () => {
        await vi.advanceTimersByTimeAsync(5000)
        expect(
          await orders.countDocuments({ canceledAt: { $exists: true } }),
        ).toBeGreaterThanOrEqual(200)
      },
      { timeout: 5000 },
    )
    await vi.waitFor(
      async () => {
        await vi.advanceTimersByTimeAsync(5000)
        expect(await orders.countDocuments({ canceledAt: { $exists: true } })).toBe(2000)
      },
      { timeout: 25000, interval: 50 },
    )
    await vi.waitFor(async () =>
      expect(
        await db.collection('payment_events').countDocuments({ status: 'order_canceled' }),
      ).toBe(2000),
    )
    const duplicates = await db
      .collection('payment_events')
      .aggregate([
        { $match: { status: 'order_canceled' } },
        { $group: { _id: '$orderId', count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } },
      ])
      .toArray()
    expect(duplicates).toEqual([])
  } finally {
    await app.close()
  }
}, 40000)

test('медленная проверка чужого просроченного платежа не задерживает запуск и кабинет', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  let release!: (payment: YooPayment) => void
  const gateway = {
    create: vi.fn(),
    get: vi.fn(
      () =>
        new Promise<YooPayment>((resolve) => {
          release = resolve
        }),
    ),
  }
  const { app } = await setup(gateway, [
    stored('slow-other', PAYMENT_WINDOW_MS + 1000, { accountId: 'u2', payment: pendingPayment() }),
  ])
  try {
    await vi.waitFor(() => expect(gateway.get).toHaveBeenCalledTimes(1))
    const response = await app.inject({ method: 'GET', url: '/api/orders', headers })
    expect(response.statusCode).toBe(200)
    expect(response.json().orders).toEqual([])
    expect((await app.inject({ method: 'GET', url: '/api/orders' })).statusCode).toBe(401)
  } finally {
    // Тот же результат нужен и отдельному фоновому проходу сверки после отмены.
    gateway.get.mockImplementation(async () => remote())
    release?.(remote())
    await app.close()
  }
}, 20000)

test('несовпадение суммы или ID провайдера не подтверждает оплату и не освобождает резерв скидки', async () => {
  const gateway = {
    create: vi.fn(),
    get: vi.fn(async () =>
      remote('wrong-id', {
        status: 'succeeded',
        paid: true,
        amount: { value: '1.00', currency: 'RUB' },
      }),
    ),
  }
  const { app, orders, db } = await setup(gateway)
  try {
    const original = stored('order-1', PAYMENT_WINDOW_MS + 1000, { payment: pendingPayment() })
    original.quote = { ...original.quote, birthdayYear: 2026 } as typeof original.quote
    await orders.insertOne(original)
    await db.collection<Document & { _id: string }>('birthday_claims').insertOne({
      _id: 'u1:2026',
      accountId: 'u1',
      year: 2026,
      orderId: 'order-1',
      state: 'reserved',
    })
    const response = await app.inject({ method: 'GET', url: '/api/orders', headers })
    expect(response.statusCode).toBe(200)
    const saved = await orders.findOne({ _id: 'order-1' })
    expect(saved?.payment.status).toBe('pending')
    expect(saved?.canceledAt).toBeTruthy()
    expect(await db.collection('birthday_claims').countDocuments({ state: 'reserved' })).toBe(1)
    expect(
      (await app.inject({ method: 'POST', url: '/api/orders/order-1/complete', headers }))
        .statusCode,
    ).toBe(409)
  } finally {
    await app.close()
  }
})

test('запаздавший успешный create сохраняет ID, даже если следующая попытка завершится ошибкой', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  const now = new Date('2026-11-14T12:00:00Z')
  vi.setSystemTime(now)
  let releaseOld!: (payment: YooPayment) => void
  let rejectNew!: (error: Error) => void
  const captured = remote('payment-1', {
    status: 'succeeded',
    paid: true,
    captured_at: now.toISOString(),
  })
  const gateway = {
    create: vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<YooPayment>((resolve) => {
            releaseOld = resolve
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectNew = reject
          }),
      ),
    get: vi.fn(async () => captured),
  }
  const { app, orders } = await setup(gateway)
  try {
    await orders.insertOne(stored())
    const first = app.inject({ method: 'POST', url: '/api/orders/order-1/pay', headers })
    await vi.waitFor(() => expect(gateway.create).toHaveBeenCalledTimes(1))
    vi.setSystemTime(new Date(now.getTime() + 31000))
    const second = app.inject({ method: 'POST', url: '/api/orders/order-1/pay', headers })
    await vi.waitFor(() => expect(gateway.create).toHaveBeenCalledTimes(2))
    releaseOld(captured)
    expect((await first).statusCode).toBe(409)
    expect((await orders.findOne({ _id: 'order-1' }))?.payment.id).toBe('payment-1')
    rejectNew(new Error('provider timeout'))
    expect((await second).statusCode).toBe(502)
    const recovered = await app.inject({
      method: 'GET',
      url: '/api/orders/order-1/payment',
      headers,
    })
    expect(recovered.json().status).toBe('succeeded')
    expect(recovered.json().orderCanceled).toBeUndefined()
    expect((await orders.findOne({ _id: 'order-1' }))?.payment.status).toBe('succeeded')
  } finally {
    releaseOld?.(captured)
    rejectNew?.(new Error('cleanup'))
    await app.close()
  }
})

test('после прерывания между отменой и освобождением скидки резерв освобождается повторно безопасно', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  const { app, orders, db } = await setup({ create: vi.fn(), get: vi.fn(async () => remote()) })
  try {
    const expired = stored('release-after-crash', PAYMENT_WINDOW_MS + 1000, {
      canceledAt: new Date(),
    })
    expired.quote = { ...expired.quote, birthdayYear: 2026 } as typeof expired.quote
    const uncertain = stored('uncertain-payment', PAYMENT_WINDOW_MS + 1000, {
      accountId: 'u2',
      canceledAt: new Date(),
      payment: {
        status: 'error',
        attemptKey: 'uncertain-payment',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    })
    uncertain.quote = { ...uncertain.quote, birthdayYear: 2026 } as typeof uncertain.quote
    await orders.insertMany([expired, uncertain])
    const claims = db.collection<Document & { _id: string }>('birthday_claims')
    await claims.insertMany([
      {
        _id: 'u1:2026',
        orderId: 'release-after-crash',
        accountId: 'u1',
        year: 2026,
        state: 'reserved',
      },
      {
        _id: 'u2:2026',
        orderId: 'uncertain-payment',
        accountId: 'u2',
        year: 2026,
        state: 'reserved',
      },
    ])
    await vi.waitFor(
      async () => {
        await vi.advanceTimersByTimeAsync(5000)
        expect(await claims.findOne({ _id: 'u1:2026' })).toBeNull()
      },
      { timeout: 3000 },
    )
    expect((await claims.findOne({ _id: 'u2:2026' }))?.state).toBe('reserved')
    await vi.waitFor(async () =>
      expect((await orders.findOne({ _id: 'release-after-crash' }))?.birthdayClaimReleased).toBe(
        true,
      ),
    )
  } finally {
    await app.close()
  }
})

test('100 разных заказов не создают больше 4 платежей одновременно и не оставляют ложный резерв', async () => {
  const releases: (() => void)[] = []
  const gateway = {
    create: vi.fn(
      (id: string) =>
        new Promise<YooPayment>((resolve) => {
          releases.push(() => resolve(remote(`payment-${id}`)))
        }),
    ),
    get: vi.fn(async (id: string) => remote(id)),
  }
  const { app, orders } = await setup(gateway)
  try {
    await orders.insertMany(Array.from({ length: 100 }, (_, index) => stored(`unique-${index}`)))
    const completed: number[] = []
    const requests = Array.from({ length: 100 }, (_, index) =>
      app
        .inject({ method: 'POST', url: `/api/orders/unique-${index}/pay`, headers })
        .then((response) => {
          completed.push(response.statusCode)
          return response
        }),
    )
    await vi.waitFor(() => expect(gateway.create).toHaveBeenCalledTimes(4))
    await vi.waitFor(() => expect(completed).toHaveLength(96), { timeout: 5000 })
    expect(completed.every((status) => status === 503)).toBe(true)
    for (const release of releases) release()
    const responses = await Promise.all(requests)
    expect(responses.filter((response) => response.statusCode === 200)).toHaveLength(4)
    expect(await orders.countDocuments({ 'payment.status': 'pending' })).toBe(4)
    expect(await orders.countDocuments({ payment: { $exists: false } })).toBe(96)
    expect(await orders.countDocuments({ 'payment.status': { $in: ['creating', 'error'] } })).toBe(
      0,
    )
  } finally {
    for (const release of releases) release()
    await app.close()
  }
}, 20000)

// @vitest-environment node
import type { MongoClient } from 'mongodb'
import { createApp } from '../../app.ts'
import { registerShopRoutes } from './routes.ts'
import type { AuthService } from '../auth/service.ts'
import type { PaymentGateway, YooPayment } from '../payments/yookassa.ts'
import { memoryDatabase, readField, type TestDocument } from '../../tests/fixtures/memory-db.ts'

const origin = 'http://localhost:5173'
const auth = { getAccount: async () => ({ id: 'u1' }) } as unknown as AuthService
const now = new Date('2026-11-21T10:00:00Z')
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(now)
})
afterEach(() => vi.useRealTimers())
function payment(status: YooPayment['status'], captured_at?: string): YooPayment {
  return {
    id: 'payment-1',
    status,
    paid: status === 'succeeded',
    test: true,
    amount: { value: '450.00', currency: 'RUB' },
    ...(captured_at && { captured_at }),
  }
}
function fixture(state: string, age = 60_000, knownId = true) {
  const order: TestDocument = {
    _id: 'order-1',
    accountId: 'u1',
    status: 'test',
    fulfillmentStatus: 'new',
    requiresPayment: true,
    createdAt: new Date(+now - age),
    quote: { totalKopecks: 45000, birthdayYear: 2026 },
    payment: {
      status: state,
      ...(knownId && { id: 'payment-1' }),
      attemptKey: 'order-1',
      createdAt: new Date(+now - age),
      updatedAt: new Date(+now - age),
    },
  }
  const data = {
    orders: [order],
    birthday_claims: [
      { _id: 'u1:2026', accountId: 'u1', year: 2026, orderId: 'order-1', state: 'reserved' },
    ],
  }
  const gateway: PaymentGateway = {
    create: vi.fn(),
    get: vi.fn(async () => payment('pending')),
    findByOrderId: vi.fn(async () => null),
  }
  const app = createApp(auth, { origins: [origin], secureCookies: false })
  registerShopRoutes(app, memoryDatabase(data), {} as MongoClient, auth, [origin], false, gateway)
  return { app, order, data, gateway }
}

test('фоновая сверка подтверждает недавнюю оплату без запросов от клиента', async () => {
  const { app, order, data, gateway } = fixture('pending')
  vi.mocked(gateway.get).mockResolvedValue(
    payment('succeeded', new Date(+now - 30_000).toISOString()),
  )
  try {
    await app.ready()
    await vi.waitFor(() => expect(readField(order, 'payment.status')).toBe('succeeded'))
    expect(data.birthday_claims[0]?.state).toBe('used')
    expect(order.canceledAt).toBeUndefined()
    const retry = await app.inject({
      method: 'POST',
      url: '/api/orders/order-1/pay',
      headers: { origin },
    })
    expect(retry.json()).toEqual({ status: 'succeeded' })
    expect(gateway.create).not.toHaveBeenCalled()
  } finally {
    await app.close()
  }
})

test.each(['error', 'creating'])(
  'потерянный ID платежа восстанавливается после %s без нового create',
  async (state) => {
    const { app, order, data, gateway } = fixture(state, 60 * 60_000, false)
    vi.mocked(gateway.findByOrderId!).mockResolvedValue(payment('pending'))
    vi.mocked(gateway.get).mockResolvedValue(
      payment('succeeded', new Date(+now - 59 * 60_000).toISOString()),
    )
    try {
      await app.ready()
      await vi.waitFor(() => expect(readField(order, 'payment.id')).toBe('payment-1'))
      await vi.advanceTimersByTimeAsync(5_000)
      await vi.waitFor(() => expect(readField(order, 'payment.status')).toBe('succeeded'))
      expect(data.birthday_claims[0]?.state).toBe('used')
      expect(order.canceledAt).toBeUndefined()
      expect(gateway.create).not.toHaveBeenCalled()
    } finally {
      await app.close()
    }
  },
)

test('отсутствующий у провайдера платёж отменяется и освобождает скидку после срока оплаты', async () => {
  const { app, order, data, gateway } = fixture('error', 24 * 60 * 60_000, false)
  try {
    await app.ready()
    await vi.waitFor(() => expect(readField(order, 'payment.status')).toBe('canceled'))
    expect(data.birthday_claims).toHaveLength(0)
    expect(gateway.findByOrderId).toHaveBeenCalled()
    expect(gateway.create).not.toHaveBeenCalled()
  } finally {
    await app.close()
  }
})

test('сбой сверки не освобождает скидку и повторяется автоматически', async () => {
  const { app, order, data, gateway } = fixture('error', 60 * 60_000, false)
  vi.mocked(gateway.findByOrderId!).mockRejectedValueOnce(new Error('provider offline'))
  try {
    await app.ready()
    await vi.waitFor(() => expect(gateway.findByOrderId).toHaveBeenCalledTimes(1))
    expect(data.birthday_claims).toHaveLength(1)
    expect(readField(order, 'payment.status')).not.toBe('canceled')
    await vi.advanceTimersByTimeAsync(65_000)
    await vi.waitFor(() => expect(data.birthday_claims).toHaveLength(0))
    expect(gateway.create).not.toHaveBeenCalled()
  } finally {
    await app.close()
  }
})

test('свежая попытка создания не считается отсутствующим платежом', async () => {
  const { app, data, gateway } = fixture('creating', 5_000, false)
  try {
    await app.ready()
    await app.inject({ method: 'GET', url: '/api/health' })
    expect(gateway.findByOrderId).not.toHaveBeenCalled()
    expect(data.birthday_claims).toHaveLength(1)
  } finally {
    await app.close()
  }
})

test('сверка и ручной повтор оплаты не создают платёж одновременно', async () => {
  const { app, order, gateway } = fixture('error', 2 * 60_000, false)
  let finish!: (value: YooPayment | null) => void
  vi.mocked(gateway.findByOrderId!).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  vi.mocked(gateway.create).mockResolvedValue({
    ...payment('pending'),
    confirmation: { confirmation_url: 'https://yoomoney.ru/test' },
  })
  try {
    await app.ready()
    await vi.waitFor(() => expect(gateway.findByOrderId).toHaveBeenCalledTimes(1))
    const simultaneous = await app.inject({
      method: 'POST',
      url: '/api/orders/order-1/pay',
      headers: { origin },
    })
    expect(simultaneous.json().error.code).toBe('PAYMENT_STARTING')
    expect(gateway.create).not.toHaveBeenCalled()
    finish(null)
    await vi.waitFor(() => expect(readField(order, 'payment.recoveryUntil')).toBeUndefined())
    const retry = await app.inject({
      method: 'POST',
      url: '/api/orders/order-1/pay',
      headers: { origin },
    })
    expect(retry.statusCode).toBe(200)
    expect(gateway.create).toHaveBeenCalledTimes(1)
  } finally {
    finish?.(null)
    await app.close()
  }
})

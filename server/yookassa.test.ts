// @vitest-environment node
import { createYooGateway } from './yookassa.ts'

afterEach(() => vi.unstubAllGlobals())

test('сервер отправляет точную сумму и ключ идемпотентности в тестовый магазин', async () => {
  const fetchMock = vi.fn(async () =>
    Response.json({
      id: 'payment-1',
      status: 'pending',
      paid: false,
      test: true,
      amount: { value: '324.00', currency: 'RUB' },
      confirmation: { confirmation_url: 'https://yoomoney.ru/test' },
    }),
  )
  vi.stubGlobal('fetch', fetchMock)
  const gateway = createYooGateway('123456', 'test_secret')
  await gateway.create('order-123', 32400, 'http://localhost:5173/payment/return')

  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
  expect(url).toBe('https://api.yookassa.ru/v3/payments')
  expect(init.headers).toMatchObject({ 'Idempotence-Key': 'order-123' })
  expect(JSON.parse(String(init.body))).toMatchObject({
    amount: { value: '324.00', currency: 'RUB' },
    capture: true,
    confirmation: { type: 'redirect', return_url: 'http://localhost:5173/payment/return' },
  })
})

test('не принимает ответ боевого магазина при работе с тестовым ключом', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        id: 'payment-1',
        status: 'succeeded',
        paid: true,
        test: false,
        amount: { value: '324.00', currency: 'RUB' },
      }),
    ),
  )
  await expect(createYooGateway('123456', 'test_secret').get('payment-1')).rejects.toThrow(
    'YOOKASSA_INVALID_RESPONSE',
  )
})

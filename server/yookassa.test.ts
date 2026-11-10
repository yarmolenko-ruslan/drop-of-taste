// @vitest-environment node
import { createYooGateway } from './yookassa.ts'

afterEach(() => vi.unstubAllGlobals())

test('сервер создаёт только тестовый платёж с точной суммой и фиксированным ключом повтора', async () => {
  const fetchMock = vi.fn(async () =>
    Response.json({
      id: 'payment-1',
      status: 'pending',
      paid: false,
      test: true,
      amount: { value: '324.00', currency: 'RUB' },
      confirmation: { confirmation_url: 'https://yoomoney.ru/payment-1' },
    }),
  )
  vi.stubGlobal('fetch', fetchMock)
  const gateway = createYooGateway('1522340', 'test_example')
  await gateway.create('order-1', 32400, 'http://localhost:5173/payment/return?orderId=order-1')
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
  expect(url).toBe('https://api.yookassa.ru/v3/payments')
  expect(init.headers).toMatchObject({ 'Idempotence-Key': 'order-1' })
  expect(JSON.parse(init.body as string)).toMatchObject({
    amount: { value: '324.00', currency: 'RUB' },
    capture: true,
    confirmation: {
      type: 'redirect',
      return_url: 'http://localhost:5173/payment/return?orderId=order-1',
    },
  })
})

test('боевой ответ ЮKassa не принимается в локальном тестовом режиме', async () => {
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
  await expect(createYooGateway('1522340', 'test_example').get('payment-1')).rejects.toThrow(
    'YOOKASSA_INVALID_RESPONSE',
  )
  expect(() => createYooGateway('1522340', 'live_secret')).toThrow()
})

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

const listedPayment = (id: string, orderId: string) => ({
  id,
  status: 'pending',
  paid: false,
  test: true,
  amount: { value: '324.00', currency: 'RUB' },
  metadata: { order_id: orderId },
})

test('находит потерянный ID по metadata на всех страницах, используя только GET', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        type: 'list',
        items: [listedPayment('unrelated', 'other')],
        next_cursor: 'next-page',
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        type: 'list',
        items: [listedPayment('recovered', 'order-123')],
      }),
    )
  vi.stubGlobal('fetch', fetchMock)
  const gateway = createYooGateway('123456', 'test_secret')
  const from = new Date('2026-11-21T10:00:00Z')
  const until = new Date('2026-11-21T10:20:00Z')
  await expect(gateway.findByOrderId!('order-123', from, until)).resolves.toMatchObject({
    id: 'recovered',
  })
  expect(fetchMock).toHaveBeenCalledTimes(2)
  for (const [url, init] of fetchMock.mock.calls) {
    const parsed = new URL(url)
    expect(parsed.pathname).toBe('/v3/payments')
    expect(parsed.searchParams.get('created_at.gte')).toBe(from.toISOString())
    expect(parsed.searchParams.get('created_at.lte')).toBe(until.toISOString())
    expect(init.method ?? 'GET').toBe('GET')
  }
  expect(new URL(fetchMock.mock.calls[1]![0]).searchParams.get('cursor')).toBe('next-page')
})

test.each(['incomplete', 'invalid', 'duplicate', 'unavailable'])(
  'нельзя считать платёж отсутствующим при ошибке сверки: %s',
  async (mode) => {
    const fetchMock = vi.fn(async () => {
      if (mode === 'unavailable') return new Response('', { status: 503 })
      if (mode === 'invalid') return Response.json({ items: 'invalid' })
      if (mode === 'duplicate')
        return Response.json({
          type: 'list',
          items: [listedPayment('a', 'order-123'), listedPayment('b', 'order-123')],
        })
      return Response.json({ type: 'list', items: [], next_cursor: 'same-cursor' })
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      createYooGateway('123456', 'test_secret').findByOrderId!(
        'order-123',
        new Date('2026-11-21T10:00:00Z'),
        new Date('2026-11-21T10:20:00Z'),
      ),
    ).rejects.toThrow()
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(20)
  },
)

test('возвращает отсутствие только после полной успешной сверки', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ type: 'list', items: [] })),
  )
  await expect(
    createYooGateway('123456', 'test_secret').findByOrderId!(
      'order-123',
      new Date('2026-11-21T10:00:00Z'),
      new Date('2026-11-21T10:20:00Z'),
    ),
  ).resolves.toBeNull()
})

import { z } from 'zod'

const paymentSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['pending', 'waiting_for_capture', 'succeeded', 'canceled']),
  paid: z.boolean(),
  captured_at: z.iso.datetime().optional(),
  test: z.boolean(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  amount: z.object({ value: z.string(), currency: z.literal('RUB') }),
  confirmation: z.object({ confirmation_url: z.string().url().optional() }).optional(),
})

export type YooPayment = z.infer<typeof paymentSchema>
export type PaymentGateway = {
  create(orderId: string, totalKopecks: number, returnUrl: string): Promise<YooPayment>
  get(paymentId: string): Promise<YooPayment>
  /** Full read-only reconciliation; null means the entire requested interval was checked. */
  findByOrderId?(orderId: string, from: Date, until: Date): Promise<YooPayment | null>
}

export function createYooGateway(shopId: string, secretKey: string): PaymentGateway {
  if (!/^\d+$/.test(shopId) || !secretKey.startsWith('test_'))
    throw new Error('Для локального запуска нужны ключи тестового магазина ЮKassa')
  const authorization = `Basic ${Buffer.from(`${shopId}:${secretKey}`).toString('base64')}`

  async function requestJson(path: string, init: RequestInit = {}): Promise<unknown> {
    let response: Response
    try {
      response = await fetch(`https://api.yookassa.ru/v3${path}`, {
        ...init,
        redirect: 'error',
        headers: {
          Authorization: authorization,
          'Content-Type': 'application/json',
          ...init.headers,
        },
        signal: init.signal
          ? AbortSignal.any([init.signal, AbortSignal.timeout(12_000)])
          : AbortSignal.timeout(12_000),
      })
    } catch {
      throw new Error('YOOKASSA_UNAVAILABLE')
    }
    if (!response.ok) throw new Error('YOOKASSA_UNAVAILABLE')
    return response.json().catch(() => {
      throw new Error('YOOKASSA_INVALID_RESPONSE')
    })
  }
  async function request(path: string, init: RequestInit = {}): Promise<YooPayment> {
    const parsed = paymentSchema.safeParse(await requestJson(path, init))
    if (!parsed.success || !parsed.data.test) throw new Error('YOOKASSA_INVALID_RESPONSE')
    return parsed.data
  }
  let lookups = 0

  return {
    create(orderId, totalKopecks, returnUrl) {
      return request('/payments', {
        method: 'POST',
        headers: { 'Idempotence-Key': orderId },
        body: JSON.stringify({
          amount: { value: (totalKopecks / 100).toFixed(2), currency: 'RUB' },
          capture: true,
          confirmation: { type: 'redirect', return_url: returnUrl },
          description: `Заказ №${orderId.slice(0, 8)}`,
          metadata: { order_id: orderId },
        }),
      })
    },
    get(paymentId) {
      return request(`/payments/${encodeURIComponent(paymentId)}`)
    },
    async findByOrderId(orderId, from, until) {
      // https://yookassa.ru/developers/using-api/lists
      if (lookups >= 2) throw new Error('PAYMENT_CHECK_BUSY')
      if (!Number.isFinite(+from) || !Number.isFinite(+until) || from > until)
        throw new Error('INVALID_PAYMENT_INTERVAL')
      lookups++
      try {
        const query = new URLSearchParams({
          limit: '100',
          'created_at.gte': from.toISOString(),
          'created_at.lte': until.toISOString(),
        })
        const cursors = new Set<string>()
        const signal = AbortSignal.timeout(20_000)
        let found: YooPayment | null = null
        for (let page = 0; page < 20; page++) {
          const parsed = z
            .object({
              type: z.literal('list'),
              items: z.array(paymentSchema),
              next_cursor: z.string().min(1).optional(),
            })
            .safeParse(await requestJson(`/payments?${query}`, { signal }))
          if (!parsed.success || parsed.data.items.some((item) => !item.test))
            throw new Error('YOOKASSA_INVALID_RESPONSE')
          for (const item of parsed.data.items) {
            if (item.metadata?.order_id !== orderId) continue
            if (found && found.id !== item.id) throw new Error('PAYMENT_DUPLICATE')
            found = item
          }
          const cursor = parsed.data.next_cursor
          if (!cursor) return found
          if (cursors.has(cursor)) throw new Error('YOOKASSA_INVALID_RESPONSE')
          cursors.add(cursor)
          query.set('cursor', cursor)
        }
        // Неполную выборку нельзя считать доказательством отсутствия платежа.
        throw new Error('PAYMENT_LOOKUP_INCOMPLETE')
      } finally {
        lookups--
      }
    },
  }
}

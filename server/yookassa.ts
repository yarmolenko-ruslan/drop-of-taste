import { z } from 'zod'

const paymentSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['pending', 'waiting_for_capture', 'succeeded', 'canceled']),
  paid: z.boolean(),
  test: z.boolean(),
  amount: z.object({ value: z.string(), currency: z.literal('RUB') }),
  confirmation: z.object({ confirmation_url: z.string().url().optional() }).optional(),
})

export type YooPayment = z.infer<typeof paymentSchema>
export type PaymentGateway = {
  create(orderId: string, totalKopecks: number, returnUrl: string): Promise<YooPayment>
  get(paymentId: string): Promise<YooPayment>
}

export function createYooGateway(shopId: string, secretKey: string): PaymentGateway {
  if (!/^\d+$/.test(shopId) || !secretKey.startsWith('test_'))
    throw new Error('Для локального запуска нужны ключи тестового магазина ЮKassa')
  const authorization = `Basic ${Buffer.from(`${shopId}:${secretKey}`).toString('base64')}`

  async function request(path: string, init: RequestInit = {}): Promise<YooPayment> {
    let response: Response
    try {
      response = await fetch(`https://api.yookassa.ru/v3${path}`, {
        ...init,
        headers: {
          Authorization: authorization,
          'Content-Type': 'application/json',
          ...init.headers,
        },
        signal: AbortSignal.timeout(12_000),
      })
    } catch {
      throw new Error('YOOKASSA_UNAVAILABLE')
    }
    if (!response.ok) throw new Error('YOOKASSA_UNAVAILABLE')
    const parsed = paymentSchema.safeParse(await response.json().catch(() => null))
    if (!parsed.success || !parsed.data.test) throw new Error('YOOKASSA_INVALID_RESPONSE')
    return parsed.data
  }

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
  }
}

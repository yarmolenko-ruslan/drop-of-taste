export const PAYMENT_WINDOW_MS = 15 * 60 * 1000

export function paymentDeadline(order: {
  createdAt: Date | string
  requiresPayment?: boolean
  quote: { totalKopecks: number }
}) {
  if (order.requiresPayment === false || order.quote.totalKopecks === 0) return null
  return new Date(new Date(order.createdAt).getTime() + PAYMENT_WINDOW_MS).toISOString()
}

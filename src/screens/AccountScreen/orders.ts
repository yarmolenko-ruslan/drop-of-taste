export type Order = {
  _id: string
  createdAt: string
  paymentExpiresAt?: string | null
  paymentCapturedAt?: string | null
  canceledAt?: string | null
  status?: 'test' | 'completed'
  fulfillmentStatus?: 'new' | 'preparing' | 'delivering' | 'completed'
  paymentStatus?: 'unpaid' | 'creating' | 'error' | 'pending' | 'succeeded' | 'canceled'
  completedAt?: string | null
  fulfilledAt?: string | null
  input: { fulfillment: { mode: 'pickup' | 'delivery'; label: string }; birthdayDiscount?: boolean }
  quote: {
    testMode?: boolean
    lines: {
      productId: string
      name: string
      quantity: number
      unitPriceKopecks: number
      lineTotalKopecks: number
    }[]
    discountKopecks: number
    promoCode?: string
    promoDiscountKopecks?: number
    birthdayDiscountKopecks?: number
    deliveryKopecks: number
    adjustments?: { label: string; amountKopecks: number }[]
    totalKopecks: number
  }
}

export type OrderStatus = Pick<
  Order,
  | '_id'
  | 'status'
  | 'fulfillmentStatus'
  | 'paymentStatus'
  | 'completedAt'
  | 'fulfilledAt'
  | 'canceledAt'
  | 'paymentCapturedAt'
>

// Старый pending-ответ не снимает отмену. Восстановление требует доказанного списания вовремя.
export function cancellationAfterUpdate(
  order: Order,
  update: Pick<Order, 'canceledAt' | 'paymentStatus' | 'paymentCapturedAt'>,
) {
  if (update.canceledAt) return update.canceledAt
  if (
    update.paymentStatus === 'succeeded' &&
    update.paymentCapturedAt &&
    order.paymentExpiresAt &&
    Date.parse(update.paymentCapturedAt) < Date.parse(order.paymentExpiresAt)
  )
    return null
  return order.canceledAt ?? update.canceledAt
}

import { z } from 'zod'
import { checkoutSchema } from '../../../../shared/validation/checkout'

const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const quoteSchema = z.object({
  lines: z
    .array(
      z.object({
        productId: z.string(),
        name: z.string(),
        quantity: z.number().int().positive(),
        unitPriceKopecks: money,
        lineTotalKopecks: money,
      }),
    )
    .max(100),
  subtotalKopecks: money,
  discountKopecks: money.default(0),
  promoCode: z.string().optional(),
  promoDiscountKopecks: money.default(0),
  birthdayDiscountKopecks: money.optional(),
  deliveryKopecks: money.default(0),
  adjustments: z.array(z.object({ label: z.string(), amountKopecks: z.number().int() })).optional(),
  totalKopecks: money,
  eligible: z.boolean(),
  minimumOrderMessage: z.string().optional(),
  deliveryTerms: z.string().optional(),
  testMode: z.boolean().default(true),
})
export type CartQuote = z.infer<typeof quoteSchema>

// Снимок нужен для повторения уже отправленного запроса. При первом создании
// сервер заново проверяет цены; при повторе возвращает заказ с тем же ключом.
export const checkoutAttemptSchema = z.object({
  accountId: z.string().min(1).max(100),
  revision: z.string().min(1),
  key: z.string().uuid(),
  input: checkoutSchema,
  quote: quoteSchema,
  paymentEnabled: z.boolean(),
  orderId: z.string().min(1).max(100).optional(),
})
export type CheckoutAttempt = z.infer<typeof checkoutAttemptSchema>

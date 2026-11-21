import { z } from 'zod'
import { addressDetailsSchema } from './address.ts'

const lineSchema = z
  .object({
    productId: z.string().min(1).max(100),
    quantity: z.number().int().min(1).max(99),
    extras: z.array(z.object({ name: z.string(), quantity: z.number().int().min(1) })).default([]),
  })
  .strict()
const fulfillmentSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('pickup'), label: z.string().min(1).max(300) }).strict(),
  z
    .object({
      mode: z.literal('delivery'),
      label: z.string().min(5).max(300),
      details: addressDetailsSchema,
    })
    .strict(),
])

export const checkoutSchema = z
  .object({
    lines: z.array(lineSchema).min(1).max(100),
    fulfillment: fulfillmentSchema,
    promoCode: z.string().trim().max(40).optional(),
    birthdayDiscount: z.boolean().optional(),
  })
  .strict()
export type Checkout = z.infer<typeof checkoutSchema>

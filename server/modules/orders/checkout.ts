import type { Db } from 'mongodb'
import { z } from 'zod'
import type { CatalogDoc } from '../catalog/template.ts'
import { addressDetailsSchema } from '../../../shared/validation/address.ts'
import { getSiteContent } from '../content/service.ts'
import {
  bonusCodeDiscount,
  normalizeBonusCode,
  type BonusCode,
} from '../../../shared/bonus-code.ts'
import { pickupDiscountPercent, isPromotionActive } from '../../../shared/promotion.ts'
import { birthdayCelebrationYear } from '../../../shared/birthday.ts'

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

export async function calculateQuote(db: Db, input: Checkout, accountId?: string) {
  const ids = [...new Set(input.lines.map((line) => line.productId))]
  const products = await db
    .collection<CatalogDoc>('catalog')
    .find({ _id: { $in: ids } })
    .toArray()
  const byId = new Map(products.map((item) => [item._id, item]))
  const lines = input.lines.map((line) => {
    const product = byId.get(line.productId)
    if (!product || !product.available) throw new Error('PRODUCT_UNAVAILABLE')
    if (line.extras.length > 0) throw new Error('EXTRAS_UNPRICED')
    return {
      productId: product._id,
      name: product.name,
      quantity: line.quantity,
      unitPriceKopecks: product.priceKopecks,
      lineTotalKopecks: product.priceKopecks * line.quantity,
    }
  })
  const subtotalKopecks = lines.reduce((sum, line) => sum + line.lineTotalKopecks, 0)
  const discountableSubtotalKopecks = lines.reduce(
    (sum, line) =>
      sum + (byId.get(line.productId)?.categoryId === 'combo' ? 0 : line.lineTotalKopecks),
    0,
  )
  const content = await getSiteContent(db)
  const { promotions } = content
  const { minimumSubtotalKopecks, freeFromKopecks, feeKopecks } = content.settings.delivery
  const pickupPercent = input.fulfillment.mode === 'pickup' ? pickupDiscountPercent(promotions) : 0
  const pickupDiscountKopecks = Math.round((discountableSubtotalKopecks * pickupPercent) / 100)
  let birthdayYear: number | undefined
  let birthdayPercent = 0
  let birthdayDiscountKopecks = 0
  if (input.birthdayDiscount) {
    const promotion = promotions.find((item) => item.id === 'birthday')
    if (!promotion || !isPromotionActive(promotion) || !(promotion.discountPercent ?? 10))
      throw new Error('BIRTHDAY_UNAVAILABLE')
    if (!accountId) throw new Error('BIRTHDAY_DATE_REQUIRED')
    const user = await db
      .collection<{ _id: string; birthday?: string }>('users')
      .findOne({ _id: accountId })
    if (!user?.birthday) throw new Error('BIRTHDAY_DATE_REQUIRED')
    const year = birthdayCelebrationYear(user.birthday)
    if (year === null) throw new Error('BIRTHDAY_OUTSIDE_WINDOW')
    if (discountableSubtotalKopecks === 0) throw new Error('BIRTHDAY_NOT_APPLICABLE')
    birthdayPercent = promotion.discountPercent ?? 10
    birthdayDiscountKopecks = Math.round((discountableSubtotalKopecks * birthdayPercent) / 100)
    birthdayYear = year
  }
  const promoCode = input.promoCode ? normalizeBonusCode(input.promoCode) : undefined
  let promoDiscountKopecks = 0
  if (promoCode) {
    const code = await db.collection<BonusCode>('bonus_codes').findOne({ _id: promoCode })
    const discount = code && bonusCodeDiscount(code, discountableSubtotalKopecks)
    if (discount === null || discount === undefined) throw new Error('INVALID_PROMO_CODE')
    if (discountableSubtotalKopecks === 0) throw new Error('PROMO_NOT_APPLICABLE')
    promoDiscountKopecks = discount
  }
  const best = Math.max(pickupDiscountKopecks, promoDiscountKopecks, birthdayDiscountKopecks)
  const useBirthday = birthdayDiscountKopecks > 0 && birthdayDiscountKopecks === best
  if (
    useBirthday &&
    accountId &&
    (await db
      .collection<{ _id: string }>('birthday_claims')
      .findOne({ _id: `${accountId}:${birthdayYear}` }))
  )
    throw new Error('BIRTHDAY_ALREADY_USED')
  const discountKopecks =
    best === pickupDiscountKopecks && !useBirthday && best > promoDiscountKopecks ? best : 0
  if (discountKopecks || useBirthday) promoDiscountKopecks = 0
  const deliveryKopecks =
    input.fulfillment.mode === 'delivery' &&
    (freeFromKopecks === null || subtotalKopecks < freeFromKopecks)
      ? feeKopecks
      : 0
  const adjustments: { label: string; amountKopecks: number }[] = []
  if (discountKopecks > 0)
    adjustments.push({
      label: `Скидка за самовывоз (${pickupPercent}%)`,
      amountKopecks: -discountKopecks,
    })
  if (promoDiscountKopecks > 0)
    adjustments.push({ label: `Бонус-код ${promoCode}`, amountKopecks: -promoDiscountKopecks })
  if (useBirthday)
    adjustments.push({
      label: `Скидка ко дню рождения (${birthdayPercent}%)`,
      amountKopecks: -birthdayDiscountKopecks,
    })
  if (input.fulfillment.mode === 'delivery')
    adjustments.push({ label: 'Доставка', amountKopecks: deliveryKopecks })
  return {
    lines,
    subtotalKopecks,
    discountableSubtotalKopecks,
    discountKopecks,
    promoCode,
    promoDiscountKopecks,
    birthdayDiscountKopecks: useBirthday ? birthdayDiscountKopecks : 0,
    ...(useBirthday && { birthdayYear, birthdayPercent }),
    deliveryKopecks,
    adjustments,
    totalKopecks:
      subtotalKopecks -
      discountKopecks -
      promoDiscountKopecks -
      (useBirthday ? birthdayDiscountKopecks : 0) +
      deliveryKopecks,
    eligible: input.fulfillment.mode === 'pickup' || subtotalKopecks >= minimumSubtotalKopecks,
    minimumOrderMessage: `Для доставки нужно минимум ${(minimumSubtotalKopecks / 100).toLocaleString('ru-RU')} ₽ блюд.`,
    deliveryTerms: `Минимум ${(minimumSubtotalKopecks / 100).toLocaleString('ru-RU')} ₽${freeFromKopecks === null ? '' : ` и бесплатная доставка от ${(freeFromKopecks / 100).toLocaleString('ru-RU')} ₽`} считаются по стоимости блюд до скидок.`,
    testMode: true,
  }
}

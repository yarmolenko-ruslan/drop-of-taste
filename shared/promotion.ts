import type { SiteContent } from './site-content.ts'

export function isPromotionActive(
  promotion: SiteContent['promotions'][number],
  now = Date.now(),
): boolean {
  return (
    (!promotion.startsAt || Date.parse(promotion.startsAt) <= now) &&
    (!promotion.endsAt || now < Date.parse(promotion.endsAt))
  )
}

export function pickupDiscountPercent(promotions: SiteContent['promotions'], now = Date.now()) {
  return promotions.reduce((best, promotion) => {
    const rate = promotion.discountPercent ?? (promotion.id === 'pickup' ? 10 : 0)
    return promotion.category === 'pickup' &&
      isPromotionActive(promotion, now) &&
      Number.isFinite(rate) &&
      rate >= 0 &&
      rate <= 100
      ? Math.max(best, rate)
      : best
  }, 0)
}

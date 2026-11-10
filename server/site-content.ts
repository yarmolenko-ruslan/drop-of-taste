import type { Db } from 'mongodb'
import { defaultSiteContent, type SiteContent } from '../shared/site-content.ts'
import { isPromotionActive } from '../shared/promotion.ts'

export async function getSiteContent(db: Db): Promise<SiteContent> {
  const saved = await db
    .collection<SiteContent & { _id: string }>('site_content')
    .findOne({ _id: 'public' })
  if (!saved) return defaultSiteContent
  const { _id: _ignored, ...content } = saved
  void _ignored
  const merged = { ...defaultSiteContent, ...content } as SiteContent
  return {
    ...merged,
    phone: merged.phone === '+7 123 456-78-90' ? '' : merged.phone,
    homeAboutText:
      merged.homeAboutText ===
      'Домашняя кухня, выпечка из печи каждое утро и кофе, ради которого хочется вернуться. Пара предложений об истории кафе и шеф-поваре.'
        ? defaultSiteContent.homeAboutText
        : merged.homeAboutText,
    bonusTitle:
      merged.bonusTitle === 'Копите бонусы с каждого заказа'
        ? defaultSiteContent.bonusTitle
        : merged.bonusTitle,
    bonusText:
      merged.bonusText ===
      'Возвращаем 5% бонусами. Оплачивайте ими до 30% следующих заказов, а в день рождения — подарок от шефа.'
        ? defaultSiteContent.bonusText
        : merged.bonusText,
    bonusSteps: merged.bonusSteps.map((step, index) =>
      step ===
      ['Войдите по номеру телефона', 'Получайте 5% бонусами', 'Оплачивайте до 30% заказа'][index]
        ? defaultSiteContent.bonusSteps[index]
        : step,
    ) as SiteContent['bonusSteps'],
    promotions: merged.promotions.map((promotion) =>
      promotion.id === 'bonus' && promotion.title === '5% бонусами'
        ? defaultSiteContent.promotions.find((item) => item.id === 'bonus')!
        : promotion,
    ),
  }
}

export async function getPublicSiteContent(
  db: Db,
): Promise<SiteContent & { nextPromotionChangeInMs?: number }> {
  const content = await getSiteContent(db)
  const now = Date.now()
  const promotions = content.promotions.filter((promotion) => isPromotionActive(promotion, now))
  const activeIds = new Set(promotions.map((promotion) => promotion.id))
  const allIds = new Set(content.promotions.map((promotion) => promotion.id))
  const nextChange = content.promotions
    .flatMap((promotion) => [promotion.startsAt, promotion.endsAt])
    .map((value) => (value ? Date.parse(value) : NaN))
    .filter((time) => Number.isFinite(time) && time > now)
    .sort((a, b) => a - b)[0]
  return {
    ...content,
    ...(nextChange && { nextPromotionChangeInMs: nextChange - now }),
    promotions,
    heroSlides: content.heroSlides.filter((slide) => {
      const promotionId = (slide.href ?? `/promotions/${slide.id}`).match(
        /^\/promotions\/([^/?#]+)$/,
      )?.[1]
      return (
        !promotionId ||
        (slide.href
          ? activeIds.has(promotionId)
          : !allIds.has(promotionId) || activeIds.has(promotionId))
      )
    }),
  }
}

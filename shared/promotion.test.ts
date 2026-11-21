import { pickupDiscountPercent } from './promotion.ts'
import { defaultSiteContent } from './site-content.ts'

test('раздел показа акции дня рождения не превращает её в общую скидку самовывоза', () => {
  const promotions = defaultSiteContent.promotions.map((promotion) =>
    promotion.id === 'birthday'
      ? { ...promotion, category: 'pickup' as const, discountPercent: 50 }
      : promotion,
  )
  expect(pickupDiscountPercent(promotions)).toBe(10)
  expect(pickupDiscountPercent(promotions.filter((promotion) => promotion.id === 'birthday'))).toBe(
    0,
  )
})

test('обычные активные акции самовывоза выбирают наибольший процент', () => {
  const pickup = defaultSiteContent.promotions.find((promotion) => promotion.id === 'pickup')!
  expect(
    pickupDiscountPercent([
      pickup,
      { ...pickup, id: 'custom', discountPercent: 15 },
      { ...pickup, id: 'disabled', discountPercent: 80, enabled: false },
      { ...pickup, id: 'expired', discountPercent: 90, endsAt: '2020-01-01T00:00:00Z' },
    ]),
  ).toBe(15)
})

// @vitest-environment node
import type { Db } from 'mongodb'
import { defaultSiteContent } from '../shared/site-content.ts'
import { getPublicSiteContent, getSiteContent } from './site-content.ts'

test('старые подписи из сохранённых настроек заменяются, а авторский текст сохраняется', async () => {
  const db = {
    collection: () => ({
      findOne: async () => ({
        ...defaultSiteContent,
        _id: 'public',
        phone: '+7 123 456-78-90',
        homeAboutText:
          'Домашняя кухня, выпечка из печи каждое утро и кофе, ради которого хочется вернуться. Пара предложений об истории кафе и шеф-поваре.',
        bonusTitle: 'Копите бонусы с каждого заказа',
        bonusText:
          'Возвращаем 5% бонусами. Оплачивайте ими до 30% следующих заказов, а в день рождения — подарок от шефа.',
        bonusSteps: [
          'Войдите по номеру телефона',
          'Получайте 5% бонусами',
          'Оплачивайте до 30% заказа',
        ],
        promotions: [
          { ...defaultSiteContent.promotions[0], title: 'Авторская акция' },
          { ...defaultSiteContent.promotions[3], title: '5% бонусами' },
        ],
      }),
    }),
  } as unknown as Db

  const content = await getSiteContent(db)
  expect(content.phone).toBe('')
  expect(content.homeAboutText).toBe(defaultSiteContent.homeAboutText)
  expect(content.bonusTitle).toBe(defaultSiteContent.bonusTitle)
  expect(content.bonusText).toBe(defaultSiteContent.bonusText)
  expect(content.bonusSteps).toEqual(defaultSiteContent.bonusSteps)
  expect(content.promotions[0]?.title).toBe('Авторская акция')
  expect(content.promotions[1]?.title).toBe('Ваши заказы под рукой')
})

test('публичный сайт скрывает будущую акцию и её баннер', async () => {
  const db = {
    collection: () => ({
      findOne: async () => ({
        _id: 'public',
        ...defaultSiteContent,
        promotions: defaultSiteContent.promotions.map((promotion) =>
          promotion.id === 'birthday'
            ? { ...promotion, startsAt: new Date(Date.now() + 60_000).toISOString() }
            : promotion,
        ),
      }),
    }),
  } as unknown as Db
  const content = await getPublicSiteContent(db)
  expect(content.promotions.some((promotion) => promotion.id === 'birthday')).toBe(false)
  expect(content.heroSlides.some((slide) => slide.id === 'birthday')).toBe(false)
  expect(content.heroSlides.some((slide) => slide.id === 'cafe')).toBe(true)
  expect(content.nextPromotionChangeInMs).toBeGreaterThan(0)
  expect(content.nextPromotionChangeInMs).toBeLessThanOrEqual(60_000)
})

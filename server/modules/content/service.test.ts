// @vitest-environment node
import type { Db } from 'mongodb'
import { defaultSiteContent } from '../../../shared/site-content.ts'
import { getPublicSiteContent, getSiteContent } from './service.ts'

test('старые подписи из сохранённых настроек заменяются, а авторский текст сохраняется', async () => {
  const db = {
    collection: () => ({
      findOne: async () => ({
        ...defaultSiteContent,
        _id: 'public',
        mapBackupEmbedUrl: undefined,
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
  expect(content.mapBackupEmbedUrl).toBe('')
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

test('процент дня рождения обновляет подписи, а выключение скрывает акцию', async () => {
  const makeDb = (enabled: boolean) =>
    ({
      collection: () => ({
        findOne: async () => ({
          _id: 'public',
          ...defaultSiteContent,
          promotions: defaultSiteContent.promotions.map((promotion) =>
            promotion.id === 'birthday'
              ? { ...promotion, enabled, discountPercent: 17.5 }
              : promotion,
          ),
        }),
      }),
    }) as unknown as Db
  const active = await getPublicSiteContent(makeDb(true))
  expect(active.promotions.find((promotion) => promotion.id === 'birthday')).toMatchObject({
    title: '−17.5%',
    subtitle: 'Скидка 17.5% в день рождения',
  })
  expect(active.heroSlides.find((slide) => slide.id === 'birthday')?.title).toBe(
    'Скидка 17.5% в день рождения',
  )
  const inactive = await getPublicSiteContent(makeDb(false))
  expect(inactive.promotions.some((promotion) => promotion.id === 'birthday')).toBe(false)
  expect(inactive.heroSlides.some((slide) => slide.id === 'birthday')).toBe(false)
})

test.each([undefined, 1])(
  'undeclared storage metadata never reaches public content (version %s)',
  async (contentVersion) => {
    const db = {
      collection: () => ({
        findOne: async () => ({
          _id: 'public',
          ...defaultSiteContent,
          contentVersion,
          brandName: 'Авторское название',
          internalNotes: 'private-metadata-do-not-publish',
          tokenHash: 'private-storage-token',
        }),
      }),
    } as unknown as Db
    for (const content of [await getSiteContent(db), await getPublicSiteContent(db)]) {
      expect(content.brandName).toBe('Авторское название')
      expect(JSON.stringify(content)).not.toContain('private-')
      expect(content).not.toHaveProperty('_id')
      expect(content).not.toHaveProperty('contentVersion')
      expect(content).not.toHaveProperty('internalNotes')
      expect(content.settings.delivery).toEqual(defaultSiteContent.settings.delivery)
    }
  },
)

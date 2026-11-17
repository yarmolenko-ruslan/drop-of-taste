// @vitest-environment node
import { MongoClient } from 'mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Fastify from 'fastify'
import { registerAdminRoutes } from '../../modules/admin/routes.ts'
import { defaultSiteContent } from '../../../shared/site-content.ts'
import { getPublicSiteContent, getSiteContent } from '../../modules/content/service.ts'
import { createTemplateCatalog, type CatalogDoc } from '../../modules/catalog/template.ts'
import { calculateQuote } from '../../modules/orders/checkout.ts'

test('настройки из админки сохраняются, меняют серверный тариф и не затирают авторские тексты', async () => {
  const replica = await MongoMemoryReplSet.create({
    binary: { downloadDir: join(tmpdir(), 'drop-of-taste-mongodb') },
    replSet: { count: 1 },
  })
  const mongo = new MongoClient(replica.getUri())
  await mongo.connect()
  const db = mongo.db('admin_content_flow')
  const app = Fastify({ bodyLimit: 65_536 })
  const origin = 'http://localhost:5173'
  try {
    await registerAdminRoutes(app, db, [origin], 'test-password', mongo)
    const login = await app.inject({
      method: 'POST',
      url: '/api/admin/login',
      headers: { origin },
      payload: { password: 'test-password' },
    })
    const headers = { origin, cookie: String(login.headers['set-cookie']).split(';')[0]! }
    const settings = {
      ...defaultSiteContent.settings,
      delivery: { minimumSubtotalKopecks: 70000, feeKopecks: 30000, freeFromKopecks: 180000 },
    }
    const patch = (payload: Record<string, unknown>) =>
      app.inject({ method: 'PATCH', url: '/api/admin/content', headers, payload })
    expect(
      (
        await patch({
          settings,
          heroSlides: [
            {
              id: 'new',
              title: 'Новый баннер',
              badge: '',
              description: '',
              image: '/brand-emblem.png',
              imageAlt: '',
              href: '/menu/breakfast',
            },
          ],
        })
      ).statusCode,
    ).toBe(200)
    expect(
      (
        await patch({
          brandName: 'Другое название',
          bonusTitle: 'Копите бонусы с каждого заказа',
          phone: '+7 123 456-78-90',
        })
      ).statusCode,
    ).toBe(200)
    const content = await getSiteContent(db)
    expect(content.settings).toEqual(settings)
    expect(content.bonusTitle).toBe('Копите бонусы с каждого заказа')
    expect(content.phone).toBe('+7 123 456-78-90')
    const legal = {
      ...defaultSiteContent.legal,
      privacy: {
        ...defaultSiteContent.legal.privacy,
        sections: Array.from({ length: 30 }, (_, i): [string, string] => [
          `Раздел ${i + 1}`,
          'Текст '.repeat(600),
        ]),
      },
    }
    expect((await patch({ legal })).statusCode).toBe(200)
    expect((await getSiteContent(db)).legal.privacy.sections).toHaveLength(30)
    const product = { ...createTemplateCatalog()[0]!, priceKopecks: 40000 }
    await db.collection<CatalogDoc>('catalog').insertOne(product)
    const quote = (quantity: number) =>
      calculateQuote(db, {
        lines: [{ productId: product._id, quantity, extras: [] }],
        fulfillment: {
          mode: 'delivery',
          label: 'Тестовый адрес',
          details: {
            street: 'Мира, 1',
            entrance: '',
            floor: '',
            flat: '',
            comment: '',
            isHouse: true,
          },
        },
      })
    expect(await quote(1)).toMatchObject({ eligible: false, deliveryKopecks: 30000 })
    expect(await quote(2)).toMatchObject({ eligible: true, totalKopecks: 110000 })
    expect(await quote(5)).toMatchObject({ totalKopecks: 200000, deliveryKopecks: 0 })
    expect(
      (
        await patch({
          settings: { ...settings, delivery: { ...settings.delivery, freeFromKopecks: null } },
        })
      ).statusCode,
    ).toBe(200)
    expect(await quote(5)).toMatchObject({ deliveryKopecks: 30000 })
    expect((await patch({ heroSlides: [] })).statusCode).toBe(200)
    expect((await getPublicSiteContent(db)).heroSlides).toEqual([])
    expect(
      (
        await patch({
          settings: { ...settings, delivery: { ...settings.delivery, feeKopecks: -1 } },
        })
      ).statusCode,
    ).toBe(400)
    expect(
      (
        await patch({
          heroSlides: [{ ...defaultSiteContent.heroSlides[0], href: '//external.example' }],
        })
      ).statusCode,
    ).toBe(400)
    expect(
      (
        await patch({
          settings: {
            ...settings,
            appearance: { ...settings.appearance, brand: 'red; color: blue' },
          },
        })
      ).statusCode,
    ).toBe(400)
  } finally {
    await app.close()
    await mongo.close()
    await replica.stop()
  }
})

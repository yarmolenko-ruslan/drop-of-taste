// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { MongoClient } from 'mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { expect, test } from 'vitest'
import { defaultSiteContent } from '../shared/site-content.ts'
import { registerAdminRoutes } from './admin.ts'
import { getCatalog, seedCatalog } from './catalog/mongo-catalog.ts'
import { createTemplateCatalog } from './catalog/template.ts'
import { getSiteContent } from './site-content.ts'

const origin = 'http://localhost:5173'

test('admin changes publish to the site; product and category deletion persists', async () => {
  const replica = await MongoMemoryReplSet.create({
    binary: { downloadDir: join(tmpdir(), 'drop-of-taste-mongodb') },
    replSet: { count: 1 },
  })
  const mongo = new MongoClient(replica.getUri())
  await mongo.connect()
  const db = mongo.db(`test_${randomUUID().replaceAll('-', '')}`)
  const app = Fastify()
  try {
    await seedCatalog(db)
    await registerAdminRoutes(app, db, [origin], 'test-admin-password')
    const unauthorized = await app.inject({ method: 'GET', url: '/api/admin/dashboard' })
    expect(unauthorized.statusCode).toBe(401)
    const login = await app.inject({
      method: 'POST',
      url: '/api/admin/login',
      headers: { origin },
      payload: { password: 'test-admin-password' },
    })
    expect(login.statusCode).toBe(200)
    const cookie = login.headers['set-cookie']!.toString().split(';')[0]
    const changedContent = {
      ...defaultSiteContent,
      phone: '+7 999 111-22-33',
      aboutImage: '/uploads/new-photo.png',
      legal: {
        ...defaultSiteContent.legal,
        privacy: { ...defaultSiteContent.legal.privacy, intro: 'Новая редакция политики' },
      },
    }
    const missingOrigin = await app.inject({
      method: 'PUT',
      url: '/api/admin/content',
      headers: { cookie },
      payload: changedContent,
    })
    expect(missingOrigin.statusCode).toBe(403)
    const updatedContent = await app.inject({
      method: 'PUT',
      url: '/api/admin/content',
      headers: { origin, cookie },
      payload: changedContent,
    })
    expect(updatedContent.statusCode).toBe(200)
    expect(await getSiteContent(db)).toMatchObject({
      phone: '+7 999 111-22-33',
      aboutImage: '/uploads/new-photo.png',
      legal: { privacy: { intro: 'Новая редакция политики' } },
    })
    const changedPhone = await app.inject({
      method: 'PATCH',
      url: '/api/admin/content',
      headers: { origin, cookie },
      payload: { phone: '+7 999 222-33-44' },
    })
    expect(changedPhone.statusCode).toBe(200)
    expect(await getSiteContent(db)).toMatchObject({
      phone: '+7 999 222-33-44',
      legal: { privacy: { intro: 'Новая редакция политики' } },
    })
    const logs = await app.inject({ method: 'GET', url: '/api/admin/logs', headers: { cookie } })
    expect(logs.statusCode).toBe(200)
    expect(logs.json().changes[0].changes).toContainEqual({
      field: 'phone',
      before: '+7 999 111-22-33',
      after: '+7 999 222-33-44',
    })
    const startsAt = new Date(Date.now() - 60_000).toISOString()
    const endsAt = new Date(Date.now() + 60_000).toISOString()
    const createdCode = await app.inject({
      method: 'POST',
      url: '/api/admin/bonus-codes',
      headers: { origin, cookie },
      payload: { code: 'taste10', kind: 'percent', value: 10, startsAt, endsAt, active: true },
    })
    expect(createdCode.statusCode).toBe(201)
    expect(createdCode.json().code._id).toBe('TASTE10')
    const invalidFraction = await app.inject({
      method: 'POST',
      url: '/api/admin/bonus-codes',
      headers: { origin, cookie },
      payload: { code: 'FRACTION', kind: 'rubles', value: 1.001, startsAt, endsAt, active: true },
    })
    expect(invalidFraction.statusCode).toBe(400)
    expect(
      (
        await app.inject({ method: 'GET', url: '/api/admin/bonus-codes', headers: { cookie } })
      ).json().codes,
    ).toHaveLength(1)
    const updatedCode = await app.inject({
      method: 'PUT',
      url: '/api/admin/bonus-codes/TASTE10',
      headers: { origin, cookie },
      payload: { code: 'TASTE10', kind: 'rubles', value: 100, startsAt, endsAt, active: true },
    })
    expect(updatedCode.statusCode).toBe(200)
    expect(updatedCode.json().code.kind).toBe('rubles')
    expect(
      (await app.inject({ method: 'GET', url: '/api/admin/logs', headers: { cookie } })).json()
        .changes[0].changes,
    ).toContainEqual({ field: 'kind', before: 'percent', after: 'rubles' })
    const pickupChanged = await app.inject({
      method: 'PATCH',
      url: '/api/admin/content',
      headers: { origin, cookie },
      payload: {
        promotions: defaultSiteContent.promotions.map((item) =>
          item.id === 'pickup' ? { ...item, discountPercent: 15 } : item,
        ),
      },
    })
    expect(pickupChanged.statusCode).toBe(200)
    expect(
      (await app.inject({ method: 'GET', url: '/api/admin/logs', headers: { cookie } })).json()
        .changes[0].changes,
    ).toContainEqual({ field: 'promotions[pickup].discountPercent', before: 10, after: 15 })
    const duplicatePromotion = await app.inject({
      method: 'PATCH',
      url: '/api/admin/content',
      headers: { origin, cookie },
      payload: { promotions: [defaultSiteContent.promotions[0], defaultSiteContent.promotions[0]] },
    })
    expect(duplicatePromotion.statusCode).toBe(400)

    const createdCategory = await app.inject({
      method: 'POST',
      url: '/api/admin/categories',
      headers: { origin, cookie },
      payload: { title: 'Сезонное меню', subtitle: 'Новые блюда', sortOrder: 20 },
    })
    expect(createdCategory.statusCode).toBe(201)
    const categoryId = createdCategory.json().category._id as string
    const original = createTemplateCatalog()[0]!
    const createdProduct = await app.inject({
      method: 'POST',
      url: '/api/admin/products',
      headers: { origin, cookie },
      payload: {
        ...original,
        categoryId,
        name: 'Тестовый пирог',
        priceKopecks: 12345,
        image: original.image ?? '',
        imageAlt: original.imageAlt ?? '',
        allergenNote: original.allergenNote ?? '',
        portions: original.portions ?? '',
      },
    })
    expect(createdProduct.statusCode).toBe(201)
    const productId = createdProduct.json().product._id as string
    expect(
      (await getCatalog(db)).categories.find((category) => category.id === categoryId),
    ).toMatchObject({ products: [{ _id: productId, name: 'Тестовый пирог', priceRub: 123.45 }] })
    const blockedCategoryDelete = await app.inject({
      method: 'DELETE',
      url: `/api/admin/categories/${categoryId}`,
      headers: { origin, cookie },
    })
    expect(blockedCategoryDelete.statusCode).toBe(409)
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/admin/products/${productId}`,
          headers: { origin, cookie },
        })
      ).statusCode,
    ).toBe(204)
    const promotion = { ...defaultSiteContent.promotions[0]!, href: `/menu/${categoryId}` }
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: '/api/admin/content',
          headers: { origin, cookie },
          payload: { promotions: [promotion] },
        })
      ).statusCode,
    ).toBe(200)
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/admin/categories/${categoryId}`,
          headers: { origin, cookie },
        })
      ).json().error.code,
    ).toBe('CATEGORY_IN_PROMOTION')
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: '/api/admin/content',
          headers: { origin, cookie },
          payload: { promotions: [] },
        })
      ).statusCode,
    ).toBe(200)
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/admin/categories/${categoryId}`,
          headers: { origin, cookie },
        })
      ).statusCode,
    ).toBe(204)
    await seedCatalog(db)
    expect((await getCatalog(db)).categories.some((category) => category.id === categoryId)).toBe(
      false,
    )

    const everyFieldEdited = structuredClone(defaultSiteContent)
    for (const [key, value] of Object.entries(everyFieldEdited)) {
      if (typeof value === 'string')
        Object.assign(everyFieldEdited, { [key]: value ? `${value}x` : 'x' })
    }
    everyFieldEdited.aboutParagraphs = everyFieldEdited.aboutParagraphs.map(
      (value) => `${value} x`,
    ) as typeof everyFieldEdited.aboutParagraphs
    everyFieldEdited.bonusSteps = everyFieldEdited.bonusSteps.map(
      (value) => `${value} x`,
    ) as typeof everyFieldEdited.bonusSteps
    everyFieldEdited.aboutHighlights = everyFieldEdited.aboutHighlights.map(
      (value) => `${value} x`,
    ) as typeof everyFieldEdited.aboutHighlights
    everyFieldEdited.benefits = everyFieldEdited.benefits.map((item) => ({
      ...item,
      title: `${item.title} x`,
      detail: `${item.detail} x`,
    }))
    everyFieldEdited.heroSlides = everyFieldEdited.heroSlides.map((item) => ({
      ...item,
      title: `${item.title} x`,
      image: `${item.image}x`,
    }))
    everyFieldEdited.promotions = everyFieldEdited.promotions.map((item) => ({
      ...item,
      title: `${item.title} x`,
      description: `${item.description} x`,
    }))
    everyFieldEdited.legal = {
      privacy: {
        ...everyFieldEdited.legal.privacy,
        intro: `${everyFieldEdited.legal.privacy.intro} x`,
      },
      consent: {
        ...everyFieldEdited.legal.consent,
        intro: `${everyFieldEdited.legal.consent.intro} x`,
      },
    }
    const everyFieldUpdate = await app.inject({
      method: 'PUT',
      url: '/api/admin/content',
      headers: { origin, cookie },
      payload: everyFieldEdited,
    })
    expect(everyFieldUpdate.statusCode).toBe(200)
    expect(await getSiteContent(db)).toEqual(everyFieldEdited)
  } finally {
    await app.close()
    await mongo.close()
    await replica.stop()
  }
}, 60_000)

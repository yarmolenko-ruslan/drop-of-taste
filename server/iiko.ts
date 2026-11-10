import type { Db, MongoClient } from 'mongodb'
import type { FastifyInstance } from 'fastify'
import { invalidateCatalogCache } from './catalog/mongo-catalog.ts'
import { notifySiteUpdate } from './site-updates.ts'
import type { CatalogDoc } from './catalog/template.ts'

type RecordValue = Record<string, unknown>
const record = (value: unknown): RecordValue =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as RecordValue) : {}
const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const string = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')
const number = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

function imageUrl(value: unknown): string {
  if (typeof value === 'string' && /^https:\/\//.test(value)) return value
  const data = record(value)
  const link = string(data.url) || string(data.imageUrl) || string(array(data.links)[0])
  return /^https:\/\//.test(link) ? link : ''
}

function priceOf(item: RecordValue): number | null {
  const direct = number(item.price)
  if (direct !== null) return direct
  for (const size of array(item.itemSizes).filter((value) => record(value).isHidden !== true)) {
    const sizeData = record(size)
    const candidate = number(record(array(sizeData.prices)[0]).price)
    if (candidate !== null) return candidate
  }
  for (const size of array(item.sizePrices)) {
    const sizeData = record(size)
    const candidate = number(sizeData.price) ?? number(record(array(sizeData.prices)[0]).price)
    if (candidate !== null) return candidate
  }
  return number(record(array(item.prices)[0]).price)
}

/** Deliberately imports only simple fixed-price dishes; modifiers and combos need a separate checkout model. */
export function mapIikoMenu(raw: unknown) {
  const menu = record(raw)
  const groups = array(menu.itemGroups).length ? array(menu.itemGroups) : array(menu.itemCategories)
  const categories: { _id: string; title: string; subtitle: string; sortOrder: number }[] = []
  const products: CatalogDoc[] = []
  let skipped = 0
  for (const [groupIndex, groupValue] of groups.entries()) {
    const group = record(groupValue)
    if (group.isHidden === true) continue
    const groupId = string(group.id) || string(group.itemCategoryId)
    const title = string(group.name)
    if (!groupId || !title) {
      skipped += array(group.items).length
      continue
    }
    const categoryId = `iiko-${groupId}`
    categories.push({
      _id: categoryId,
      title,
      subtitle: string(group.description),
      sortOrder: 100 + groupIndex,
    })
    for (const [itemIndex, itemValue] of array(group.items).entries()) {
      const item = record(itemValue)
      if (item.isHidden === true || item.canSetOpenPrice === true) {
        skipped++
        continue
      }
      const visibleSizes = array(item.itemSizes).filter((size) => record(size).isHidden !== true)
      if (
        (array(item.itemSizes).length > 0 && visibleSizes.length === 0) ||
        visibleSizes.length > 1 ||
        array(item.itemModifierGroups).length > 0 ||
        visibleSizes.some((size) => array(record(size).itemModifierGroups).length > 0)
      ) {
        skipped++
        continue
      }
      const productId = string(item.productId) || string(item.itemId) || string(item.id)
      const name = string(item.name)
      const price = priceOf(item)
      if (!productId || !name || price === null || price < 0 || !Number.isFinite(price)) {
        skipped++
        continue
      }
      // A product can appear in several menu groups; group ID keeps both cards distinct.
      const id = `iiko-${groupId}-${productId}`
      const description = string(item.description)
      const size = record(visibleSizes[0])
      const image = imageUrl(
        size.buttonImageUrl ?? item.image ?? item.imageUrl ?? item.buttonImageUrl,
      )
      products.push({
        _id: id,
        categoryId,
        sortOrder: itemIndex,
        name,
        details: description.slice(0, 500),
        description: description.slice(0, 3000),
        image,
        imageAlt: name,
        badges: [],
        action: 'add',
        measure: string(size.measureUnitType) === 'MILLILITER' ? 'мл' : 'г',
        amount: number(size.weight) ?? number(item.weight) ?? null,
        calories: null,
        ingredients: [],
        allergenNote: '',
        extras: [],
        portions: '',
        priceKopecks: Math.round(price * 100),
        available: true,
      })
    }
  }
  return { categories, products, skipped }
}

async function postIiko(path: string, body: RecordValue, token?: string): Promise<unknown> {
  const response = await fetch(`https://api-ru.iiko.services${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok)
    throw new Error(
      `iiko вернул ошибку ${response.status}. Проверьте ключи, организацию и внешнее меню.`,
    )
  return response.json()
}

export async function syncIikoMenu(
  db: Db,
  mongo: MongoClient,
  env: NodeJS.ProcessEnv = process.env,
) {
  const appId = env.IIKO_APP_ID
  const clientSecret = env.IIKO_CLIENT_SECRET
  const apiKey = env.IIKO_API_KEY
  const organizationId = env.IIKO_ORGANIZATION_ID
  const externalMenuId = env.IIKO_EXTERNAL_MENU_ID
  if (!appId || !clientSecret || !apiKey || !organizationId || !externalMenuId)
    throw new Error('Сначала укажите ключи iiko на сервере')
  const auth = record(await postIiko('/api/v2/access_token', { appId, clientSecret, apiKey }))
  const token = string(auth.token)
  if (!token) throw new Error('iiko не выдал токен доступа')
  const raw = await postIiko(
    '/api/menu/v3/by_id',
    {
      externalMenuId,
      organizationId,
      ...(env.IIKO_PRICE_CATEGORY_ID ? { priceCategoryId: env.IIKO_PRICE_CATEGORY_ID } : {}),
    },
    token,
  )
  const mapped = mapIikoMenu(raw)
  if (!mapped.categories.length || !mapped.products.length)
    throw new Error('Меню iiko пустое или имеет неподдерживаемый формат; сайт не изменён')
  const categoryCollection = db.collection<{
    _id: string
    title: string
    subtitle: string
    sortOrder: number
  }>('catalog_categories')
  const productCollection = db.collection<CatalogDoc>('catalog')
  let imported = 0
  let updated = 0
  const session = mongo.startSession()
  try {
    await session.withTransaction(async () => {
      // The driver can retry a transaction, so reset counters for each attempt.
      imported = 0
      updated = 0
      const oldProducts = await productCollection
        .find({ _id: { $regex: '^iiko-' } }, { session })
        .toArray()
      const oldById = new Map(oldProducts.map((product) => [product._id, product]))
      const syncedIds = new Set(mapped.products.map((product) => product._id))
      const itemAudit: Array<Record<string, unknown>> = []
      for (const category of mapped.categories)
        await categoryCollection.updateOne(
          { _id: category._id },
          { $setOnInsert: category },
          { upsert: true, session },
        )
      await productCollection.updateMany(
        { _id: { $regex: '^iiko-' } },
        { $set: { available: false } },
        { session },
      )
      for (const old of oldProducts)
        if (!syncedIds.has(old._id) && old.available)
          itemAudit.push({
            action: 'product.iiko_update',
            id: old._id,
            changes: [{ field: 'available', before: true, after: false }],
            at: new Date(),
          })
      for (const product of mapped.products) {
        const result = await productCollection.updateOne(
          { _id: product._id },
          { $setOnInsert: product },
          { upsert: true, session },
        )
        if (result.upsertedCount) {
          imported++
          itemAudit.push({
            action: 'product.iiko_create',
            id: product._id,
            changes: [{ field: 'product', before: null, after: product }],
            at: new Date(),
          })
        } else {
          await productCollection.updateOne(
            { _id: product._id },
            { $set: { priceKopecks: product.priceKopecks, available: true } },
            { session },
          )
          const old = oldById.get(product._id)
          const changes = [
            ...(old?.priceKopecks !== product.priceKopecks
              ? [
                  {
                    field: 'priceKopecks',
                    before: old?.priceKopecks ?? null,
                    after: product.priceKopecks,
                  },
                ]
              : []),
            ...(old?.available !== true
              ? [{ field: 'available', before: old?.available ?? null, after: true }]
              : []),
          ]
          if (changes.length) {
            updated++
            itemAudit.push({
              action: 'product.iiko_update',
              id: product._id,
              changes,
              at: new Date(),
            })
          }
        }
      }
      if (itemAudit.length) await db.collection('admin_audit').insertMany(itemAudit, { session })
      await db.collection('admin_audit').insertOne(
        {
          action: 'iiko.sync',
          imported,
          updated,
          skipped: mapped.skipped,
          changes: [
            { field: 'imported', before: 0, after: imported },
            { field: 'updated', before: 0, after: updated },
            { field: 'skipped', before: 0, after: mapped.skipped },
          ],
          at: new Date(),
        },
        { session },
      )
    })
  } finally {
    await session.endSession()
  }
  invalidateCatalogCache()
  return { imported, updated, skipped: mapped.skipped }
}

export function registerIikoRoutes(app: FastifyInstance, db: Db, mongo: MongoClient) {
  app.post('/api/admin/iiko/sync', async (_request, reply) => {
    try {
      const result = await syncIikoMenu(db, mongo)
      notifySiteUpdate('catalog')
      return result
    } catch (error) {
      return reply.code(502).send({
        error: {
          code: 'IIKO_SYNC_FAILED',
          message: error instanceof Error ? error.message : 'Не удалось загрузить меню iiko',
        },
      })
    }
  })
}

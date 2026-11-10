import type { Db } from 'mongodb'
import { categoryMeta, createTemplateCatalog, type CatalogDoc } from './template.ts'

const CATALOG_CACHE_TTL_MS = 30_000

type CatalogPayload = Awaited<ReturnType<typeof buildCatalog>>

const cacheByDatabase = new Map<string, { at: number; data: CatalogPayload }>()

export async function seedCatalog(db: Db) {
  const collection = db.collection<CatalogDoc>('catalog')
  const marker = db.collection<{ _id: string }>('site_meta')
  // A marker preserves deliberate deletion of the last product/category across restarts.
  if (!(await marker.findOne({ _id: 'catalog-seeded' }))) {
    await collection.bulkWrite(
      createTemplateCatalog().map((product) => ({
        updateOne: {
          filter: { _id: product._id },
          update: { $setOnInsert: product },
          upsert: true,
        },
      })),
    )
    await marker.insertOne({ _id: 'catalog-seeded' })
  }
  const categories = db.collection<{
    _id: string
    title: string
    subtitle: string
    sortOrder: number
  }>('catalog_categories')
  if (!(await marker.findOne({ _id: 'categories-seeded' }))) {
    await categories.bulkWrite(
      categoryMeta.map((item, sortOrder) => ({
        updateOne: {
          filter: { _id: item.id },
          update: {
            $setOnInsert: {
              _id: item.id,
              title: item.title,
              subtitle: item.subtitle,
              sortOrder,
            },
          },
          upsert: true,
        },
      })),
    )
    await marker.insertOne({ _id: 'categories-seeded' })
  }
}

async function buildCatalog(db: Db) {
  const categories = await db
    .collection<{ _id: string; title: string; subtitle: string; sortOrder: number }>(
      'catalog_categories',
    )
    .find({})
    .sort({ sortOrder: 1 })
    .toArray()
  const items = await db.collection<CatalogDoc>('catalog').find({}).sort({ sortOrder: 1 }).toArray()
  const byCategory = new Map(categories.map((category) => [category._id, [] as CatalogDoc[]]))
  for (const item of items) byCategory.get(item.categoryId)?.push(item)
  return {
    categories: categories.map((category) => ({
      id: category._id,
      title: category.title,
      subtitle: category.subtitle,
      products: (byCategory.get(category._id) ?? []).map((item) => ({
        ...item,
        id: item._id,
        priceRub: item.priceKopecks / 100,
      })),
    })),
    newArrivalIds: items.filter((item) => item.badges.includes('new')).map((item) => item._id),
  }
}

/** Сбрасывает кэш каталога (например, после ручного изменения позиций в БД). */
export function invalidateCatalogCache() {
  cacheByDatabase.clear()
}

/** Каталог меняется редко — отдаём закэшированный снимок, чтобы не гонять Mongo на каждый заход. */
export async function getCatalog(db: Db) {
  const now = Date.now()
  const cached = cacheByDatabase.get(db.databaseName)
  if (cached && now - cached.at < CATALOG_CACHE_TTL_MS) return cached.data
  const data = await buildCatalog(db)
  cacheByDatabase.set(db.databaseName, { at: now, data })
  return data
}

import type { Db } from 'mongodb'
import { categoryMeta, createTemplateCatalog, newArrivalIds, type CatalogDoc } from './template.ts'

const CATALOG_CACHE_TTL_MS = 30_000

type CatalogPayload = Awaited<ReturnType<typeof buildCatalog>>

const cacheByDatabase = new Map<string, { at: number; data: CatalogPayload }>()

export async function seedCatalog(db: Db) {
  const collection = db.collection<CatalogDoc>('catalog')
  const items = createTemplateCatalog()
  for (const item of items) {
    await collection.updateOne({ _id: item._id }, { $setOnInsert: item }, { upsert: true })
  }
}

async function buildCatalog(db: Db) {
  const items = await db
    .collection<CatalogDoc>('catalog')
    .find({})
    .sort({ categoryId: 1, sortOrder: 1 })
    .toArray()
  const byCategory = new Map(categoryMeta.map((category) => [category.id, [] as CatalogDoc[]]))
  for (const item of items) byCategory.get(item.categoryId)?.push(item)
  return {
    categories: categoryMeta.map((category) => ({
      ...category,
      products: (byCategory.get(category.id) ?? []).map((item) => ({
        ...item,
        id: item._id,
        priceRub: item.priceKopecks / 100,
      })),
    })),
    newArrivalIds,
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

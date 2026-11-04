import type { Db } from 'mongodb'
import { categoryMeta, createTemplateCatalog, newArrivalIds, type CatalogDoc } from './template.ts'

export async function seedCatalog(db: Db) {
  const collection = db.collection<CatalogDoc>('catalog')
  const items = createTemplateCatalog()
  for (const item of items) {
    await collection.updateOne({ _id: item._id }, { $setOnInsert: item }, { upsert: true })
  }
}

export async function getCatalog(db: Db) {
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

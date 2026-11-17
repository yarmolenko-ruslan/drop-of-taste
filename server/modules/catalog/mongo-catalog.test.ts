// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MongoClient } from 'mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { categoryMeta, createTemplateCatalog, type CatalogDoc } from './template.ts'
import { seedCatalog } from './mongo-catalog.ts'

test('первое заполнение возвращает стандартное меню и сохраняет созданный раздел', async () => {
  const replica = await MongoMemoryReplSet.create({
    binary: { downloadDir: join(tmpdir(), 'drop-of-taste-mongodb') },
    replSet: { count: 1 },
  })
  const client = new MongoClient(replica.getUri())
  await client.connect()
  const db = client.db(`catalog_${randomUUID().replaceAll('-', '')}`)
  const categories = db.collection<{
    _id: string
    title: string
    subtitle: string
    sortOrder: number
  }>('catalog_categories')
  const products = db.collection<CatalogDoc>('catalog')
  try {
    await categories.insertOne({
      _id: 'custom',
      title: 'Новый раздел',
      subtitle: '',
      sortOrder: 0,
    })
    await products.insertOne({
      ...createTemplateCatalog()[0]!,
      _id: 'custom-product',
      categoryId: 'custom',
      image: '/uploads/custom.jpg',
    })

    await seedCatalog(db)

    expect(await categories.countDocuments()).toBe(categoryMeta.length + 1)
    expect(await products.countDocuments()).toBe(createTemplateCatalog().length + 1)
    expect(await categories.findOne({ _id: 'custom' })).toMatchObject({
      title: 'Новый раздел',
    })
    expect(await products.findOne({ _id: 'custom-product' })).toMatchObject({
      image: '/uploads/custom.jpg',
    })

    await products.deleteOne({ _id: 'borscht' })
    await seedCatalog(db)
    expect(await products.findOne({ _id: 'borscht' })).toBeNull()
  } finally {
    await client.close()
    await replica.stop()
  }
})

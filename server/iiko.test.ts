// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MongoClient } from 'mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { describe, expect, it, vi } from 'vitest'
import { mapIikoMenu, syncIikoMenu } from './iiko.ts'
import type { CatalogDoc } from './catalog/template.ts'

describe('iiko external menu adapter', () => {
  it('maps v3 groups and fixed-price dishes while excluding items checkout cannot represent', () => {
    const result = mapIikoMenu({
      itemGroups: [
        {
          id: 'group-1',
          name: 'Завтраки',
          description: 'До полудня',
          items: [
            {
              id: 'dish-1',
              name: 'Каша',
              description: 'С ягодами',
              itemSizes: [
                {
                  id: 'size-1',
                  isDefault: true,
                  weight: 250,
                  buttonImageUrl: 'https://example.test/kasha.jpg',
                  prices: [{ price: 310 }],
                },
              ],
            },
            {
              id: 'dish-2',
              name: 'Кофе',
              itemSizes: [
                { id: 'small', prices: [{ price: 150 }] },
                { id: 'large', prices: [{ price: 220 }] },
              ],
            },
            {
              id: 'dish-3',
              name: 'Блюдо с выбором',
              itemSizes: [
                {
                  id: 'size-3',
                  prices: [{ price: 400 }],
                  itemModifierGroups: [{ id: 'required' }],
                },
              ],
            },
            {
              id: 'dish-4',
              name: 'Скрытое',
              isHidden: true,
              itemSizes: [{ prices: [{ price: 200 }] }],
            },
          ],
        },
      ],
    })
    expect(result.categories).toMatchObject([{ _id: 'iiko-group-1', title: 'Завтраки' }])
    expect(result.products).toMatchObject([
      {
        _id: 'iiko-group-1-dish-1',
        priceKopecks: 31000,
        amount: 250,
        image: 'https://example.test/kasha.jpg',
      },
    ])
    expect(result.products).toHaveLength(1)
    expect(result.skipped).toBe(3)
  })

  it('does not invent prices for products without a sellable price', () => {
    const result = mapIikoMenu({
      itemGroups: [
        {
          id: 'g',
          name: 'Меню',
          items: [{ id: 'p', name: 'Блюдо', itemSizes: [{ prices: [{ price: null }] }] }],
        },
      ],
    })
    expect(result.products).toHaveLength(0)
    expect(result.skipped).toBe(1)
  })

  it('does not show an unrelated photo when iiko has none', () => {
    const result = mapIikoMenu({
      itemGroups: [
        {
          id: 'g',
          name: 'Меню',
          items: [{ id: 'p', name: 'Блюдо', itemSizes: [{ prices: [{ price: 100 }] }] }],
        },
      ],
    })
    expect(result.products[0]?.image).toBe('')
  })

  it('updates prices and availability, preserving manual text and image edits', async () => {
    const replica = await MongoMemoryReplSet.create({
      binary: { downloadDir: join(tmpdir(), 'drop-of-taste-mongodb') },
      replSet: { count: 1 },
    })
    const mongo = new MongoClient(replica.getUri())
    await mongo.connect()
    const db = mongo.db(`test_${randomUUID().replaceAll('-', '')}`)
    const menu = (includeSecond: boolean, price: number) => ({
      itemGroups: [
        {
          id: 'breakfast',
          name: 'Завтраки',
          items: [
            { id: 'porridge', name: 'Каша', itemSizes: [{ prices: [{ price }] }] },
            ...(includeSecond
              ? [{ id: 'coffee', name: 'Кофе', itemSizes: [{ prices: [{ price: 180 }] }] }]
              : []),
          ],
        },
      ],
    })
    let responseMenu: unknown = menu(true, 300)
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (input: string) =>
          new Response(
            JSON.stringify(
              input.endsWith('/access_token') ? { token: 'test-token' } : responseMenu,
            ),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            },
          ),
      ),
    )
    const env = {
      IIKO_APP_ID: 'app',
      IIKO_CLIENT_SECRET: 'secret',
      IIKO_API_KEY: 'key',
      IIKO_ORGANIZATION_ID: 'org',
      IIKO_EXTERNAL_MENU_ID: 'menu',
    }
    try {
      expect(await syncIikoMenu(db, mongo, env)).toMatchObject({ imported: 2, updated: 0 })
      await db
        .collection<CatalogDoc>('catalog')
        .updateOne(
          { _id: 'iiko-breakfast-porridge' },
          { $set: { name: 'Домашняя каша', image: '/uploads/own.png' } },
        )
      responseMenu = menu(false, 350)
      expect(await syncIikoMenu(db, mongo, env)).toMatchObject({ imported: 0, updated: 1 })
      const priceChange = await db
        .collection('admin_audit')
        .findOne({ action: 'product.iiko_update', id: 'iiko-breakfast-porridge' })
      expect(priceChange?.changes).toContainEqual({
        field: 'priceKopecks',
        before: 30000,
        after: 35000,
      })
      const removedItem = await db
        .collection('admin_audit')
        .findOne({ action: 'product.iiko_update', id: 'iiko-breakfast-coffee' })
      expect(removedItem?.changes).toContainEqual({
        field: 'available',
        before: true,
        after: false,
      })
      expect(
        await db.collection<CatalogDoc>('catalog').findOne({ _id: 'iiko-breakfast-porridge' }),
      ).toMatchObject({
        name: 'Домашняя каша',
        image: '/uploads/own.png',
        priceKopecks: 35000,
        available: true,
      })
      expect(
        await db.collection<CatalogDoc>('catalog').findOne({ _id: 'iiko-breakfast-coffee' }),
      ).toMatchObject({ available: false })
      responseMenu = { itemGroups: [] }
      await expect(syncIikoMenu(db, mongo, env)).rejects.toThrow('сайт не изменён')
      expect(
        await db.collection<CatalogDoc>('catalog').findOne({ _id: 'iiko-breakfast-porridge' }),
      ).toMatchObject({ available: true })
    } finally {
      vi.unstubAllGlobals()
      await mongo.close()
      await replica.stop()
    }
  }, 60_000)
})

// @vitest-environment node
import type { Db } from 'mongodb'
import { getCatalog, invalidateCatalogCache } from './mongo-catalog.ts'

function database(title: string) {
  const read = vi.fn(async () => [{ _id: 'cat', title, subtitle: '', sortOrder: 0 }])
  const db = {
    databaseName: 'same_name',
    collection: (name: string) => ({
      find: () => ({
        sort: () => ({
          toArray: name === 'catalog_categories' ? read : async () => [],
        }),
      }),
    }),
  } as unknown as Db
  return { db, read }
}

test('разные подключения с одним именем базы имеют отдельные кэши', async () => {
  const first = database('Первый')
  const second = database('Второй')
  expect((await getCatalog(first.db)).categories[0]?.title).toBe('Первый')
  expect((await getCatalog(second.db)).categories[0]?.title).toBe('Второй')
  await getCatalog(first.db)
  expect(first.read).toHaveBeenCalledOnce()
})

test('совмещает одновременные чтения, но старая загрузка не возвращается после сброса', async () => {
  const { db, read } = database('Новый')
  let finishOld!: (
    value: { _id: string; title: string; subtitle: string; sortOrder: number }[],
  ) => void
  read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishOld = resolve
      }),
  )
  const old = getCatalog(db)
  const same = getCatalog(db)
  expect(read).toHaveBeenCalledOnce()
  invalidateCatalogCache(db)
  expect((await getCatalog(db)).categories[0]?.title).toBe('Новый')
  finishOld([{ _id: 'cat', title: 'Старый', subtitle: '', sortOrder: 0 }])
  await Promise.all([old, same])
  expect((await getCatalog(db)).categories[0]?.title).toBe('Новый')
  expect(read).toHaveBeenCalledTimes(2)
})

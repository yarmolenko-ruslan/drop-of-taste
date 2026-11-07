type SearchableProduct = {
  name: string
  details: string
  description?: string
  ingredients?: readonly string[]
}

type SearchCategory<T> = {
  id: string
  title: string
  products: readonly T[]
}

type IndexedProduct<T> = {
  product: T
  categoryId: string
  categoryTitle: string
  name: string
  text: string
}

function normalize(value: string) {
  return value.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').trim()
}

// Нормализация текста каталога (toLocaleLowerCase по всем позициям) дорогая
// и не зависит от запроса — кэшируем по ссылке на массив категорий.
const indexCache = new WeakMap<object, readonly IndexedProduct<never>[]>()

function indexedProducts<T extends SearchableProduct>(categories: readonly SearchCategory<T>[]) {
  const cached = indexCache.get(categories as object)
  if (cached) return cached as readonly IndexedProduct<T>[]
  const index = categories.flatMap((category) =>
    category.products.map((product) => ({
      product,
      categoryId: category.id,
      categoryTitle: category.title,
      name: normalize(product.name),
      text: normalize(
        [product.name, product.details, product.description, ...(product.ingredients ?? [])].join(
          ' ',
        ),
      ),
    })),
  )
  indexCache.set(categories as object, index as unknown as readonly IndexedProduct<never>[])
  return index
}

export function searchCatalog<T extends SearchableProduct>(
  categories: readonly SearchCategory<T>[],
  query: string,
) {
  const words = normalize(query).split(/\s+/).filter(Boolean)
  if (!words.length) return []

  return indexedProducts(categories)
    .filter((result) => words.every((word) => result.text.includes(word)))
    .sort((first, second) => {
      const firstInName = words.every((word) => first.name.includes(word))
      const secondInName = words.every((word) => second.name.includes(word))
      return Number(secondInName) - Number(firstInName)
    })
    .map(({ product, categoryId, categoryTitle }) => ({ product, categoryId, categoryTitle }))
}

import { homeCategories, homeCombos } from '../../src/features/catalog/model/homeCatalog.ts'
import { newArrivals } from '../../src/features/catalog/model/newArrivals.ts'
import {
  dialogItemFromCombo,
  dialogItemFromProduct,
  dialogItemFromSauce,
} from '../../src/features/catalog/model/dialogContent.ts'

export const templatePricesRub: Record<string, number> = {
  syrniki: 290,
  oatmeal: 210,
  'ham-omelet': 320,
  'cottage-cheese-blini': 260,
  olivier: 330,
  vinaigrette: 240,
  'herring-fur-coat': 310,
  'chicken-caesar': 390,
  borscht: 360,
  solyanka: 390,
  'chicken-noodle-soup': 290,
  ukha: 420,
  'home-cutlets': 440,
  'beef-stroganoff': 590,
  'cabbage-rolls': 410,
  pelmeni: 450,
  'home-roast': 540,
  draniki: 320,
  'potatoes-mushrooms': 350,
  'liver-onions': 390,
  'cabbage-pie': 110,
  vatrushka: 150,
  kurnik: 260,
  pampushki: 130,
  medovik: 290,
  napoleon: 310,
  smetannik: 280,
  sharlotka: 270,
  'cranberry-mors': 170,
  cappuccino: 220,
  latte: 250,
  'herbal-tea': 190,
  'sea-buckthorn-mors': 180,
  lunch: 990,
  'breakfast-for-two': 1190,
  'family-dinner': 2490,
  'tea-time': 1390,
  'sauce-Сметана': 60,
  'sauce-Чесночный': 70,
  'sauce-Горчица': 60,
  'sauce-Хрен со свёклой': 70,
  'sauce-Аджика': 80,
}

export const categoryMeta = [
  ...homeCategories.map(({ id, title, subtitle }) => ({ id, title, subtitle })),
  { id: 'combo', title: 'Комбо', subtitle: 'Готовые наборы для любого случая' },
  { id: 'sauces', title: 'Соусы', subtitle: 'Добавьте вкуса любимому блюду' },
]

export const newArrivalIds = newArrivals.map(({ id }) => id)

export type CatalogDoc = {
  _id: string
  categoryId: string
  sortOrder: number
  name: string
  details: string
  description: string
  image?: string
  imageAlt?: string
  badges: string[]
  action: 'add' | 'choose'
  measure: 'г' | 'мл'
  amount: number | null
  calories: number | null
  ingredients: string[]
  allergenNote?: string
  extras: string[]
  portions?: string
  priceKopecks: number
  available: boolean
}

function price(id: string) {
  const rub = templatePricesRub[id]
  if (rub === undefined) throw new Error(`Missing template price for ${id}`)
  return rub * 100
}

export function createTemplateCatalog(): CatalogDoc[] {
  const products = homeCategories.flatMap((category) =>
    category.products.map((product, sortOrder) => {
      const dialog = dialogItemFromProduct(product)
      return {
        ...dialog,
        _id: product.id,
        categoryId: category.id,
        sortOrder,
        details: product.details,
        action: product.action,
        badges: [...product.badges],
        ingredients: [...dialog.ingredients],
        extras: [...dialog.extras],
        priceKopecks: price(product.id),
        available: true,
      }
    }),
  )
  const otherNew = newArrivals
    .filter((item) => !products.some((product) => product._id === item.id))
    .map((product, sortOrder) => {
      const dialog = dialogItemFromProduct(product)
      return {
        ...dialog,
        _id: product.id,
        categoryId: 'drinks',
        sortOrder: homeCategories.find((item) => item.id === 'drinks')!.products.length + sortOrder,
        details: product.details,
        action: product.action,
        badges: [...product.badges],
        ingredients: [...dialog.ingredients],
        extras: [...dialog.extras],
        priceKopecks: price(product.id),
        available: true,
      }
    })
  const combos = homeCombos.map((combo, sortOrder) => {
    const dialog = dialogItemFromCombo(combo)
    return {
      ...dialog,
      _id: combo.id,
      categoryId: 'combo',
      sortOrder,
      details: combo.details,
      action: 'add' as const,
      badges: [],
      ingredients: [...dialog.ingredients],
      extras: [...dialog.extras],
      portions: combo.portions,
      priceKopecks: price(combo.id),
      available: true,
    }
  })
  const sauceNames = ['Сметана', 'Чесночный', 'Горчица', 'Хрен со свёклой', 'Аджика']
  const sauces = sauceNames.map((name, sortOrder) => {
    const dialog = dialogItemFromSauce(name)
    return {
      ...dialog,
      _id: dialog.id,
      categoryId: 'sauces',
      sortOrder,
      details: dialog.description,
      action: 'add' as const,
      badges: [],
      ingredients: [...dialog.ingredients],
      extras: [],
      priceKopecks: price(dialog.id),
      available: true,
    }
  })
  const items = [...products, ...otherNew, ...combos, ...sauces]
  if (items.length !== 42 || new Set(items.map(({ _id }) => _id)).size !== 42) {
    throw new Error('Template catalog must contain 42 unique items')
  }
  return items
}

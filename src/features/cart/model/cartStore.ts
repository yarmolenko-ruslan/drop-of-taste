import { create } from 'zustand'
type CartProduct = {
  id: string
  name: string
  image?: string
  priceRub: number | null
}

export type CartLine = {
  key: string
  productId: string
  name: string
  image?: string
  variant: string
  removedIngredients: readonly string[]
  extras: readonly { name: string; quantity: number }[]
  quantity: number
  unitPriceRub: number | null
}

type CartCatalogProduct = {
  _id: string
  name: string
  image?: string
  priceKopecks: number
  available: boolean
}

type CartState = {
  lines: readonly CartLine[]
  isOpen: boolean
  open: () => void
  close: () => void
  add: (
    item: CartProduct,
    options: {
      variant: string
      removedIngredients: readonly string[]
      extras: Record<string, number>
      quantity: number
    },
  ) => void
  changeQuantity: (key: string, difference: number) => void
  clear: () => void
  syncCatalog: (products: readonly CartCatalogProduct[]) => void
}

export const cartCount = (lines: readonly CartLine[]) =>
  lines.reduce((sum, line) => sum + line.quantity, 0)

export const cartTotal = (lines: readonly CartLine[]) =>
  lines.some((line) => line.unitPriceRub === null || line.extras.length > 0)
    ? null
    : lines.reduce((sum, line) => sum + (line.unitPriceRub ?? 0) * line.quantity, 0)

export const formatCartPrice = (value: number | null) =>
  value === null ? 'Цена уточняется' : `${value.toLocaleString('ru-RU')} ₽`

export const useCartStore = create<CartState>((set) => ({
  lines: [],
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  add: (item, options) =>
    set((state) => {
      const extras = Object.entries(options.extras)
        .filter(([, quantity]) => quantity > 0)
        .map(([name, quantity]) => ({ name, quantity }))
        .sort((a, b) => a.name.localeCompare(b.name))
      const removedIngredients = [...options.removedIngredients].sort()
      const key = JSON.stringify([item.id, options.variant, removedIngredients, extras])
      const quantity = Math.min(99, Math.max(1, Math.trunc(options.quantity)))
      const existing = state.lines.find((line) => line.key === key)

      if (existing) {
        return {
          lines: state.lines.map((line) =>
            line.key === key ? { ...line, quantity: Math.min(99, line.quantity + quantity) } : line,
          ),
        }
      }

      return {
        lines: [
          ...state.lines,
          {
            key,
            productId: item.id,
            name: item.name,
            image: item.image,
            variant: options.variant,
            removedIngredients,
            extras,
            quantity,
            unitPriceRub: item.priceRub,
          },
        ],
      }
    }),
  changeQuantity: (key, difference) =>
    set((state) => ({
      lines: state.lines
        .map((line) =>
          line.key === key ? { ...line, quantity: Math.min(99, line.quantity + difference) } : line,
        )
        .filter((line) => line.quantity > 0),
    })),
  clear: () => set({ lines: [] }),
  syncCatalog: (products) =>
    set((state) => {
      const byId = new Map(products.map((product) => [product._id, product]))
      let changed = false
      const lines = state.lines.map((line) => {
        const product = byId.get(line.productId)
        const price = product?.available ? product.priceKopecks / 100 : null
        const name = product?.name ?? line.name
        const image = product?.image ?? line.image
        if (price === line.unitPriceRub && name === line.name && image === line.image) return line
        changed = true
        return { ...line, unitPriceRub: price, name, image }
      })
      return changed ? { lines } : state
    }),
}))

export function addOneToCart(item: CartProduct) {
  useCartStore.getState().add(item, {
    variant: '',
    removedIngredients: [],
    extras: {},
    quantity: 1,
  })
}

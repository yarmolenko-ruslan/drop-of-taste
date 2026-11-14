import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { z } from 'zod'
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
  revision: string
  pendingPayment: { orderId: string; accountId: string; revision: string } | null
  rememberPayment: (orderId: string, accountId: string) => void
  finishPayment: (orderId: string, accountId: string) => void
  forgetPayment: (orderId: string, accountId: string) => void
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

export const formatCartPrice = (value: number | null) =>
  value === null ? 'Цена уточняется' : `${value.toLocaleString('ru-RU')} ₽`

const savedLineSchema = z.object({
  key: z.string().max(10_000),
  productId: z.string().min(1).max(100),
  name: z.string().max(500),
  image: z.string().optional(),
  variant: z.string().max(500),
  removedIngredients: z.array(z.string()).max(100),
  extras: z
    .array(z.object({ name: z.string(), quantity: z.number().int().min(1).max(99) }))
    .max(100),
  quantity: z.number().int().min(1).max(99),
  unitPriceRub: z.number().nonnegative().nullable(),
})
const pendingPaymentSchema = z.object({
  orderId: z.string().min(1).max(100),
  accountId: z.string().min(1).max(100),
  revision: z.string().min(1),
})

export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      lines: [],
      isOpen: false,
      revision: crypto.randomUUID(),
      pendingPayment: null,
      rememberPayment: (orderId, accountId) =>
        set((state) => ({
          pendingPayment: { orderId, accountId, revision: state.revision },
        })),
      finishPayment: (orderId, accountId) =>
        set((state) => {
          const payment = state.pendingPayment
          if (payment?.orderId !== orderId || payment.accountId !== accountId) return state
          return {
            ...(payment.revision === state.revision && {
              lines: [],
              revision: crypto.randomUUID(),
            }),
            pendingPayment: null,
          }
        }),
      forgetPayment: (orderId, accountId) =>
        set((state) =>
          state.pendingPayment?.orderId === orderId && state.pendingPayment.accountId === accountId
            ? { pendingPayment: null }
            : state,
        ),
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
              revision: crypto.randomUUID(),
              lines: state.lines.map((line) =>
                line.key === key
                  ? { ...line, quantity: Math.min(99, line.quantity + quantity) }
                  : line,
              ),
            }
          }

          return {
            revision: crypto.randomUUID(),
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
          revision: crypto.randomUUID(),
          lines: state.lines
            .map((line) =>
              line.key === key
                ? { ...line, quantity: Math.min(99, line.quantity + difference) }
                : line,
            )
            .filter((line) => line.quantity > 0),
        })),
      clear: () => set({ lines: [], revision: crypto.randomUUID(), pendingPayment: null }),
      syncCatalog: (products) =>
        set((state) => {
          const byId = new Map(products.map((product) => [product._id, product]))
          let changed = false
          const lines = state.lines.map((line) => {
            const product = byId.get(line.productId)
            const price = product?.available ? product.priceKopecks / 100 : null
            const name = product?.name ?? line.name
            const image = product?.image ?? line.image
            if (price === line.unitPriceRub && name === line.name && image === line.image)
              return line
            changed = true
            return { ...line, unitPriceRub: price, name, image }
          })
          return changed ? { lines } : state
        }),
    }),
    {
      name: 'drop-of-taste:cart',
      storage: createJSONStorage(() => ({
        getItem: (name) => {
          try {
            return localStorage.getItem(name)
          } catch {
            return null
          }
        },
        setItem: (name, value) => {
          try {
            localStorage.setItem(name, value)
          } catch {
            /* Корзина работает и без storage. */
          }
        },
        removeItem: (name) => {
          try {
            localStorage.removeItem(name)
          } catch {
            /* Storage может быть заблокирован. */
          }
        },
      })),
      partialize: (state) => ({
        lines: state.lines,
        revision: state.revision,
        pendingPayment: state.pendingPayment,
      }),
      merge: (persisted, current) => {
        const data = persisted as {
          lines?: unknown
          revision?: unknown
          pendingPayment?: unknown
        } | null
        if (!Array.isArray(data?.lines)) return current
        const lines = data.lines.flatMap((line) => {
          const parsed = savedLineSchema.safeParse(line)
          return parsed.success ? [parsed.data] : []
        })
        const payment = pendingPaymentSchema.safeParse(data.pendingPayment)
        return {
          ...current,
          lines,
          revision: typeof data.revision === 'string' ? data.revision : current.revision,
          pendingPayment: payment.success ? payment.data : null,
        }
      },
    },
  ),
)

export function addOneToCart(item: CartProduct) {
  useCartStore.getState().add(item, {
    variant: '',
    removedIngredients: [],
    extras: {},
    quantity: 1,
  })
}

/** Поддерживаем одну корзину во вкладках одного браузера. */
export function syncCartAcrossTabs() {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== 'drop-of-taste:cart' && event.key !== null) return
    if (event.storageArea && event.storageArea !== localStorage) return
    if (event.newValue === null) useCartStore.getState().clear()
    else void useCartStore.persist.rehydrate()
  }
  window.addEventListener('storage', onStorage)
  return () => window.removeEventListener('storage', onStorage)
}

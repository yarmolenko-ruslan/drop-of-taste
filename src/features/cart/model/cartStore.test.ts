import { cartCount, cartTotal, useCartStore } from './cartStore'

const product = { id: 'borscht', name: 'Борщ', image: '/products/borscht.jpg', priceRub: 250 }

beforeEach(() => useCartStore.setState({ lines: [], isOpen: false }))

test('объединяет одинаковые порции и хранит разные варианты отдельно', () => {
  const add = useCartStore.getState().add
  const basic = { variant: 'Обычная', removedIngredients: [], extras: {}, quantity: 2 }

  add(product, basic)
  add(product, { ...basic, quantity: 1 })
  add(product, { ...basic, variant: 'Большая', quantity: 1 })

  const lines = useCartStore.getState().lines
  expect(lines).toHaveLength(2)
  expect(cartCount(lines)).toBe(4)
  expect(cartTotal(lines)).toBe(1000)
  expect(lines[0]?.quantity).toBe(3)
})

test('удаляет последнюю порцию и оставляет неизвестную цену заглушкой', () => {
  const store = useCartStore.getState()
  store.add(
    { ...product, priceRub: null },
    { variant: '', removedIngredients: [], extras: {}, quantity: 1 },
  )
  const line = useCartStore.getState().lines[0]
  expect(line).toBeDefined()
  expect(cartTotal(useCartStore.getState().lines)).toBeNull()

  store.changeQuantity(line!.key, -1)
  expect(useCartStore.getState().lines).toHaveLength(0)
})

test('не превышает серверный предел 99 порций в строке', () => {
  const store = useCartStore.getState()
  const options = { variant: '', removedIngredients: [], extras: {}, quantity: 150 }
  store.add(product, options)
  expect(useCartStore.getState().lines[0]?.quantity).toBe(99)
  store.add(product, { ...options, quantity: 1 })
  const line = useCartStore.getState().lines[0]!
  store.changeQuantity(line.key, 1)
  expect(useCartStore.getState().lines[0]?.quantity).toBe(99)
  store.changeQuantity(line.key, -98)
  expect(useCartStore.getState().lines[0]?.quantity).toBe(1)
})

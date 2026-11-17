import { cartCount, useCartStore } from './cartStore'

const product = { id: 'borscht', name: 'Борщ', image: '/products/borscht.jpg', priceRub: 250 }

beforeEach(() => useCartStore.setState({ lines: [], isOpen: false }))

test('ограничивает добавки до сохранения и сохраняет блюдо после восстановления', async () => {
  useCartStore.getState().add(product, {
    variant: '',
    removedIngredients: [],
    extras: { Сыр: 100 },
    quantity: 1,
  })
  expect(useCartStore.getState().lines[0]?.extras).toEqual([{ name: 'Сыр', quantity: 99 }])
  await useCartStore.persist.rehydrate()
  expect(useCartStore.getState().lines).toHaveLength(1)
})

test('восстановление старых добавок объединяет совпавшие строки без повторяющихся ключей', async () => {
  useCartStore.getState().add(product, {
    variant: '',
    removedIngredients: [],
    extras: { Сыр: 99 },
    quantity: 2,
  })
  const saved = JSON.parse(localStorage.getItem('drop-of-taste:cart')!)
  saved.state.lines.push({
    ...saved.state.lines[0],
    key: 'legacy-overflow',
    extras: [{ name: 'Сыр', quantity: 100 }],
    quantity: 1,
  })
  localStorage.setItem('drop-of-taste:cart', JSON.stringify(saved))
  await useCartStore.persist.rehydrate()
  expect(useCartStore.getState().lines).toHaveLength(1)
  expect(useCartStore.getState().lines[0]).toMatchObject({
    quantity: 3,
    extras: [{ name: 'Сыр', quantity: 99 }],
  })
})

test('восстанавливает старые добавки сверх лимита без потери блюда и не очищает исправленную корзину старой оплатой', async () => {
  const store = useCartStore.getState()
  store.add(product, {
    variant: 'Большая',
    removedIngredients: ['Лук'],
    extras: { Сыр: 1 },
    quantity: 1,
  })
  store.rememberPayment('order', 'u1')
  const saved = JSON.parse(localStorage.getItem('drop-of-taste:cart')!)
  saved.state.lines[0].extras[0].quantity = 100
  localStorage.setItem('drop-of-taste:cart', JSON.stringify(saved))
  await useCartStore.persist.rehydrate()
  expect(useCartStore.getState().lines[0]).toMatchObject({
    variant: 'Большая',
    removedIngredients: ['Лук'],
    extras: [{ name: 'Сыр', quantity: 99 }],
  })
  store.finishPayment('order', 'u1')
  expect(useCartStore.getState().lines).toHaveLength(1)
})

test('объединяет одинаковые порции и хранит разные варианты отдельно', () => {
  const add = useCartStore.getState().add
  const basic = { variant: 'Обычная', removedIngredients: [], extras: {}, quantity: 2 }

  add(product, basic)
  add(product, { ...basic, quantity: 1 })
  add(product, { ...basic, variant: 'Большая', quantity: 1 })

  const lines = useCartStore.getState().lines
  expect(lines).toHaveLength(2)
  expect(cartCount(lines)).toBe(4)
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
  expect(line?.unitPriceRub).toBeNull()

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

test('обновляет цену товара в корзине после изменения каталога', () => {
  const store = useCartStore.getState()
  store.add(product, { variant: '', removedIngredients: [], extras: {}, quantity: 2 })
  store.syncCatalog([
    { _id: 'borscht', name: 'Новый борщ', image: '/new.jpg', priceKopecks: 30000, available: true },
  ])
  expect(useCartStore.getState().lines[0]).toMatchObject({
    name: 'Новый борщ',
    image: '/new.jpg',
    unitPriceRub: 300,
  })
  store.syncCatalog([{ _id: 'borscht', name: 'Новый борщ', priceKopecks: 30000, available: false }])
  expect(useCartStore.getState().lines[0]?.unitPriceRub).toBeNull()
})

test('восстанавливает товары и параметры после перезагрузки, но не открывает окно', async () => {
  useCartStore.getState().add(product, {
    variant: 'Большая',
    removedIngredients: ['Лук'],
    extras: { Сыр: 2 },
    quantity: 2,
  })
  useCartStore.getState().open()
  vi.resetModules()
  const { useCartStore: restored } = await import('./cartStore')
  expect(restored.getState().lines).toEqual(useCartStore.getState().lines)
  expect(restored.getState().isOpen).toBe(false)
  const key = restored.getState().lines[0]!.key
  restored.getState().changeQuantity(key, -1)
  vi.resetModules()
  const { useCartStore: changed } = await import('./cartStore')
  expect(changed.getState().lines[0]?.quantity).toBe(1)
  changed.getState().clear()
  vi.resetModules()
  const { useCartStore: cleared } = await import('./cartStore')
  expect(cleared.getState().lines).toEqual([])
})

test('игнорирует повреждённую сохранённую корзину', async () => {
  localStorage.setItem('drop-of-taste:cart', '{broken')
  vi.resetModules()
  const { useCartStore: restored } = await import('./cartStore')
  expect(restored.getState().lines).toEqual([])
  localStorage.setItem(
    'drop-of-taste:cart',
    JSON.stringify({ state: { lines: [{ quantity: -1 }] }, version: 0 }),
  )
  vi.resetModules()
  const { useCartStore: invalid } = await import('./cartStore')
  expect(invalid.getState().lines).toEqual([])
})

test('отказ локального хранилища не мешает добавлению товара', () => {
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('Storage blocked', 'SecurityError')
  })
  try {
    expect(() =>
      useCartStore.getState().add(product, {
        variant: '',
        removedIngredients: [],
        extras: {},
        quantity: 1,
      }),
    ).not.toThrow()
    expect(useCartStore.getState().lines).toHaveLength(1)
  } finally {
    write.mockRestore()
  }
})

test('после восстановления не теряет остальные товары из-за одной повреждённой строки', async () => {
  useCartStore
    .getState()
    .add(product, { variant: '', removedIngredients: [], extras: {}, quantity: 1 })
  localStorage.setItem(
    'drop-of-taste:cart',
    JSON.stringify({
      state: {
        lines: [...useCartStore.getState().lines, { quantity: -1 }],
      },
      version: 0,
    }),
  )
  vi.resetModules()
  const { useCartStore: restored } = await import('./cartStore')
  expect(restored.getState().lines).toHaveLength(1)
})

test('оплата очищает только исходную редакцию корзины и переживает перезагрузку', async () => {
  useCartStore
    .getState()
    .add(product, { variant: '', removedIngredients: [], extras: {}, quantity: 1 })
  useCartStore.getState().rememberPayment('order-1', 'u1')
  vi.resetModules()
  const { useCartStore: restored } = await import('./cartStore')
  expect(restored.getState().pendingPayment).toMatchObject({ orderId: 'order-1', accountId: 'u1' })
  restored.getState().finishPayment('order-1', 'another-user')
  expect(restored.getState().lines).toHaveLength(1)
  restored.getState().finishPayment('another-order', 'u1')
  expect(restored.getState().lines).toHaveLength(1)
  restored.getState().finishPayment('order-1', 'u1')
  expect(restored.getState().lines).toHaveLength(0)
  expect(restored.getState().pendingPayment).toBeNull()
})

test('успех оплаты не удаляет изменённую или заново собранную корзину', () => {
  const store = useCartStore.getState()
  const options = { variant: '', removedIngredients: [], extras: {}, quantity: 1 }
  store.add(product, options)
  store.rememberPayment('order-1', 'u1')
  const key = useCartStore.getState().lines[0]!.key
  store.changeQuantity(key, 1)
  store.changeQuantity(key, -1)
  store.finishPayment('order-1', 'u1')
  expect(useCartStore.getState().lines).toHaveLength(1)
  store.rememberPayment('order-2', 'u1')
  store.clear()
  store.add(product, options)
  store.finishPayment('order-2', 'u1')
  expect(useCartStore.getState().lines).toHaveLength(1)
})

test('синхронизирует изменение и очистку корзины из другой вкладки', async () => {
  const { syncCartAcrossTabs } = await import('./cartStore')
  // После resetModules работаем с тем же экземпляром, что и подписка.
  const { useCartStore: store } = await import('./cartStore')
  store.getState().clear()
  store.getState().add(product, { variant: '', removedIngredients: [], extras: {}, quantity: 2 })
  const saved = localStorage.getItem('drop-of-taste:cart')!
  store.getState().clear()
  const unsubscribe = syncCartAcrossTabs()
  try {
    localStorage.setItem('drop-of-taste:cart', saved)
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'drop-of-taste:cart', newValue: saved }),
    )
    expect(store.getState().lines[0]?.quantity).toBe(2)
    store.getState().open()
    expect(JSON.parse(localStorage.getItem('drop-of-taste:cart')!).state.lines[0].quantity).toBe(2)
    localStorage.removeItem('drop-of-taste:cart')
    window.dispatchEvent(new StorageEvent('storage', { key: 'drop-of-taste:cart', newValue: null }))
    expect(store.getState().lines).toEqual([])
  } finally {
    unsubscribe()
  }
})

test('отказ от отслеживания оплаты сохраняет товары и проверяет владельца платежа', () => {
  const store = useCartStore.getState()
  store.clear()
  store.add(
    { id: 'borscht', name: 'Борщ', priceRub: 360 },
    { variant: '', removedIngredients: [], extras: {}, quantity: 1 },
  )
  store.rememberPayment('expired-order', 'u1')
  store.forgetPayment('expired-order', 'u2')
  expect(useCartStore.getState().pendingPayment).not.toBeNull()
  store.forgetPayment('other-order', 'u1')
  expect(useCartStore.getState().pendingPayment).not.toBeNull()
  store.forgetPayment('expired-order', 'u1')
  expect(useCartStore.getState().pendingPayment).toBeNull()
  expect(useCartStore.getState().lines).toHaveLength(1)
  store.clear()
})

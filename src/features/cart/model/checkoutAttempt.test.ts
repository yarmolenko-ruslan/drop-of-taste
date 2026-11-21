import { useCartStore } from './cartStore'
import type { CheckoutAttempt } from './checkoutAttempt'

function snapshot(): CheckoutAttempt {
  return {
    accountId: 'u1',
    revision: useCartStore.getState().revision,
    key: crypto.randomUUID(),
    input: {
      lines: [{ productId: 'borscht', quantity: 1, extras: [] }],
      fulfillment: { mode: 'pickup', label: 'Кафе' },
      birthdayDiscount: true,
    },
    quote: {
      lines: [],
      subtotalKopecks: 36000,
      discountKopecks: 0,
      promoDiscountKopecks: 0,
      birthdayDiscountKopecks: 3600,
      deliveryKopecks: 0,
      totalKopecks: 32400,
      eligible: true,
      testMode: true,
    },
    paymentEnabled: true,
    orderId: 'order-1',
  }
}
beforeEach(() => {
  useCartStore.getState().clear()
  useCartStore
    .getState()
    .add(
      { id: 'borscht', name: 'Борщ', priceRub: 360 },
      { variant: '', removedIngredients: [], extras: {}, quantity: 1 },
    )
})

test('перезагрузка восстанавливает исходные параметры, цену и ключ запроса', async () => {
  const attempt = snapshot()
  useCartStore.getState().rememberCheckout(attempt)
  const persisted = localStorage.getItem('drop-of-taste:cart')!
  useCartStore.getState().clear()
  localStorage.setItem('drop-of-taste:cart', persisted)
  await useCartStore.persist.rehydrate()
  expect(useCartStore.getState().checkoutAttempt).toEqual(attempt)
  expect(useCartStore.getState().lines).toHaveLength(1)
})

test('повреждённый снимок оформления не удаляет товары и не восстанавливается', async () => {
  const persisted = JSON.parse(localStorage.getItem('drop-of-taste:cart')!)
  persisted.state.checkoutAttempt = { ...snapshot(), input: { lines: [] } }
  localStorage.setItem('drop-of-taste:cart', JSON.stringify(persisted))
  await useCartStore.persist.rehydrate()
  expect(useCartStore.getState().checkoutAttempt).toBeNull()
  expect(useCartStore.getState().lines).toHaveLength(1)
})

test('поздний ответ предыдущей корзины не затирает новое оформление', () => {
  const old = snapshot()
  useCartStore.getState().rememberCheckout(old)
  useCartStore.getState().changeQuantity(useCartStore.getState().lines[0]!.key, 1)
  const current = snapshot()
  useCartStore.getState().rememberCheckout(current)
  useCartStore.getState().rememberCheckout({ ...old, orderId: 'late-order' })
  useCartStore.getState().forgetCheckout(old.key)
  expect(useCartStore.getState().checkoutAttempt).toEqual(current)
})

test.each(['finishPayment', 'forgetPayment'] as const)(
  '%s удаляет только своё оформление и сохраняет изменённую корзину',
  (action) => {
    const attempt = snapshot()
    useCartStore.getState().rememberCheckout(attempt)
    useCartStore.getState().rememberPayment('order-1', 'u1')
    useCartStore.getState()[action]('order-1', 'u2')
    expect(useCartStore.getState().checkoutAttempt).toEqual(attempt)
    useCartStore.getState().changeQuantity(useCartStore.getState().lines[0]!.key, 1)
    useCartStore.getState()[action]('order-1', 'u1')
    expect(useCartStore.getState().checkoutAttempt).toBeNull()
    expect(useCartStore.getState().lines[0]?.quantity).toBe(2)
  },
)

import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CartDrawer } from './CartDrawer'
import { useCartStore } from '../../model/cartStore'

const account = { id: 'u1', name: 'Тест', phone: '+79991234567' }
const props = {
  fulfillment: { mode: 'pickup' as const, label: 'Кафе' },
  savedDelivery: null,
  user: account,
  onFulfillmentChange: vi.fn(),
  onGoToAddresses: vi.fn(),
  recommendations: [],
  onAddRecommendation: vi.fn(),
}
const quote = {
  lines: [
    {
      productId: 'borscht',
      name: 'Борщ',
      quantity: 1,
      unitPriceKopecks: 36000,
      lineTotalKopecks: 36000,
    },
  ],
  subtotalKopecks: 36000,
  totalKopecks: 32400,
  discountKopecks: 3600,
  promoDiscountKopecks: 0,
  deliveryKopecks: 0,
  eligible: true,
  testMode: true,
}
const options = { variant: '', removedIngredients: [], extras: {}, quantity: 1 }

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})
beforeEach(() => {
  useCartStore.getState().clear()
  useCartStore.getState().add({ id: 'borscht', name: 'Борщ', priceRub: 360 }, options)
})
afterEach(() => vi.unstubAllGlobals())

test.each(['payment-error', 'lost-response', 'body-timeout'])(
  'после перезагрузки продолжает тот же заказ: %s',
  async (failureMode) => {
    const keys: string[] = []
    const saved = new Map<string, string>()
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/checkout/config')
        return Response.json({ testPaymentEnabled: true, birthdayAvailable: true })
      if (url === '/api/checkout/quote') {
        if (saved.size && JSON.parse(String(init?.body)).birthdayDiscount)
          return Response.json(
            { error: { code: 'BIRTHDAY_ALREADY_USED', message: 'Скидка зарезервирована' } },
            { status: 400 },
          )
        return Response.json(quote)
      }
      if (url === '/api/orders') {
        const key = new Headers(init?.headers).get('Idempotency-Key')!
        keys.push(key)
        if (!saved.has(key)) saved.set(key, `order-${saved.size + 1}`)
        if (keys.length === 1 && failureMode === 'lost-response') throw new Error('offline')
        if (keys.length === 1 && failureMode === 'body-timeout')
          return {
            ok: true,
            status: 201,
            json: async () => {
              throw new DOMException('Interrupted', 'TimeoutError')
            },
          }
        return Response.json({ order: { _id: saved.get(key) } })
      }
      if (url.endsWith('/pay')) throw new Error('offline')
      throw new Error(url)
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    const first = render(<CartDrawer {...props} />)
    await user.click(await screen.findByRole('checkbox', { name: /Скидка ко дню рождения/ }))
    let pay = screen.getByRole('button', { name: /Перейти к оплате/ })
    await waitFor(() => expect(pay).toBeEnabled())
    await user.click(pay)
    await screen.findByText(
      failureMode === 'body-timeout'
        ? 'Сервер не ответил вовремя. Попробуйте ещё раз'
        : 'Нет связи с сервером. Попробуйте ещё раз.',
    )
    const quotesBeforeReload = fetchMock.mock.calls.filter(
      ([url]) => url === '/api/checkout/quote',
    ).length
    first.unmount()
    await act(async () => {
      await useCartStore.persist.rehydrate()
    })
    render(<CartDrawer {...props} />)
    pay = await screen.findByRole('button', { name: /Перейти к оплате|Повторить переход к оплате/ })
    await waitFor(() => expect(pay).toBeEnabled())
    await user.click(pay)
    await screen.findByText('Нет связи с сервером. Попробуйте ещё раз.')
    expect(saved.size).toBe(1)
    expect(new Set(keys).size).toBe(1)
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/checkout/quote')).toHaveLength(
      quotesBeforeReload,
    )
    expect(useCartStore.getState().lines).toHaveLength(1)
  },
)

test('сохранённое оформление другого аккаунта не используется', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/checkout/config') return Response.json({ testPaymentEnabled: true })
      if (url === '/api/checkout/quote') return Response.json(quote)
      if (url === '/api/orders') return Response.json({ order: { _id: 'order-u1' } })
      throw new Error('offline')
    }),
  )
  const first = render(<CartDrawer {...props} />)
  await userEvent.setup().click(await screen.findByRole('button', { name: /Перейти к оплате/ }))
  await screen.findByText('Нет связи с сервером. Попробуйте ещё раз.')
  first.unmount()
  render(<CartDrawer {...props} user={{ ...account, id: 'u2' }} />)
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /Перейти к оплате/ })).toBeEnabled(),
  )
  expect(screen.queryByRole('button', { name: /Повторить переход/ })).not.toBeInTheDocument()
})

test('восстановление аккаунта после загрузки страницы сохраняет выбор скидки в оформлении', async () => {
  useCartStore.getState().rememberCheckout({
    accountId: account.id,
    revision: useCartStore.getState().revision,
    key: crypto.randomUUID(),
    input: {
      lines: [{ productId: 'borscht', quantity: 1, extras: [] }],
      fulfillment: props.fulfillment,
      birthdayDiscount: true,
    },
    quote,
    paymentEnabled: true,
    orderId: 'order-1',
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/checkout/config')
        return Response.json({ testPaymentEnabled: true, birthdayAvailable: true })
      if (url === '/api/checkout/quote') return Response.json(quote)
      throw new Error(url)
    }),
  )
  const view = render(<CartDrawer {...props} user={undefined} />)
  view.rerender(<CartDrawer {...props} />)
  await waitFor(() =>
    expect(screen.getByRole('checkbox', { name: /Скидка ко дню рождения/ })).toBeChecked(),
  )
  expect(screen.getByRole('button', { name: /Повторить переход к оплате/ })).toBeEnabled()
})

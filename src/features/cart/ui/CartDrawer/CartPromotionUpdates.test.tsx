import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { defaultSiteContent } from '../../../../../shared/site-content'
import { SiteContentProvider } from '../../../site-content/SiteContentProvider'
import { publishSiteUpdate } from '../../../../shared/lib/siteUpdates'
import { useCartStore } from '../../model/cartStore'
import { CartDrawer } from './CartDrawer'

const product = { id: 'borscht', name: 'Борщ', priceRub: 100 }
const options = { variant: '', removedIngredients: [], extras: {}, quantity: 1 }
const props = {
  fulfillment: { mode: 'pickup' as const, label: 'Кафе' },
  savedDelivery: null,
  user: { id: 'u1', name: 'Тест', phone: '+79991234567' },
  onFulfillmentChange: vi.fn(),
  onGoToAddresses: vi.fn(),
  recommendations: [],
  onAddRecommendation: vi.fn(),
}
const quote = (discount = false) => ({
  lines: [
    {
      productId: product.id,
      name: product.name,
      quantity: 1,
      unitPriceKopecks: 10000,
      lineTotalKopecks: 10000,
    },
  ],
  subtotalKopecks: 10000,
  totalKopecks: discount ? 9000 : 10000,
  discountKopecks: 0,
  deliveryKopecks: 0,
  birthdayDiscountKopecks: discount ? 1000 : 0,
  adjustments: discount ? [{ label: 'Скидка ко дню рождения (10%)', amountKopecks: -1000 }] : [],
  eligible: true,
})

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})
beforeEach(() => {
  useCartStore.setState({ lines: [], isOpen: false })
  useCartStore.getState().add(product, options)
})
afterEach(() => vi.unstubAllGlobals())

test('отключение акции отменяет выбранную скидку и игнорирует запоздавший расчёт с ней', async () => {
  let content = defaultSiteContent
  let finishSelected!: (response: Response) => void
  let baseQuotes = 0
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/site-content') return Promise.resolve(Response.json(content))
      // Даже при запоздавшей конфигурации кассы актуальный контент скрывает выключенную акцию.
      if (url === '/api/checkout/config')
        return Promise.resolve(
          Response.json({ birthdayAvailable: true, testPaymentEnabled: false }),
        )
      if (url === '/api/checkout/quote') {
        if (JSON.parse(String(init?.body)).birthdayDiscount)
          return new Promise<Response>((resolve) => {
            finishSelected = resolve
          })
        baseQuotes++
        return Promise.resolve(Response.json(quote()))
      }
      throw new Error(`Unexpected request: ${url}`)
    }),
  )
  render(
    <SiteContentProvider>
      <CartDrawer {...props} />
    </SiteContentProvider>,
  )
  await userEvent
    .setup()
    .click(await screen.findByRole('checkbox', { name: /Скидка ко дню рождения/ }))
  await waitFor(() => expect(finishSelected).toBeDefined())
  content = { ...defaultSiteContent, promotions: [] }
  act(() => publishSiteUpdate('content'))
  await waitFor(() =>
    expect(
      screen.queryByRole('checkbox', { name: /Скидка ко дню рождения/ }),
    ).not.toBeInTheDocument(),
  )
  await waitFor(() => expect(baseQuotes).toBeGreaterThanOrEqual(2))
  const checkout = screen.getByRole('button', { name: /Оформить заказ/ })
  await waitFor(() => expect(checkout).toBeEnabled())
  await act(async () => finishSelected(Response.json(quote(true))))
  expect(checkout).toHaveTextContent('100 ₽')
  expect(screen.queryByText('Скидка ко дню рождения (10%)')).not.toBeInTheDocument()
})

test.each(['zero', 'future', 'expired'])(
  'плашка корзины учитывает состояние акции при устаревшем разрешении сервера: %s',
  async (state) => {
    const content = {
      ...defaultSiteContent,
      promotions: defaultSiteContent.promotions.map((item) =>
        item.id !== 'birthday'
          ? item
          : {
              ...item,
              ...(state === 'zero' && { discountPercent: 0 }),
              ...(state === 'future' && { startsAt: new Date(Date.now() + 60_000).toISOString() }),
              ...(state === 'expired' && { endsAt: new Date(Date.now() - 1000).toISOString() }),
            },
      ),
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/site-content') return Response.json(content)
        if (url === '/api/checkout/config')
          return Response.json({ birthdayAvailable: true, testPaymentEnabled: false })
        if (url === '/api/checkout/quote') return Response.json(quote())
        throw new Error(`Unexpected request: ${url}`)
      }),
    )
    render(
      <SiteContentProvider>
        <CartDrawer {...props} />
      </SiteContentProvider>,
    )
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Оформить заказ/ })).toBeEnabled(),
    )
    expect(
      screen.queryByRole('checkbox', { name: /Скидка ко дню рождения/ }),
    ).not.toBeInTheDocument()
  },
)

test('очистка во время расчёта не позволяет поздней цене вернуться после повторного добавления', async () => {
  let finishOld!: (response: Response) => void
  let quoteCalls = 0
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (url === '/api/checkout/config')
        return Promise.resolve(Response.json({ testPaymentEnabled: false }))
      if (url === '/api/checkout/quote') {
        if (++quoteCalls === 1)
          return new Promise<Response>((resolve) => {
            finishOld = resolve
          })
        return Promise.resolve(Response.json(quote()))
      }
      throw new Error(`Unexpected request: ${url}`)
    }),
  )
  render(<CartDrawer {...props} />)
  await waitFor(() => expect(finishOld).toBeDefined())
  await userEvent.setup().click(screen.getByRole('button', { name: 'Очистить' }))
  expect(screen.getByText('Пока тут пусто')).toBeInTheDocument()
  act(() => useCartStore.getState().add(product, options))
  const checkout = screen.getByRole('button', { name: /Оформить заказ/ })
  await waitFor(() => expect(checkout).toBeEnabled())
  await act(async () => finishOld(Response.json(quote(true))))
  expect(checkout).toHaveTextContent('100 ₽')
  expect(useCartStore.getState().lines).toHaveLength(1)
})

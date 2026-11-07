import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useCartStore } from '../../model/cartStore'
import { CartDrawer } from './CartDrawer'

const product = { id: 'borscht', name: 'Борщ', priceRub: 360 }
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
  useCartStore.setState({ lines: [], isOpen: false })
  vi.unstubAllGlobals()
})

test('изменения корзины во время сохранения заказа остаются в корзине', async () => {
  const user = userEvent.setup()
  useCartStore.getState().add(product, options)
  let finishOrder!: (response: Response) => void
  const pendingOrder = new Promise<Response>((resolve) => {
    finishOrder = resolve
  })
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (url === '/api/checkout/quote')
        return Promise.resolve(
          Response.json({
            lines: [],
            subtotalKopecks: 36000,
            discountKopecks: 3600,
            deliveryKopecks: 0,
            totalKopecks: 32400,
            eligible: true,
            testMode: true,
          }),
        )
      if (url === '/api/orders') return pendingOrder
      throw new Error(`Неожиданный запрос: ${url}`)
    }),
  )
  const onCreated = vi.fn()
  render(
    <CartDrawer
      fulfillment={{ mode: 'pickup', label: 'г. Красноярск, улица Петра Подзолкова, 3и' }}
      savedDelivery={null}
      user={{ id: 'u1', name: 'Руслан', phone: '+79991234567' }}
      onFulfillmentChange={() => {}}
      onGoToAddresses={() => {}}
      recommendations={[]}
      onAddRecommendation={() => {}}
      onOrderCreated={onCreated}
    />,
  )
  await user.click(screen.getByRole('button', { name: /Рассчитать заказ/ }))
  await user.click(await screen.findByRole('button', { name: /Подтвердить тестовый заказ/ }))
  await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/orders', expect.anything()))
  act(() => useCartStore.getState().add({ id: 'latte', name: 'Латте', priceRub: 220 }, options))
  await act(async () => finishOrder(Response.json({ order: { _id: 'abcdef12-3456' } })))
  expect(useCartStore.getState().lines.map((line) => line.productId)).toEqual(['borscht', 'latte'])
  expect(screen.getByText(/проверьте её состав/)).toBeInTheDocument()
  expect(onCreated).toHaveBeenCalledTimes(1)
})

test('адрес доставки в корзине показан в компактном формате', () => {
  useCartStore.getState().add(product, options)
  render(
    <CartDrawer
      fulfillment={{
        mode: 'delivery',
        label: 'красноярск, мира 17, подъезд 1, 1 этаж, квартира 1',
        details: {
          street: 'красноярск, мира 17',
          entrance: '1',
          floor: '1',
          flat: '1',
          comment: '',
          isHouse: false,
        },
      }}
      savedDelivery={null}
      onFulfillmentChange={() => {}}
      onGoToAddresses={() => {}}
      recommendations={[]}
      onAddRecommendation={() => {}}
    />,
  )
  expect(
    screen.getByText('г. Красноярск, ул. Мира, д. 17, под. 1, эт. 1, кв. 1'),
  ).toBeInTheDocument()
})

test('после расчёта показывает цены сервера вместо устаревших цен корзины', async () => {
  useCartStore.getState().add(product, options)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        lines: [
          {
            productId: 'borscht',
            name: 'Борщ',
            quantity: 1,
            unitPriceKopecks: 40_000,
            lineTotalKopecks: 40_000,
          },
        ],
        subtotalKopecks: 40_000,
        discountKopecks: 4_000,
        deliveryKopecks: 0,
        totalKopecks: 36_000,
        eligible: true,
        testMode: true,
      }),
    ),
  )
  render(
    <CartDrawer
      fulfillment={{ mode: 'pickup', label: 'г. Красноярск, улица Петра Подзолкова, 3и' }}
      savedDelivery={null}
      recommendations={[]}
      onFulfillmentChange={() => {}}
      onGoToAddresses={() => {}}
      onAddRecommendation={() => {}}
    />,
  )
  await userEvent.setup().click(screen.getByRole('button', { name: /Рассчитать заказ/ }))
  expect(await screen.findByText('Стоимость блюд')).toBeInTheDocument()
  expect(screen.getAllByText('400 ₽')).toHaveLength(2)
  expect(screen.getByRole('button', { name: /Подтвердить тестовый заказ/ })).toHaveTextContent(
    '360 ₽',
  )
})

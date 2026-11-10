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
      if (url === '/api/checkout/config')
        return Promise.resolve(Response.json({ testPaymentEnabled: false }))
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
  await user.click(await screen.findByRole('button', { name: /Оформить заказ/ }))
  await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/orders', expect.anything()))
  act(() => useCartStore.getState().add({ id: 'latte', name: 'Латте', priceRub: 220 }, options))
  await act(async () => finishOrder(Response.json({ order: { _id: 'abcdef12-3456' } })))
  expect(useCartStore.getState().lines.map((line) => line.productId)).toEqual(['borscht', 'latte'])
  expect(screen.getByText(/проверьте заказ/)).toBeInTheDocument()
  expect(onCreated).toHaveBeenCalledTimes(1)
})

test('применяет бонус-код через серверный расчёт заказа', async () => {
  const user = userEvent.setup()
  useCartStore.getState().add(product, options)
  const fetchMock = vi.fn((url: string, _options?: RequestInit) => {
    void _options
    if (url === '/api/checkout/config')
      return Promise.resolve(Response.json({ testPaymentEnabled: false }))
    if (url === '/api/checkout/quote')
      return Promise.resolve(
        Response.json({
          lines: [],
          subtotalKopecks: 36000,
          discountKopecks: 0,
          promoCode: 'RUB100',
          promoDiscountKopecks: 10000,
          deliveryKopecks: 0,
          totalKopecks: 26000,
          eligible: true,
          testMode: true,
        }),
      )
    throw new Error(`Неожиданный запрос: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  render(
    <CartDrawer
      fulfillment={{ mode: 'pickup', label: 'г. Красноярск, улица Петра Подзолкова, 3и' }}
      savedDelivery={null}
      onFulfillmentChange={() => {}}
      onGoToAddresses={() => {}}
      recommendations={[]}
      onAddRecommendation={() => {}}
    />,
  )
  await user.type(screen.getByPlaceholderText('Введите бонус-код'), 'rub100')
  await user.click(screen.getByRole('button', { name: 'Применить бонус-код' }))
  await waitFor(() => expect(screen.getByText(/Бонус-код RUB100 применён/)).toBeInTheDocument())
  const quoteCall = fetchMock.mock.calls.find(
    ([url, options]) =>
      url === '/api/checkout/quote' &&
      JSON.parse((options as RequestInit).body as string).promoCode === 'RUB100',
  )
  expect(JSON.parse((quoteCall?.[1] as RequestInit).body as string).promoCode).toBe('RUB100')
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

test('после сбоя платежа повторяет оплату того же заказа', async () => {
  useCartStore.getState().add(product, options)
  const fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/checkout/config') return Response.json({ testPaymentEnabled: true })
    if (url === '/api/checkout/quote')
      return Response.json({
        lines: [],
        subtotalKopecks: 36000,
        discountKopecks: 3600,
        deliveryKopecks: 0,
        totalKopecks: 32400,
        eligible: true,
        testMode: true,
      })
    if (url === '/api/orders') return Response.json({ order: { _id: 'order-123' } })
    if (url === '/api/orders/order-123/pay')
      return Response.json(
        { error: { code: 'PAYMENT_UNAVAILABLE', message: 'Тестовая оплата недоступна' } },
        { status: 502 },
      )
    throw new Error(`Неожиданный запрос: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  render(
    <CartDrawer
      fulfillment={{ mode: 'pickup', label: 'г. Красноярск, улица Петра Подзолкова, 3и' }}
      savedDelivery={null}
      user={{ id: 'u1', name: 'Руслан', phone: '+79991234567' }}
      onFulfillmentChange={() => {}}
      onGoToAddresses={() => {}}
      recommendations={[]}
      onAddRecommendation={() => {}}
    />,
  )
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: /Перейти к оплате/ }))
  await screen.findByText('Тестовая оплата недоступна')
  expect(useCartStore.getState().lines).toHaveLength(1)
  await user.click(screen.getByRole('button', { name: /Повторить переход к оплате/ }))
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.filter(([url]) => url === '/api/orders/order-123/pay'),
    ).toHaveLength(2),
  )
  expect(fetchMock.mock.calls.filter(([url]) => url === '/api/orders')).toHaveLength(1)
})

test('не переводит на оплату, если корзина изменилась во время сохранения заказа', async () => {
  useCartStore.getState().add(product, options)
  let finishOrder!: (response: Response) => void
  const pendingOrder = new Promise<Response>((resolve) => {
    finishOrder = resolve
  })
  const fetchMock = vi.fn((url: string) => {
    if (url === '/api/checkout/config')
      return Promise.resolve(Response.json({ testPaymentEnabled: true }))
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
  })
  vi.stubGlobal('fetch', fetchMock)
  render(
    <CartDrawer
      fulfillment={{ mode: 'pickup', label: 'г. Красноярск, улица Петра Подзолкова, 3и' }}
      savedDelivery={null}
      user={{ id: 'u1', name: 'Руслан', phone: '+79991234567' }}
      onFulfillmentChange={() => {}}
      onGoToAddresses={() => {}}
      recommendations={[]}
      onAddRecommendation={() => {}}
    />,
  )
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: /Перейти к оплате/ }))
  act(() => useCartStore.getState().add({ id: 'latte', name: 'Латте', priceRub: 220 }, options))
  await act(async () => finishOrder(Response.json({ order: { _id: 'order-123' } })))
  expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/pay'))).toBe(false)
  expect(screen.getByText(/оплатить сохранённый заказ можно в личном кабинете/)).toBeInTheDocument()
  expect(useCartStore.getState().lines).toHaveLength(2)
})

test('не переводит на оплату, если способ получения изменился во время сохранения заказа', async () => {
  useCartStore.getState().add(product, options)
  let finishOrder!: (response: Response) => void
  const pendingOrder = new Promise<Response>((resolve) => {
    finishOrder = resolve
  })
  const fetchMock = vi.fn((url: string) => {
    if (url === '/api/checkout/config')
      return Promise.resolve(Response.json({ testPaymentEnabled: true }))
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
  })
  vi.stubGlobal('fetch', fetchMock)
  const baseProps = {
    savedDelivery: null,
    user: { id: 'u1', name: 'Руслан', phone: '+79991234567' },
    onFulfillmentChange: () => {},
    onGoToAddresses: () => {},
    recommendations: [],
    onAddRecommendation: () => {},
  }
  const view = render(
    <CartDrawer
      {...baseProps}
      fulfillment={{ mode: 'pickup', label: 'г. Красноярск, улица Петра Подзолкова, 3и' }}
    />,
  )
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: /Перейти к оплате/ }))
  view.rerender(
    <CartDrawer
      {...baseProps}
      fulfillment={{
        mode: 'delivery',
        label: 'г. Красноярск, улица Ленина, 1',
        details: {
          street: 'г. Красноярск, улица Ленина, 1',
          entrance: '',
          floor: '',
          flat: '1',
          comment: '',
          isHouse: false,
        },
      }}
    />,
  )
  await act(async () => finishOrder(Response.json({ order: { _id: 'order-123' } })))
  expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/pay'))).toBe(false)
  expect(screen.getByText(/способ получения изменились/)).toBeInTheDocument()
})

test('после расчёта показывает цены сервера вместо устаревших цен корзины', async () => {
  useCartStore.getState().add(product, options)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url === '/api/checkout/config'
        ? Response.json({ testPaymentEnabled: false })
        : Response.json({
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
  expect(await screen.findByText('Стоимость блюд')).toBeInTheDocument()
  expect(screen.getAllByText('400 ₽')).toHaveLength(2)
  expect(screen.getByRole('button', { name: /Оформить заказ/ })).toHaveTextContent('360 ₽')
})

test('при изменении количества автоматически пересчитывает сумму и игнорирует старый ответ', async () => {
  useCartStore.getState().add(product, options)
  let finishFirst!: (response: Response) => void
  const firstQuote = new Promise<Response>((resolve) => {
    finishFirst = resolve
  })
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === '/api/checkout/config')
      return Promise.resolve(Response.json({ testPaymentEnabled: false }))
    if (url === '/api/checkout/quote') {
      const quantity = JSON.parse(String(init?.body)).lines[0].quantity
      if (quantity === 1) return firstQuote
      return Promise.resolve(
        Response.json({
          lines: [{ productId: 'borscht', name: 'Борщ', quantity: 2, lineTotalKopecks: 72000 }],
          subtotalKopecks: 72000,
          discountKopecks: 0,
          promoDiscountKopecks: 0,
          deliveryKopecks: 0,
          totalKopecks: 72000,
          eligible: true,
          testMode: true,
        }),
      )
    }
    throw new Error(`Неожиданный запрос: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  render(
    <CartDrawer
      fulfillment={{ mode: 'pickup', label: 'Кафе' }}
      savedDelivery={null}
      recommendations={[]}
      onFulfillmentChange={() => {}}
      onGoToAddresses={() => {}}
      onAddRecommendation={() => {}}
    />,
  )
  await waitFor(() =>
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/checkout/quote')).toBe(true),
  )
  await userEvent.setup().click(screen.getByRole('button', { name: 'Увеличить количество «Борщ»' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /Оформить заказ/ })).toHaveTextContent('720 ₽'),
  )
  await act(async () =>
    finishFirst(
      Response.json({
        lines: [],
        subtotalKopecks: 36000,
        discountKopecks: 0,
        promoDiscountKopecks: 0,
        deliveryKopecks: 0,
        totalKopecks: 36000,
        eligible: true,
        testMode: true,
      }),
    ),
  )
  expect(screen.getByRole('button', { name: /Оформить заказ/ })).toHaveTextContent('720 ₽')
})

test('после ошибки расчёта позволяет повторить запрос', async () => {
  useCartStore.getState().add(product, options)
  let attempts = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/checkout/config') return Response.json({ testPaymentEnabled: false })
      if (url === '/api/checkout/quote') {
        attempts++
        if (attempts === 1) throw new Error('offline')
        return Response.json({
          lines: [],
          subtotalKopecks: 36000,
          discountKopecks: 0,
          promoDiscountKopecks: 0,
          deliveryKopecks: 0,
          totalKopecks: 36000,
          eligible: true,
          testMode: true,
        })
      }
      throw new Error(`Неожиданный запрос: ${url}`)
    }),
  )
  render(
    <CartDrawer
      fulfillment={{ mode: 'pickup', label: 'Кафе' }}
      savedDelivery={null}
      recommendations={[]}
      onFulfillmentChange={() => {}}
      onGoToAddresses={() => {}}
      onAddRecommendation={() => {}}
    />,
  )
  await userEvent.setup().click(await screen.findByRole('button', { name: /Повторить расчёт/ }))
  expect(await screen.findByRole('button', { name: /Оформить заказ/ })).toHaveTextContent('360 ₽')
  expect(attempts).toBe(2)
})

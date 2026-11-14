import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useCartStore } from '../../model/cartStore'
import { CartDrawer } from './CartDrawer'
import { BIRTHDAY_CLAIM_RELEASED_EVENT } from '../../../../../shared/birthday'

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
          adjustments: [{ label: 'Бонус-код RUB100', amountKopecks: -10000 }],
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
  const breakdown = screen.getByRole('status', { name: 'Расчёт заказа' })
  expect(breakdown).toHaveTextContent('Стоимость блюд')
  expect(breakdown).toHaveTextContent('Бонус-код RUB100')
  expect(breakdown).toHaveTextContent('−100 ₽')
  expect(breakdown).toHaveTextContent('Итого')
  expect(breakdown).toHaveTextContent('260 ₽')
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

test('заранее рассчитывает закрытую корзину, сохраняет цену при открытии и проверяет её перед оформлением', async () => {
  useCartStore.getState().add(product, options)
  let finishRefresh!: (response: Response) => void
  let requests = 0
  const quote = (totalKopecks: number) =>
    Response.json({
      lines: [{ productId: product.id, name: product.name, quantity: 1, lineTotalKopecks: 40000 }],
      subtotalKopecks: 40000,
      discountKopecks: 4000,
      deliveryKopecks: 0,
      totalKopecks,
      eligible: true,
      testMode: true,
    })
  const fetchMock = vi.fn((url: string) => {
    if (url === '/api/checkout/config')
      return Promise.resolve(Response.json({ testPaymentEnabled: false }))
    if (url === '/api/checkout/quote') {
      requests += 1
      if (requests === 1) return Promise.resolve(quote(36000))
      return new Promise<Response>((resolve) => {
        finishRefresh = resolve
      })
    }
    throw new Error(`Неожиданный запрос: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  const props = {
    fulfillment: { mode: 'pickup' as const, label: 'Кафе' },
    savedDelivery: null,
    recommendations: [],
    onFulfillmentChange: vi.fn(),
    onGoToAddresses: vi.fn(),
    onAddRecommendation: vi.fn(),
  }
  const view = render(<CartDrawer {...props} isOpen={false} />)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await waitFor(() => expect(requests).toBe(1))
  // Let both responses settle before opening.
  await act(async () => {})
  view.rerender(<CartDrawer {...props} isOpen />)
  const checkout = screen.getByRole('button', { name: /Оформить заказ/ })
  expect(checkout).toHaveTextContent('360 ₽')
  expect(checkout).toBeDisabled()
  expect(screen.queryByText(/Цена уточняется|Ожидаем расчёт|Рассчитываем…/)).not.toBeInTheDocument()
  await waitFor(() => expect(requests).toBe(2))
  await act(async () => finishRefresh(quote(35000)))
  expect(checkout).toHaveTextContent('350 ₽')
  expect(checkout).toBeEnabled()

  view.rerender(<CartDrawer {...props} isOpen={false} />)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  view.rerender(<CartDrawer {...props} isOpen />)
  expect(screen.getByRole('button', { name: /Оформить заказ/ })).toHaveTextContent('350 ₽')
  expect(screen.getByRole('button', { name: /Оформить заказ/ })).toBeDisabled()
  await waitFor(() => expect(requests).toBe(3))
  await act(async () => finishRefresh(quote(34000)))
  expect(screen.getByRole('button', { name: /Оформить заказ/ })).toHaveTextContent('340 ₽')
  expect(screen.getByRole('button', { name: /Оформить заказ/ })).toBeEnabled()
  view.rerender(<CartDrawer {...props} isOpen={false} />)
  act(() => useCartStore.getState().clear())
  act(() => useCartStore.getState().add(product, options))
  await waitFor(() => expect(requests).toBe(4))
  await act(async () => finishRefresh(quote(33000)))
  view.rerender(<CartDrawer {...props} isOpen />)
  expect(screen.getByRole('button', { name: /Оформить заказ/ })).toHaveTextContent('330 ₽')
})

test('при раннем открытии показывает индикатор, а при сбое позволяет повторить расчёт', async () => {
  useCartStore.getState().add(product, options)
  let finish!: (response: Response) => void
  const fetchMock = vi.fn((url: string) => {
    if (url === '/api/checkout/config')
      return Promise.resolve(Response.json({ testPaymentEnabled: false }))
    return new Promise<Response>((resolve) => {
      finish = resolve
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  render(
    <CartDrawer
      fulfillment={{ mode: 'pickup', label: 'Кафе' }}
      savedDelivery={null}
      recommendations={[]}
      onFulfillmentChange={vi.fn()}
      onGoToAddresses={vi.fn()}
      onAddRecommendation={vi.fn()}
    />,
  )
  expect(screen.queryByText('Цена уточняется')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Оформить заказ/ })).toBeDisabled()
  await waitFor(() => expect(finish).toBeDefined())
  await act(async () =>
    finish(
      Response.json({ error: { code: 'UNAVAILABLE', message: 'Нет связи' } }, { status: 503 }),
    ),
  )
  const retry = screen.getByRole('button', { name: /Повторить расчёт/ })
  expect(retry).toBeEnabled()
  await userEvent.setup().click(retry)
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4))
  await act(async () =>
    finish(
      Response.json({ lines: [], subtotalKopecks: 36000, totalKopecks: 32400, eligible: true }),
    ),
  )
  expect(screen.getByRole('button', { name: /Оформить заказ/ })).toHaveTextContent('324 ₽')
  expect(screen.getByRole('button', { name: /Оформить заказ/ })).toBeEnabled()
})

test('при изменении цены на этапе оформления заново рассчитывает заказ', async () => {
  useCartStore.getState().add(product, options)
  let requests = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/checkout/config') return Response.json({ testPaymentEnabled: false })
      if (url === '/api/checkout/quote') {
        requests += 1
        return Response.json({
          lines: [],
          subtotalKopecks: 36000,
          totalKopecks: requests === 1 ? 32400 : 35000,
          eligible: true,
        })
      }
      if (url === '/api/orders')
        return Response.json(
          { error: { code: 'PRICE_CHANGED', message: 'Цена изменилась' } },
          { status: 409 },
        )
      throw new Error(`Неожиданный запрос: ${url}`)
    }),
  )
  render(
    <CartDrawer
      fulfillment={{ mode: 'pickup', label: 'Кафе' }}
      savedDelivery={null}
      user={{ id: 'u1', name: 'Руслан', phone: '+79991234567' }}
      recommendations={[]}
      onFulfillmentChange={vi.fn()}
      onGoToAddresses={vi.fn()}
      onAddRecommendation={vi.fn()}
    />,
  )
  const checkout = screen.getByRole('button', { name: /Оформить заказ/ })
  await waitFor(() => expect(checkout).toBeEnabled())
  await userEvent.setup().click(checkout)
  await waitFor(() => expect(checkout).toHaveTextContent('350 ₽'))
  expect(checkout).toBeEnabled()
  expect(requests).toBe(2)
})

test('после отмены заказа сбрасывает сохранённый расчёт и запрашивает новую цену', async () => {
  useCartStore.getState().add(product, options)
  let quotes = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/checkout/config') return Response.json({ testPaymentEnabled: false })
      if (url === '/api/checkout/quote') {
        quotes += 1
        return Response.json({
          lines: [],
          subtotalKopecks: 36000,
          totalKopecks: quotes === 1 ? 32400 : 30000,
          eligible: true,
        })
      }
      throw new Error(`Неожиданный запрос: ${url}`)
    }),
  )
  render(
    <CartDrawer
      fulfillment={{ mode: 'pickup', label: 'Кафе' }}
      savedDelivery={null}
      onFulfillmentChange={vi.fn()}
      onGoToAddresses={vi.fn()}
      recommendations={[]}
      onAddRecommendation={vi.fn()}
    />,
  )
  const checkout = screen.getByRole('button', { name: /Оформить заказ/ })
  await waitFor(() => expect(checkout).toHaveTextContent('324 ₽'))
  act(() => window.dispatchEvent(new Event(BIRTHDAY_CLAIM_RELEASED_EVENT)))
  await waitFor(() => expect(checkout).toHaveTextContent('300 ₽'))
  expect(quotes).toBe(2)
})

test('после отказа в скидке прекращает индикаторы и позволяет снять скидку', async () => {
  useCartStore.getState().add(product, options)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/checkout/config')
        return Response.json({ testPaymentEnabled: false, birthdayAvailable: true })
      if (url === '/api/checkout/quote') {
        if (JSON.parse(String(init?.body)).birthdayDiscount)
          return Response.json(
            { error: { code: 'BIRTHDAY_ALREADY_USED', message: 'Скидка уже использована' } },
            { status: 400 },
          )
        return Response.json({
          lines: [{ productId: product.id, quantity: 1, lineTotalKopecks: 36000 }],
          subtotalKopecks: 36000,
          totalKopecks: 32400,
          eligible: true,
        })
      }
      throw new Error(`Неожиданный запрос: ${url}`)
    }),
  )
  render(
    <CartDrawer
      fulfillment={{ mode: 'pickup', label: 'Кафе' }}
      savedDelivery={null}
      user={{ id: 'u1', name: 'Руслан', phone: '+79991234567' }}
      onFulfillmentChange={vi.fn()}
      onGoToAddresses={vi.fn()}
      recommendations={[]}
      onAddRecommendation={vi.fn()}
    />,
  )
  const checkbox = await screen.findByRole('checkbox', { name: /Скидка ко дню рождения/ })
  await userEvent.setup().click(checkbox)
  await screen.findByText('Скидка уже использована')
  expect(screen.queryAllByLabelText('Рассчитываем стоимость')).toHaveLength(0)
  expect(screen.getByRole('button', { name: /Повторить расчёт/ })).toBeEnabled()
  await userEvent.setup().click(checkbox)
  await waitFor(() => expect(screen.getByRole('button', { name: /Оформить заказ/ })).toBeEnabled())
  expect(screen.getByRole('button', { name: /Оформить заказ/ })).toHaveTextContent('324 ₽')
})

test('не показывает плашку дня рождения за пределами серверного окна', async () => {
  useCartStore.getState().add(product, options)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url === '/api/checkout/config'
        ? Response.json({ testPaymentEnabled: false, birthdayAvailable: false })
        : Response.json({ lines: [], subtotalKopecks: 36000, totalKopecks: 32400, eligible: true }),
    ),
  )
  render(
    <CartDrawer
      fulfillment={{ mode: 'pickup', label: 'Кафе' }}
      savedDelivery={null}
      user={{ id: 'u1', name: 'Руслан', phone: '+79991234567' }}
      onFulfillmentChange={vi.fn()}
      onGoToAddresses={vi.fn()}
      recommendations={[]}
      onAddRecommendation={vi.fn()}
    />,
  )
  await waitFor(() => expect(screen.getByRole('button', { name: /Оформить заказ/ })).toBeEnabled())
  expect(screen.queryByText('Скидка ко дню рождения')).not.toBeInTheDocument()
})

test('применяет скидку сервера и сохраняет цены блюд во время расчёта', async () => {
  useCartStore.getState().add(product, options)
  let finish!: (response: Response) => void
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/checkout/config')
        return Response.json({ testPaymentEnabled: false, birthdayAvailable: true })
      if (JSON.parse(String(init?.body)).birthdayDiscount)
        return new Promise<Response>((resolve) => {
          finish = resolve
        })
      return Response.json({
        lines: [{ productId: product.id, quantity: 1, lineTotalKopecks: 36000 }],
        subtotalKopecks: 36000,
        totalKopecks: 36000,
        eligible: true,
      })
    }),
  )
  render(
    <CartDrawer
      fulfillment={{ mode: 'pickup', label: 'Кафе' }}
      savedDelivery={null}
      user={{ id: 'u1', name: 'Руслан', phone: '+79991234567' }}
      onFulfillmentChange={vi.fn()}
      onGoToAddresses={vi.fn()}
      recommendations={[]}
      onAddRecommendation={vi.fn()}
    />,
  )
  const checkbox = await screen.findByRole('checkbox', { name: /Скидка ко дню рождения/ })
  expect(
    screen.getByText(
      'Вы можете воспользоваться скидкой на товары за 3 дня до дня рождения и 3 дня после.',
    ),
  ).toBeInTheDocument()
  await userEvent.setup().click(checkbox)
  await waitFor(() => expect(finish).toBeDefined())
  expect(screen.getAllByText('360 ₽')).toHaveLength(1)
  expect(screen.getByRole('button', { name: /Оформить заказ/ })).toBeDisabled()
  await act(async () =>
    finish(
      Response.json({
        lines: [{ productId: product.id, quantity: 1, lineTotalKopecks: 36000 }],
        subtotalKopecks: 36000,
        totalKopecks: 32400,
        eligible: true,
        adjustments: [{ label: 'Скидка ко дню рождения (10%)', amountKopecks: -3600 }],
      }),
    ),
  )
  expect(screen.getByRole('button', { name: /Оформить заказ/ })).toHaveTextContent('324 ₽')
  expect(screen.getByRole('button', { name: /Оформить заказ/ })).toBeEnabled()
})

test('при завершении периода скрывает плашку и пересчитывает без сообщения над кнопкой', async () => {
  useCartStore.getState().add(product, options)
  let available = true
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/checkout/config')
        return Response.json({ testPaymentEnabled: false, birthdayAvailable: available })
      if (JSON.parse(String(init?.body)).birthdayDiscount) {
        available = false
        return Response.json(
          {
            error: {
              code: 'BIRTHDAY_OUTSIDE_WINDOW',
              message: 'Скидка доступна за 3 дня до и 3 дня после дня рождения',
            },
          },
          { status: 400 },
        )
      }
      return Response.json({
        lines: [],
        subtotalKopecks: 36000,
        totalKopecks: 36000,
        eligible: true,
      })
    }),
  )
  render(
    <CartDrawer
      fulfillment={{ mode: 'pickup', label: 'Кафе' }}
      savedDelivery={null}
      user={{ id: 'u1', name: 'Руслан', phone: '+79991234567' }}
      onFulfillmentChange={vi.fn()}
      onGoToAddresses={vi.fn()}
      recommendations={[]}
      onAddRecommendation={vi.fn()}
    />,
  )
  await userEvent
    .setup()
    .click(await screen.findByRole('checkbox', { name: /Скидка ко дню рождения/ }))
  await waitFor(() => expect(screen.queryByRole('checkbox')).not.toBeInTheDocument())
  await waitFor(() => expect(screen.getByRole('button', { name: /Оформить заказ/ })).toBeEnabled())
  expect(
    screen.queryByText('Скидка доступна за 3 дня до и 3 дня после дня рождения'),
  ).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Оформить заказ/ })).toHaveTextContent('360 ₽')
})

test('повтор оплаты сохранённого заказа со скидкой не запускает новый расчёт при открытии и обновлении вкладки', async () => {
  useCartStore.getState().add(product, options)
  let saved = false
  const fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/checkout/config')
      return Response.json({ testPaymentEnabled: true, birthdayAvailable: true })
    if (url === '/api/checkout/quote') {
      if (saved)
        return Response.json(
          { error: { code: 'BIRTHDAY_ALREADY_USED', message: 'Скидка зарезервирована' } },
          { status: 400 },
        )
      return Response.json({
        lines: [],
        subtotalKopecks: 36000,
        totalKopecks: 32400,
        eligible: true,
      })
    }
    if (url === '/api/orders') {
      saved = true
      return Response.json({ order: { _id: 'order-retry' } })
    }
    if (url === '/api/orders/order-retry/pay') throw new Error('offline')
    throw new Error(url)
  })
  vi.stubGlobal('fetch', fetchMock)
  const props = {
    fulfillment: { mode: 'pickup' as const, label: 'Кафе' },
    savedDelivery: null,
    user: { id: 'u1', name: 'Руслан', phone: '+79991234567' },
    onFulfillmentChange: vi.fn(),
    onGoToAddresses: vi.fn(),
    recommendations: [],
    onAddRecommendation: vi.fn(),
  }
  const view = render(<CartDrawer {...props} />)
  await userEvent
    .setup()
    .click(await screen.findByRole('checkbox', { name: /Скидка ко дню рождения/ }))
  const pay = screen.getByRole('button', { name: /Перейти к оплате/ })
  await waitFor(() => expect(pay).toBeEnabled())
  await userEvent.setup().click(pay)
  await screen.findByText('Нет связи с локальным сервером')
  const quotes = fetchMock.mock.calls.filter(([url]) => url === '/api/checkout/quote').length
  view.rerender(<CartDrawer {...props} isOpen={false} />)
  view.rerender(<CartDrawer {...props} isOpen />)
  act(() => document.dispatchEvent(new Event('visibilitychange')))
  const retry = screen.getByRole('button', { name: /Повторить переход к оплате/ })
  expect(retry).toBeEnabled()
  await userEvent.setup().click(retry)
  await waitFor(() =>
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/pay'))).toHaveLength(2),
  )
  expect(fetchMock.mock.calls.filter(([url]) => url === '/api/checkout/quote')).toHaveLength(quotes)
  expect(fetchMock.mock.calls.filter(([url]) => url === '/api/orders')).toHaveLength(1)
})

test('сохраняет ответ о доступности акции даже если расчёт завершается раньше с ошибкой', async () => {
  useCartStore.getState().add(product, options)
  let finishConfig!: (response: Response) => void
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/checkout/config')
        return new Promise<Response>((resolve) => {
          finishConfig = resolve
        })
      return Response.json(
        { error: { code: 'INVALID_PROMO_CODE', message: 'Код недействителен' } },
        { status: 400 },
      )
    }),
  )
  render(
    <CartDrawer
      fulfillment={{ mode: 'pickup', label: 'Кафе' }}
      savedDelivery={null}
      user={{ id: 'u1', name: 'Руслан', phone: '+79991234567' }}
      onFulfillmentChange={vi.fn()}
      onGoToAddresses={vi.fn()}
      recommendations={[]}
      onAddRecommendation={vi.fn()}
    />,
  )
  await waitFor(() => expect(finishConfig).toBeDefined())
  await act(async () =>
    finishConfig(Response.json({ testPaymentEnabled: false, birthdayAvailable: true })),
  )
  expect(
    await screen.findByRole('checkbox', { name: /Скидка ко дню рождения/ }),
  ).toBeInTheDocument()
  expect(screen.getByText('Код недействителен')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Повторить расчёт/ })).toBeEnabled()
})

test('успешный ответ оплаты не очищает товары, добавленные во время запроса', async () => {
  useCartStore.getState().clear()
  useCartStore.getState().add(product, options)
  let finishPayment!: (response: Response) => void
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/checkout/config') return Response.json({ testPaymentEnabled: true })
      if (url === '/api/checkout/quote')
        return Response.json({
          lines: [],
          subtotalKopecks: 36000,
          totalKopecks: 32400,
          eligible: true,
        })
      if (url === '/api/orders') return Response.json({ order: { _id: 'order-pay' } })
      return new Promise<Response>((resolve) => {
        finishPayment = resolve
      })
    }),
  )
  render(
    <CartDrawer
      fulfillment={{ mode: 'pickup', label: 'Кафе' }}
      savedDelivery={null}
      user={{ id: 'u1', name: 'Руслан', phone: '+79991234567' }}
      onFulfillmentChange={vi.fn()}
      onGoToAddresses={vi.fn()}
      recommendations={[]}
      onAddRecommendation={vi.fn()}
    />,
  )
  const pay = await screen.findByRole('button', { name: /Перейти к оплате/ })
  await userEvent.setup().click(pay)
  await waitFor(() => expect(finishPayment).toBeDefined())
  act(() => useCartStore.getState().add({ id: 'latte', name: 'Латте', priceRub: 220 }, options))
  await act(async () => finishPayment(Response.json({ status: 'succeeded' })))
  expect(useCartStore.getState().lines.map((line) => line.productId)).toEqual(['borscht', 'latte'])
  expect(useCartStore.getState().pendingPayment).toBeNull()
})

test('после потери ответа создания заказа повторяет тот же ключ без повторного резервирования скидки', async () => {
  useCartStore.getState().clear()
  useCartStore.getState().add(product, options)
  let creates = 0
  const keys: (string | null)[] = []
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/checkout/config')
      return Response.json({ testPaymentEnabled: false, birthdayAvailable: true })
    if (url === '/api/checkout/quote') {
      if (creates)
        return Response.json(
          { error: { code: 'BIRTHDAY_ALREADY_USED', message: 'Скидка зарезервирована' } },
          { status: 400 },
        )
      return Response.json({
        lines: [],
        subtotalKopecks: 36000,
        totalKopecks: 32400,
        eligible: true,
      })
    }
    if (url === '/api/orders') {
      keys.push(new Headers(init?.headers).get('Idempotency-Key'))
      if (++creates === 1) throw new Error('Ответ потерян после сохранения заказа')
      return Response.json({ order: { _id: 'same-order' } })
    }
    throw new Error(url)
  })
  vi.stubGlobal('fetch', fetchMock)
  const props = {
    fulfillment: { mode: 'pickup' as const, label: 'Кафе' },
    savedDelivery: null,
    user: { id: 'u1', name: 'Руслан', phone: '+79991234567' },
    onFulfillmentChange: vi.fn(),
    onGoToAddresses: vi.fn(),
    recommendations: [],
    onAddRecommendation: vi.fn(),
  }
  const view = render(<CartDrawer {...props} />)
  await userEvent
    .setup()
    .click(await screen.findByRole('checkbox', { name: /Скидка ко дню рождения/ }))
  const checkout = screen.getByRole('button', { name: /Оформить заказ/ })
  await waitFor(() => expect(checkout).toBeEnabled())
  await userEvent.setup().click(checkout)
  await screen.findByText('Нет связи с локальным сервером')
  view.rerender(<CartDrawer {...props} isOpen={false} />)
  view.rerender(<CartDrawer {...props} isOpen />)
  act(() => document.dispatchEvent(new Event('visibilitychange')))
  expect(screen.getByRole('button', { name: /Оформить заказ/ })).toBeEnabled()
  await userEvent.setup().click(screen.getByRole('button', { name: /Оформить заказ/ }))
  await screen.findByText('Заказ same-ord сохранён.')
  expect(keys).toHaveLength(2)
  expect(keys[0]).toBeTruthy()
  expect(keys[1]).toBe(keys[0])
})

test('после истечения срока создаёт новый заказ с новым ключом, сохраняя товары', async () => {
  const shopper = userEvent.setup()
  useCartStore.getState().add(product, options)
  const keys: (string | null)[] = []
  let attempt = 0
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
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
    if (url === '/api/orders') {
      keys.push(new Headers(init?.headers).get('Idempotency-Key'))
      return Response.json({ order: { _id: `order-${++attempt}` } })
    }
    if (url === '/api/orders/order-1/pay')
      return Response.json(
        { error: { code: 'ORDER_CANCELED', message: 'Время оплаты истекло. Заказ отменён' } },
        { status: 409 },
      )
    if (url === '/api/orders/order-2/pay') return Response.json({ status: 'pending' })
    throw new Error(url)
  })
  vi.stubGlobal('fetch', fetchMock)
  render(
    <CartDrawer
      fulfillment={{ mode: 'pickup', label: 'Кафе' }}
      savedDelivery={null}
      user={{ id: 'u1', name: 'Руслан', phone: '+79991234567' }}
      onFulfillmentChange={() => {}}
      onGoToAddresses={() => {}}
      recommendations={[]}
      onAddRecommendation={() => {}}
    />,
  )
  await shopper.click(
    await screen.findByRole('button', { name: /Оформить заказ|Перейти к оплате/ }),
  )
  await screen.findByText('Время оплаты истекло. Заказ отменён')
  expect(useCartStore.getState().lines).toHaveLength(1)
  expect(useCartStore.getState().pendingPayment).toBeNull()
  const checkout = await screen.findByRole('button', { name: /Оформить заказ|Перейти к оплате/ })
  await waitFor(() => expect(checkout).toBeEnabled())
  await shopper.click(checkout)
  await waitFor(() => expect(keys).toHaveLength(2))
  expect(keys[1]).not.toBe(keys[0])
  expect(fetchMock.mock.calls.some(([url]) => url === '/api/orders/order-2/pay')).toBe(true)
  expect(useCartStore.getState().lines).toHaveLength(1)
})

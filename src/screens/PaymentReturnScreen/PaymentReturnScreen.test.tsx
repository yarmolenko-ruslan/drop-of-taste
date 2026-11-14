import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { PaymentReturnScreen } from './PaymentReturnScreen'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

test('возврат с ЮKassa показывает успех только после проверки сервером', async () => {
  let finishCheck!: (response: Response) => void
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finishCheck = resolve
        }),
    ),
  )
  render(
    <MemoryRouter initialEntries={['/payment/return?orderId=order-123']}>
      <PaymentReturnScreen />
    </MemoryRouter>,
  )
  expect(screen.getByText('Проверяем оплату в ЮKassa…')).toBeInTheDocument()
  finishCheck(Response.json({ status: 'succeeded' }))
  expect(await screen.findByText('Оплата прошла успешно.')).toBeInTheDocument()
})

test('отменённый платёж не показывается как оплаченный', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ status: 'canceled' })),
  )
  render(
    <MemoryRouter initialEntries={['/payment/return?orderId=order-123']}>
      <PaymentReturnScreen />
    </MemoryRouter>,
  )
  expect(
    await screen.findByText('Платёж отменён. Вы можете оформить новый заказ.'),
  ).toBeInTheDocument()
  expect(screen.queryByText('Оплата прошла успешно.')).not.toBeInTheDocument()
})

test('незавершённый платёж предлагает вернуться к оплате', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ status: 'pending' })),
  )
  render(
    <MemoryRouter initialEntries={['/payment/return?orderId=order-123']}>
      <PaymentReturnScreen />
    </MemoryRouter>,
  )
  expect(await screen.findByRole('button', { name: 'Вернуться к оплате' })).toBeInTheDocument()
  expect(
    screen.getByText('Платёж пока не завершён. Вы можете вернуться к оплате.'),
  ).toBeInTheDocument()
})

test('после временной ошибки связи проверяет оплату повторно без нажатия кнопки', async () => {
  vi.useFakeTimers()
  const fetchMock = vi
    .fn()
    .mockRejectedValueOnce(new Error('Нет связи'))
    .mockResolvedValueOnce(Response.json({ status: 'succeeded' }))
  vi.stubGlobal('fetch', fetchMock)
  render(
    <MemoryRouter initialEntries={['/payment/return?orderId=order-123']}>
      <PaymentReturnScreen />
    </MemoryRouter>,
  )
  await act(async () => Promise.resolve())
  expect(screen.getByRole('alert')).toHaveTextContent('Повторяем проверку автоматически')
  await act(async () => vi.advanceTimersByTime(5000))
  expect(screen.getByText('Оплата прошла успешно.')).toBeInTheDocument()
  expect(fetchMock).toHaveBeenCalledTimes(2)
})

test.each(['succeeded', 'canceled'] as const)(
  'подтверждение %s учитывает сохранённую корзину',
  async (status) => {
    const { useCartStore } = await import('../../features/cart')
    const store = useCartStore.getState()
    store.clear()
    store.add(
      { id: 'borscht', name: 'Борщ', priceRub: 360 },
      {
        variant: '',
        removedIngredients: [],
        extras: {},
        quantity: 1,
      },
    )
    store.rememberPayment('order-123', 'u1')
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
      void _url
      void _init
      return Response.json({ status })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(
      <MemoryRouter initialEntries={['/payment/return?orderId=order-123']}>
        <PaymentReturnScreen />
      </MemoryRouter>,
    )
    await screen.findByText(
      status === 'succeeded'
        ? 'Оплата прошла успешно.'
        : 'Платёж отменён. Вы можете оформить новый заказ.',
    )
    expect(useCartStore.getState().lines).toHaveLength(status === 'succeeded' ? 0 : 1)
    expect(new Headers(fetchMock.mock.calls[0]![1]?.headers).get('X-Account-Id')).toBe('u1')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    store.clear()
  },
)

test.each(['pending', 'succeeded'])(
  'отменённый заказ при платеже %s не предлагает оплату заново',
  async (status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ status, orderCanceled: true })),
    )
    render(
      <MemoryRouter initialEntries={['/payment/return?orderId=expired-order']}>
        <PaymentReturnScreen />
      </MemoryRouter>,
    )
    expect(await screen.findByText(/Время оплаты истекло. Заказ отменён/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Вернуться к оплате' })).not.toBeInTheDocument()
    expect(screen.queryByText('Оплата прошла успешно.')).not.toBeInTheDocument()
    if (status === 'succeeded') expect(screen.getByRole('status')).toHaveTextContent('для возврата')
  },
)

test('после задержки провайдера восстанавливает оплату вовремя и очищает исходную корзину', async () => {
  const { useCartStore } = await import('../../features/cart')
  const store = useCartStore.getState()
  store.clear()
  store.add(
    { id: 'borscht', name: 'Борщ', priceRub: 360 },
    { variant: '', removedIngredients: [], extras: {}, quantity: 1 },
  )
  store.rememberPayment('delayed-order', 'u1')
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ status: 'pending', orderCanceled: true }))
    .mockResolvedValueOnce(Response.json({ status: 'succeeded' }))
  vi.stubGlobal('fetch', fetchMock)
  vi.useFakeTimers()
  render(
    <MemoryRouter initialEntries={['/payment/return?orderId=delayed-order']}>
      <PaymentReturnScreen />
    </MemoryRouter>,
  )
  await act(async () => {})
  expect(screen.getByRole('status')).toHaveTextContent('Заказ отменён')
  expect(useCartStore.getState().pendingPayment).not.toBeNull()
  expect(useCartStore.getState().lines).toHaveLength(1)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10000)
  })
  expect(screen.getByRole('status')).toHaveTextContent('Оплата прошла успешно.')
  expect(useCartStore.getState().lines).toHaveLength(0)
  expect(useCartStore.getState().pendingPayment).toBeNull()
  expect(fetchMock).toHaveBeenCalledTimes(2)
  store.clear()
})

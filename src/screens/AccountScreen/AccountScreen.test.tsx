import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { AccountScreen } from './AccountScreen'
import { useCartStore } from '../../features/cart'

const { calls, state, catalogState } = vi.hoisted(() => ({
  calls: [] as { path: string; method: string; body: unknown; accountId: string | null }[],
  catalogState: { value: null as unknown },
  state: {
    profile: {
      name: 'Руслан Ярмоленко',
      email: '',
      birthday: '',
      notifications: { push: false, email: false, sms: false },
      selectedAddressId: null as string | null,
    },
    addresses: [] as { id: string; mode: 'delivery'; label: string; details: unknown }[],
    orders: [] as unknown[],
    ordersNextCursor: null as string | null,
    paymentEnabled: false,
    moreOrdersResponse: null as Promise<{ orders: unknown[]; nextCursor: string | null }> | null,
    failOrders: false,
    notificationSaves: [] as Array<() => void>,
  },
}))
vi.mock('../../features/catalog/api/CatalogProvider', () => ({
  useCatalog: () => catalogState.value,
}))
vi.mock('../../features/auth/api/authApi', () => ({
  ApiError: class extends Error {
    code = 'UNAUTHENTICATED'
  },
  apiRequest: async (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ path, method, body, accountId: new Headers(init?.headers).get('X-Account-Id') })
    if (path === '/checkout/config') return { testPaymentEnabled: state.paymentEnabled }
    if (path === '/profile' && method === 'PUT') {
      state.profile = { ...state.profile, ...body }
      return { profile: state.profile }
    }
    if (path === '/profile/delivery-selection' && method === 'PUT') {
      state.profile = { ...state.profile, selectedAddressId: body.addressId }
      return { selectedAddressId: body.addressId }
    }
    if (path === '/profile/notifications' && method === 'PUT') {
      return new Promise((resolve) => {
        state.notificationSaves.push(() => {
          state.profile.notifications = body as typeof state.profile.notifications
          resolve({ notifications: body })
        })
      })
    }
    if (path === '/profile') return { profile: state.profile }
    if (path.startsWith('/orders?cursor='))
      return state.moreOrdersResponse ?? { orders: [], nextCursor: null }
    if (path === '/orders') {
      if (state.failOrders) throw new Error('Заказы недоступны')
      return { orders: [...state.orders], nextCursor: state.ordersNextCursor }
    }
    if (path.startsWith('/orders/') && method === 'POST') {
      const id = path.split('/')[2]!
      const existing = state.orders as { _id: string }[]
      const updated = {
        ...(existing.find((order) => order._id === id) as Record<string, unknown>),
        status: 'completed',
        completedAt: '2026-11-04T11:00:00.000Z',
      }
      state.orders = existing.map((order) => (order._id === id ? updated : order))
      return { order: updated }
    }
    if (path === '/addresses' && method === 'POST') {
      const address = { id: `a${state.addresses.length + 1}`, mode: 'delivery' as const, ...body }
      state.addresses.push(address)
      return { address }
    }
    if (path === '/addresses') return { addresses: [...state.addresses] }
    if (path.startsWith('/addresses/') && method === 'DELETE') {
      state.addresses = state.addresses.filter((item) => item.id !== path.split('/').pop())
      return undefined
    }
    if (path.startsWith('/addresses/') && method === 'PUT') {
      const id = path.split('/').pop()!
      const address = { id, mode: 'delivery' as const, ...body }
      state.addresses = state.addresses.map((item) => (item.id === id ? address : item))
      return { address }
    }
    throw new Error(`Unexpected request: ${path}`)
  },
}))

const userData = { id: 'u1', name: 'Руслан Ярмоленко', phone: '+79991234567' }
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})
beforeEach(() => {
  catalogState.value = null
  useCartStore.setState({ lines: [], isOpen: false })
  calls.length = 0
  state.profile = {
    name: userData.name,
    email: '',
    birthday: '',
    notifications: { push: false, email: false, sms: false },
    selectedAddressId: null,
  }
  state.addresses = []
  state.orders = []
  state.ordersNextCursor = null
  state.paymentEnabled = false
  state.moreOrdersResponse = null
  state.failOrders = false
  state.notificationSaves = []
})
function renderAccount(
  section: string,
  onUpdateUser = vi.fn(),
  onAddressPicked?: () => void,
  onLogout = vi.fn(),
) {
  const view = render(
    <MemoryRouter initialEntries={[`/account/${section}`]}>
      <Routes>
        <Route
          path="/account/:section?"
          element={
            <AccountScreen
              user={userData}
              onLogout={onLogout}
              onUpdateUser={onUpdateUser}
              onAddressPicked={onAddressPicked}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  )
  return Object.assign(view, { onUpdateUser, onLogout })
}

test('выход требует подтверждения и может быть отменён', async () => {
  const user = userEvent.setup()
  const view = renderAccount('addresses')
  await screen.findByRole('button', { name: 'Выйти' })
  await user.click(screen.getByRole('button', { name: 'Выйти' }))
  expect(screen.getByRole('heading', { name: 'Выйти из аккаунта?' })).toBeInTheDocument()
  expect(view.onLogout).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Остаться' }))
  expect(view.onLogout).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Выйти' }))
  await user.click(screen.getByRole('button', { name: 'Да, выйти' }))
  expect(view.onLogout).toHaveBeenCalledOnce()
})

test('ошибка загрузки заказов не выглядит как пустая история', async () => {
  state.failOrders = true
  renderAccount('orders')
  expect(
    await screen.findByRole('button', { name: 'Повторить загрузку заказов' }),
  ).toBeInTheDocument()
  expect(screen.queryByText('Заказов пока нет.')).not.toBeInTheDocument()
  state.failOrders = false
  await userEvent.setup().click(screen.getByRole('button', { name: 'Повторить загрузку заказов' }))
  expect(await screen.findByText('Заказов пока нет.')).toBeInTheDocument()
})

test('старый ответ продолжения не портит обновлённую историю заказов', async () => {
  const makeOrder = (id: string) => ({
    _id: `${id}-0000-0000-0000-000000000000`,
    createdAt: '2026-11-04T12:02:00.000Z',
    status: 'test',
    input: { fulfillment: { mode: 'pickup', label: 'г. Красноярск, улица Петра Подзолкова, 3и' } },
    quote: { lines: [], discountKopecks: 0, deliveryKopecks: 0, totalKopecks: 0 },
  })
  state.orders = [makeOrder('aaaaaa')]
  state.ordersNextCursor = 'old-cursor'
  let finishMore!: (result: { orders: unknown[]; nextCursor: string | null }) => void
  state.moreOrdersResponse = new Promise((resolve) => {
    finishMore = resolve
  })
  function Harness() {
    const [revision, setRevision] = useState(0)
    return (
      <>
        <button type="button" onClick={() => setRevision((value) => value + 1)}>
          Обновить список
        </button>
        <AccountScreen
          user={userData}
          ordersRevision={revision}
          onLogout={() => {}}
          onUpdateUser={() => {}}
        />
      </>
    )
  }
  render(
    <MemoryRouter initialEntries={['/account/orders']}>
      <Routes>
        <Route path="/account/:section?" element={<Harness />} />
      </Routes>
    </MemoryRouter>,
  )
  const user = userEvent.setup()
  expect(await screen.findByText('Заказ №AAAAAA')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Загрузить ещё заказы' }))
  state.orders = [makeOrder('bbbbbb'), ...state.orders]
  state.ordersNextCursor = 'new-cursor'
  await user.click(screen.getByRole('button', { name: 'Обновить список' }))
  expect(await screen.findByText('Заказ №BBBBBB')).toBeInTheDocument()
  await act(async () => finishMore({ orders: [makeOrder('cccccc')], nextCursor: null }))
  expect(screen.queryByText('Заказ №CCCCCC')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Загрузить ещё заказы' })).toBeInTheDocument()
})

test('карточка адреса разделяет город, улицу и дом', async () => {
  state.addresses = [
    {
      id: 'a1',
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
    },
  ]
  renderAccount('addresses')
  expect(
    await screen.findByText('г. Красноярск, ул. Мира, д. 17, под. 1, эт. 1, кв. 1'),
  ).toBeInTheDocument()
})

test('профиль загружается и сохраняется через API', async () => {
  const user = userEvent.setup()
  const onUpdate = renderAccount('profile')
  const name = await screen.findByRole('textbox', { name: 'Имя' })
  expect(name).toHaveAttribute('maxLength', '22')
  await user.clear(name)
  await user.type(name, 'Руслан')
  await user.type(screen.getByRole('textbox', { name: 'Эл. почта' }), 'test@example.ru')
  await user.click(screen.getByRole('button', { name: 'Сохранить' }))
  await waitFor(() =>
    expect(onUpdate.onUpdateUser).toHaveBeenCalledWith({ ...userData, name: 'Руслан' }),
  )
  expect(
    calls.some(
      (call) =>
        call.path === '/profile' &&
        call.method === 'PUT' &&
        (call.body as { email: string }).email === 'test@example.ru',
    ),
  ).toBe(true)
  expect(
    calls
      .filter(
        (call) =>
          call.path.startsWith('/profile') ||
          call.path.startsWith('/addresses') ||
          call.path.startsWith('/orders'),
      )
      .every((call) => call.accountId === userData.id),
  ).toBe(true)
  expect(screen.queryByRole('button', { name: 'Удалить профиль' })).not.toBeInTheDocument()
})

test('настройки уведомлений сохраняются последовательно', async () => {
  renderAccount('profile')
  const user = userEvent.setup()
  const push = await screen.findByRole('checkbox', { name: 'Push-уведомления' })
  const sms = screen.getByRole('checkbox', { name: 'SMS-уведомления' })
  await user.click(push)
  expect(sms).toBeDisabled()
  expect(state.notificationSaves).toHaveLength(1)
  await act(async () => state.notificationSaves.shift()?.())
  expect(sms).toBeEnabled()
  await user.click(sms)
  await act(async () => state.notificationSaves.shift()?.())
  expect(state.profile.notifications).toEqual({ push: true, email: false, sms: true })
})

test('вкладка заказов показывает иконку пустого состояния', async () => {
  renderAccount('orders')
  expect(await screen.findByText('Заказов пока нет.')).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Активные заказы' })).toBeInTheDocument()
})

test('карточка заказа показывает статус-ленту, состав и итог', async () => {
  state.orders = [
    {
      _id: 'abcdef12-3456-7890-abcd-ef1234567890',
      createdAt: '2026-11-04T12:02:00.000Z',
      input: {
        fulfillment: { mode: 'pickup', label: 'г. Красноярск, улица Петра Подзолкова, 3и' },
      },
      quote: {
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
        discountKopecks: 3600,
        deliveryKopecks: 0,
        totalKopecks: 32400,
      },
    },
  ]
  renderAccount('orders')
  expect(await screen.findByText('Заказ №ABCDEF')).toBeInTheDocument()
  expect(screen.getAllByText('Обработка заявки')).toHaveLength(2)
  expect(screen.getByText('Завершён')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Отметить выполненным/ })).not.toBeInTheDocument()
  expect(screen.queryByText('Передан в кафе')).not.toBeInTheDocument()
  expect(
    screen.getByText('Самовывоз · г. Красноярск, улица Петра Подзолкова, 3и'),
  ).toBeInTheDocument()
  expect(screen.getByText('Борщ × 1')).toBeInTheDocument()
  expect(screen.getByText('Скидка самовывоза')).toBeInTheDocument()
  expect(screen.getByText('Итого')).toBeInTheDocument()
  expect(screen.getByText('324 ₽')).toBeInTheDocument()
})

test('заказ на 0 ₽ показывает бонус-код и завершается без попытки оплаты', async () => {
  state.paymentEnabled = true
  state.orders = [
    {
      _id: 'free1234-3456-7890-abcd-ef1234567890',
      createdAt: '2026-11-04T12:02:00.000Z',
      status: 'test',
      paymentStatus: 'unpaid',
      input: {
        fulfillment: { mode: 'pickup', label: 'г. Красноярск, улица Петра Подзолкова, 3и' },
      },
      quote: {
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
        discountKopecks: 0,
        promoCode: 'FREE100',
        promoDiscountKopecks: 36000,
        deliveryKopecks: 0,
        totalKopecks: 0,
      },
    },
  ]
  renderAccount('orders')
  expect(await screen.findByText('Бонус-код FREE100')).toBeInTheDocument()
  expect(screen.getAllByText('Обработка заявки').length).toBeGreaterThan(0)
  expect(screen.getByText('Не требуется — заказ на 0 ₽')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Оплатить заказ' })).not.toBeInTheDocument()
  await userEvent.setup().click(screen.getByRole('button', { name: 'Завершить оформление' }))
  await waitFor(() =>
    expect(
      calls.some(
        (call) =>
          call.path === '/orders/free1234-3456-7890-abcd-ef1234567890/complete' &&
          call.method === 'POST',
      ),
    ).toBe(true),
  )
})

test.each(['pending', 'succeeded', 'canceled'] as const)(
  'этапы приготовления сохраняются при статусе оплаты $paymentStatus',
  async (paymentStatus) => {
    state.paymentEnabled = true
    state.orders = [
      {
        _id: 'abcdef12-3456-7890-abcd-ef1234567890',
        createdAt: '2026-11-04T12:02:00.000Z',
        status: 'test',
        paymentStatus,
        input: {
          fulfillment: { mode: 'pickup', label: 'г. Красноярск, улица Петра Подзолкова, 3и' },
        },
        quote: { lines: [], discountKopecks: 0, deliveryKopecks: 0, totalKopecks: 32400 },
      },
    ]
    renderAccount('orders')
    if (paymentStatus === 'canceled') {
      expect(await screen.findByText('Нет активных заказов.')).toBeInTheDocument()
      await userEvent.setup().click(screen.getByRole('button', { name: /4 ноября/ }))
    }
    const timeline = await screen.findByRole('list', { name: 'Этапы заказа' })
    expect(within(timeline).getAllByRole('listitem')).toHaveLength(4)
    expect(within(timeline).getByText('Обработка заявки')).toBeInTheDocument()
    expect(within(timeline).getByText('Приготовление')).toBeInTheDocument()
    expect(within(timeline).getByText('Завершён')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Отметить выполненным/ })).not.toBeInTheDocument()
  },
)

test('завершённый заказ находится в истории и раскрывается', async () => {
  const user = userEvent.setup()
  state.orders = [
    {
      _id: 'abcdef12-3456-7890-abcd-ef1234567890',
      createdAt: '2026-11-04T10:00:00.000Z',
      status: 'completed',
      completedAt: '2026-11-04T11:00:00.000Z',
      input: {
        fulfillment: { mode: 'pickup', label: 'г. Красноярск, улица Петра Подзолкова, 3и' },
      },
      quote: {
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
        discountKopecks: 3600,
        deliveryKopecks: 0,
        totalKopecks: 32400,
      },
    },
  ]
  renderAccount('orders')
  expect(await screen.findByText('История заказов')).toBeInTheDocument()
  expect(screen.getByText('Ноябрь 2026')).toBeInTheDocument()
  expect(screen.getByText('1 заказ')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: /4 ноября/ }))
  expect(screen.getByRole('button', { name: 'Повторить заказ' })).toBeInTheDocument()
  expect(screen.getAllByText('Завершён')).toHaveLength(2)
  expect(screen.queryByText('Выдан')).not.toBeInTheDocument()
})

test('повтор недоступного блюда не добавляет устаревшую цену в корзину', async () => {
  catalogState.value = {
    data: { categories: [{ products: [] }], newArrivalIds: [] },
    itemsById: new Map(),
    loading: false,
    error: '',
    retry: () => {},
  }
  const user = userEvent.setup()
  state.orders = [
    {
      _id: 'abcdef12-3456-7890-abcd-ef1234567890',
      createdAt: '2026-11-04T10:00:00.000Z',
      input: {
        fulfillment: { mode: 'pickup', label: 'г. Красноярск, улица Петра Подзолкова, 3и' },
      },
      quote: {
        lines: [
          {
            productId: 'removed',
            name: 'Старое блюдо',
            quantity: 1,
            unitPriceKopecks: 10000,
            lineTotalKopecks: 10000,
          },
        ],
        discountKopecks: 1000,
        deliveryKopecks: 0,
        totalKopecks: 9000,
      },
    },
  ]
  renderAccount('orders')
  await user.click(await screen.findByRole('button', { name: 'Повторить заказ' }))
  expect(screen.getByText(/Старое блюдо.*недоступен/)).toBeInTheDocument()
  expect(useCartStore.getState().lines).toHaveLength(0)
})

test('выбранный адрес сохраняется на сервере и восстанавливается после перезагрузки', async () => {
  const user = userEvent.setup()
  state.addresses = [
    {
      id: 'a1',
      mode: 'delivery',
      label: 'ул. Мира, 10, подъезд 2, 3 этаж, квартира 25',
      details: {
        street: 'ул. Мира, 10',
        entrance: '2',
        floor: '3',
        flat: '25',
        comment: '',
        isHouse: false,
      },
    },
  ]
  const first = renderAccount('addresses')
  await user.click(await screen.findByRole('radio', { name: /ул\. Мира, д\. 10/ }))
  expect(
    calls.some(
      (call) =>
        call.path === '/profile/delivery-selection' &&
        call.method === 'PUT' &&
        (call.body as { addressId: string }).addressId === 'a1',
    ),
  ).toBe(true)
  first.unmount()
  renderAccount('addresses')
  expect(await screen.findByRole('radio', { name: /ул\. Мира, д\. 10/ })).toBeChecked()
})

test('выбор адреса из сценария корзины вызывает возврат после успешного сохранения', async () => {
  const user = userEvent.setup()
  state.addresses = [
    {
      id: 'a1',
      mode: 'delivery',
      label: 'ул. Мира, 10, квартира 25',
      details: {
        street: 'ул. Мира, 10',
        entrance: '',
        floor: '',
        flat: '25',
        comment: '',
        isHouse: true,
      },
    },
  ]
  const onAddressPicked = vi.fn()
  renderAccount('addresses', vi.fn(), onAddressPicked)
  await user.click(await screen.findByRole('radio', { name: /ул\. Мира, д\. 10/ }))
  await waitFor(() => expect(onAddressPicked).toHaveBeenCalledTimes(1))
})

test('выбор удалённого адреса не восстанавливается', async () => {
  state.profile.selectedAddressId = 'deleted-address'
  renderAccount('addresses')
  expect(await screen.findByRole('heading', { name: 'Адреса доставки' })).toBeInTheDocument()
  expect(screen.queryByRole('radio')).not.toBeInTheDocument()
})

test('адрес добавляется и удаляется через API', async () => {
  const user = userEvent.setup()
  renderAccount('addresses')
  await screen.findByRole('button', { name: 'Добавить новый адрес' })
  await user.click(screen.getByRole('button', { name: 'Добавить новый адрес' }))
  await user.type(screen.getByRole('textbox', { name: 'Улица и дом' }), 'ул. Мира, 10')
  await user.type(screen.getByRole('textbox', { name: 'Подъезд' }), '2')
  await user.type(screen.getByRole('textbox', { name: 'Этаж' }), '3')
  await user.type(screen.getByRole('textbox', { name: 'Квартира' }), '25')
  await user.click(screen.getByRole('button', { name: 'Сохранить выбор' }))
  await screen.findByText('ул. Мира, д. 10, под. 2, эт. 3, кв. 25')
  expect(calls.some((call) => call.path === '/addresses' && call.method === 'POST')).toBe(true)
  await user.click(screen.getByRole('button', { name: /Удалить адрес/ }))
  const dialog = await screen.findByRole('dialog', { name: 'Удалить адрес?' })
  expect(
    within(dialog).getByText(
      '«ул. Мира, д. 10, под. 2, эт. 3, кв. 25» будет удалён без возможности восстановления.',
    ),
  ).toBeInTheDocument()
  await user.click(within(dialog).getByRole('button', { name: 'Отмена' }))
  expect(screen.queryByRole('dialog', { name: 'Удалить адрес?' })).not.toBeInTheDocument()
  expect(calls.some((call) => call.path === '/addresses/a1' && call.method === 'DELETE')).toBe(
    false,
  )
  await user.click(screen.getByRole('button', { name: /Удалить адрес/ }))
  await user.click(
    within(await screen.findByRole('dialog', { name: 'Удалить адрес?' })).getByRole('button', {
      name: 'Удалить',
    }),
  )
  await waitFor(() => expect(screen.queryByRole('radio')).not.toBeInTheDocument())
  expect(calls.some((call) => call.path === '/addresses/a1' && call.method === 'DELETE')).toBe(true)
  expect(
    calls.some(
      (call) =>
        call.path === '/profile/delivery-selection' &&
        call.method === 'PUT' &&
        (call.body as { addressId: string | null }).addressId === null,
    ),
  ).toBe(false)
})

test.each([
  { stage: 'preparing', current: 'Приготовление' },
  { stage: 'delivering', current: 'Доставка' },
] as const)('личный кабинет показывает этап $current', async ({ stage, current }) => {
  state.orders = [
    {
      _id: 'abcdef12-3456-7890-abcd-ef1234567890',
      createdAt: '2026-11-04T12:02:00.000Z',
      fulfillmentStatus: stage,
      input: { fulfillment: { mode: 'delivery', label: 'Красноярск, Ленина, 1' } },
      quote: { lines: [], discountKopecks: 0, deliveryKopecks: 0, totalKopecks: 50000 },
    },
  ]
  renderAccount('orders')
  const timeline = await screen.findByRole('list', { name: 'Этапы заказа' })
  expect(within(timeline).getAllByRole('listitem')).toHaveLength(4)
  expect(within(timeline).getByText(current).closest('li')).toHaveAttribute('aria-current', 'step')
})

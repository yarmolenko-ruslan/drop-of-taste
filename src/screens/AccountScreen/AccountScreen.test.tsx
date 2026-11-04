import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { AccountScreen } from './AccountScreen'

const { calls, state } = vi.hoisted(() => ({
  calls: [] as { path: string; method: string; body: unknown }[],
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
  },
}))
vi.mock('../../features/auth/api/authApi', () => ({
  apiRequest: async (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ path, method, body })
    if (path === '/profile' && method === 'PUT') {
      state.profile = { ...state.profile, ...body }
      return { profile: state.profile }
    }
    if (path === '/profile/delivery-selection' && method === 'PUT') {
      state.profile = { ...state.profile, selectedAddressId: body.addressId }
      return { selectedAddressId: body.addressId }
    }
    if (path === '/profile') return { profile: state.profile }
    if (path === '/orders') return { orders: state.orders }
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

const userData = { name: 'Руслан Ярмоленко', phone: '+79991234567' }
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})
beforeEach(() => {
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
})
function renderAccount(section: string, onUpdateUser = vi.fn(), onAddressPicked?: () => void) {
  const view = render(
    <MemoryRouter initialEntries={[`/account/${section}`]}>
      <Routes>
        <Route
          path="/account/:section?"
          element={
            <AccountScreen
              user={userData}
              onLogout={() => {}}
              onUpdateUser={onUpdateUser}
              onAddressPicked={onAddressPicked}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  )
  return Object.assign(view, { onUpdateUser })
}

test('профиль загружается и сохраняется через API', async () => {
  const user = userEvent.setup()
  const onUpdate = renderAccount('profile')
  const name = await screen.findByRole('textbox', { name: 'Имя' })
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
  expect(screen.queryByRole('button', { name: 'Удалить профиль' })).not.toBeInTheDocument()
})

test('вкладка заказов показывает иконку пустого состояния', async () => {
  renderAccount('orders')
  expect(await screen.findByText('Тестовых заказов пока нет.')).toBeInTheDocument()
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
  expect(await screen.findByText('Тестовый заказ №ABCDEF')).toBeInTheDocument()
  expect(screen.getByText('Не передан в кафе')).toBeInTheDocument()
  expect(screen.getByText('Создан')).toBeInTheDocument()
  expect(screen.getByText('Передан в кафе')).toBeInTheDocument()
  expect(
    screen.getByText('Самовывоз · г. Красноярск, улица Петра Подзолкова, 3и'),
  ).toBeInTheDocument()
  expect(screen.getByText('Борщ × 1')).toBeInTheDocument()
  expect(screen.getByText('Скидка самовывоза')).toBeInTheDocument()
  expect(screen.getByText('Итого')).toBeInTheDocument()
  expect(screen.getByText('324 ₽')).toBeInTheDocument()
})

test('заказ можно отметить выполненным — он переходит в историю и раскрывается', async () => {
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
  await user.click(await screen.findByRole('button', { name: 'Отметить выполненным (тест)' }))
  expect(await screen.findByText('История заказов')).toBeInTheDocument()
  expect(screen.getByText('Ноябрь 2026')).toBeInTheDocument()
  expect(screen.getByText('1 заказ')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: /4 ноября/ }))
  expect(screen.getByRole('button', { name: 'Повторить заказ' })).toBeInTheDocument()
  expect(screen.getByText('Выполнен (тест)')).toBeInTheDocument()
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
  await user.click(await screen.findByRole('radio', { name: /ул\. Мира, 10/ }))
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
  expect(await screen.findByRole('radio', { name: /ул\. Мира, 10/ })).toBeChecked()
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
  await user.click(await screen.findByRole('radio', { name: /ул\. Мира, 10/ }))
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
  await screen.findByText('ул. Мира, 10, подъезд 2, 3 этаж, квартира 25')
  expect(calls.some((call) => call.path === '/addresses' && call.method === 'POST')).toBe(true)
  await user.click(screen.getByRole('button', { name: /Удалить адрес/ }))
  await waitFor(() => expect(screen.queryByRole('radio')).not.toBeInTheDocument())
  expect(calls.some((call) => call.path === '/addresses/a1' && call.method === 'DELETE')).toBe(true)
})

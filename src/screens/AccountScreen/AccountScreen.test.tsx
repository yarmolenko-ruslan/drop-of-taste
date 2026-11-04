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
      state.profile = body
      return { profile: body }
    }
    if (path === '/profile') return { profile: state.profile }
    if (path === '/orders') return { orders: state.orders }
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
  }
  state.addresses = []
  state.orders = []
})
function renderAccount(section: string, onUpdateUser = vi.fn()) {
  render(
    <MemoryRouter initialEntries={[`/account/${section}`]}>
      <Routes>
        <Route
          path="/account/:section?"
          element={
            <AccountScreen user={userData} onLogout={() => {}} onUpdateUser={onUpdateUser} />
          }
        />
      </Routes>
    </MemoryRouter>,
  )
  return onUpdateUser
}

test('профиль загружается и сохраняется через API', async () => {
  const user = userEvent.setup()
  const onUpdate = renderAccount('profile')
  const name = await screen.findByRole('textbox', { name: 'Имя' })
  await user.clear(name)
  await user.type(name, 'Руслан')
  await user.type(screen.getByRole('textbox', { name: 'Эл. почта' }), 'test@example.ru')
  await user.click(screen.getByRole('button', { name: 'Сохранить' }))
  await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ ...userData, name: 'Руслан' }))
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

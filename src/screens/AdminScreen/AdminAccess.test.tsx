import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { defaultSiteContent } from '../../../shared/site-content'
import type { AdminPrincipal, Employee, Permission } from '../../../shared/admin-access'
import { AdminScreen } from './AdminScreen'
import { EmployeesEditor } from './EmployeesEditor'
import { ProductsEditor } from './CatalogEditors'
import { BonusCodesEditor } from './BonusCodesEditor'
import type { Dashboard, Product } from './adminTypes'
import { ApiError } from '../../features/auth/api/authApi'

const request = vi.hoisted(() => vi.fn())
vi.mock('../../features/auth/api/authApi', async (original) => ({
  ...(await original<typeof import('../../features/auth/api/authApi')>()),
  apiRequest: request,
}))
const principal = (permissions: Permission[] = [], mustChangePassword = false): AdminPrincipal => ({
  id: 'employee',
  name: 'Анна',
  role: 'employee',
  permissions,
  mustChangePassword,
})
const employee: Employee = {
  id: 'employee',
  login: 'anna',
  name: 'Анна',
  active: true,
  permissions: ['orders.read'],
  mustChangePassword: false,
  revision: 'old-revision',
  createdAt: '2026-11-17T00:00:00Z',
  updatedAt: '2026-11-17T00:00:00Z',
}
const dashboard: Dashboard = {
  content: defaultSiteContent,
  products: [],
  categories: [],
  iikoConfigured: false,
}
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})
beforeEach(() => {
  request.mockReset()
  localStorage.clear()
})
function renderPanel(staffLogin = false) {
  return render(
    <MemoryRouter>
      <AdminScreen staffLogin={staffLogin} />
    </MemoryRouter>,
  )
}

test('staff sign-in sends login, displays only assigned navigation, and hides owner sections', async () => {
  request.mockImplementation(async (path: string) => {
    if (path === '/admin/activity') return undefined
    if (path === '/admin/session') throw new Error('not logged in')
    if (path === '/admin/login')
      return { authenticated: true, principal: principal(['orders.read']) }
    if (path === '/admin/dashboard') return dashboard
    if (path.startsWith('/admin/orders?')) return { orders: [], nextBefore: null }
    throw new Error(path)
  })
  const user = userEvent.setup()
  renderPanel(true)
  await user.type(await screen.findByLabelText('Логин'), 'anna')
  await user.type(screen.getByLabelText('Пароль'), 'my-personal-password')
  await user.click(screen.getByRole('button', { name: 'Войти' }))
  const navigation = await screen.findByRole('navigation', { name: 'Разделы панели' })
  expect(within(navigation).getAllByRole('button')).toHaveLength(1)
  expect(within(navigation).getByRole('button', { name: 'Заказы' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Сотрудники' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Журнал' })).not.toBeInTheDocument()
  expect(JSON.parse(request.mock.calls.find(([path]) => path === '/admin/login')![1].body)).toEqual(
    { login: 'anna', password: 'my-personal-password' },
  )
  expect(
    screen.getByText('Только просмотр. Право редактирования выдаёт владелец.'),
  ).toBeInTheDocument()
})

test('empty permissions show an explanation without querying any private working endpoints', async () => {
  request.mockImplementation(async (path: string) =>
    path === '/admin/session' ? { authenticated: true, principal: principal() } : dashboard,
  )
  renderPanel()
  expect(await screen.findByText('Рабочие разделы пока недоступны')).toBeInTheDocument()
  expect(
    request.mock.calls.every(([path]) => ['/admin/session', '/admin/dashboard'].includes(path)),
  ).toBe(true)
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
})

test('first login gates all work until matching passwords are submitted; success requires a new sign-in', async () => {
  request.mockImplementation(async (path: string) => {
    if (path === '/admin/activity') return undefined
    if (path === '/admin/session')
      return { authenticated: true, principal: principal(['site.read'], true) }
    if (path === '/admin/password') return { authenticated: false }
    throw new Error(path)
  })
  const user = userEvent.setup()
  renderPanel(true)
  expect(await screen.findByText('Замените временный пароль')).toBeInTheDocument()
  expect(request).not.toHaveBeenCalledWith('/admin/dashboard')
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  await user.type(screen.getByLabelText('Текущий пароль'), 'temporary-password')
  await user.type(screen.getByLabelText('Новый пароль'), 'new-personal-password')
  await user.type(screen.getByLabelText('Повторите новый пароль'), 'different-password')
  await user.click(screen.getByRole('button', { name: 'Сохранить новый пароль' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Новые пароли не совпадают')
  expect(request.mock.calls.filter(([path]) => path === '/admin/password')).toHaveLength(0)
  await user.clear(screen.getByLabelText('Повторите новый пароль'))
  await user.type(screen.getByLabelText('Повторите новый пароль'), 'new-personal-password')
  await user.click(screen.getByRole('button', { name: 'Сохранить новый пароль' }))
  expect(await screen.findByText('Пароль изменён. Войдите с новым паролем.')).toBeInTheDocument()
  expect(screen.getByLabelText('Пароль')).toHaveValue('')
  expect(localStorage.getItem('drop-of-taste:admin-session-changed')).toBeTruthy()
})

test('read-only site fields cannot edit, while revoked sessions clear the interface', async () => {
  request.mockImplementation(async (path: string) =>
    path === '/admin/session'
      ? { authenticated: true, principal: principal(['site.read']) }
      : dashboard,
  )
  renderPanel()
  expect(await screen.findByLabelText('Название кафе')).toBeDisabled()
  expect(screen.getAllByRole('button', { name: 'Сохранить сайт' })[0]).toBeDisabled()
  act(() => window.dispatchEvent(new Event('drop-of-taste:admin-session-expired')))
  expect(await screen.findByRole('button', { name: 'Войти' })).toBeInTheDocument()
  expect(screen.queryByLabelText('Название кафе')).not.toBeInTheDocument()
})

test('a new account login in another tab clears old private state', async () => {
  request.mockImplementation(async (path: string) =>
    path === '/admin/session'
      ? { authenticated: true, principal: principal(['site.read']) }
      : dashboard,
  )
  renderPanel()
  await screen.findByLabelText('Название кафе')
  act(() =>
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'drop-of-taste:admin-session-changed',
        newValue: 'new-account',
      }),
    ),
  )
  expect(screen.queryByLabelText('Название кафе')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Войти' })).toBeInTheDocument()
})

test('owner can apply a preset, override one permission, and create an employee with a one-time password', async () => {
  request.mockImplementation(async (_path: string, init?: RequestInit) =>
    init?.method === 'POST'
      ? {
          employee: { ...employee, mustChangePassword: true },
          temporaryPassword: 'one-time-secret-password',
        }
      : { employees: [] },
  )
  const user = userEvent.setup()
  render(<EmployeesEditor />)
  await screen.findByText('Сотрудников пока нет.')
  await user.type(screen.getByLabelText('Имя сотрудника'), 'Анна')
  await user.type(screen.getByLabelText('Логин сотрудника'), 'anna')
  await user.click(screen.getByLabelText('Шаблон прав'))
  await user.click(screen.getByRole('option', { name: 'Оператор' }))
  expect(screen.getByRole('checkbox', { name: 'Заказы: редактирование' })).toBeChecked()
  await user.click(screen.getByRole('checkbox', { name: 'Заказы: редактирование' }))
  expect(screen.getByRole('checkbox', { name: 'Заказы: просмотр' })).toBeChecked()
  await user.click(screen.getByRole('button', { name: 'Создать сотрудника' }))
  expect(await screen.findByText('one-time-secret-password')).toBeInTheDocument()
  const payload = JSON.parse(
    request.mock.calls.find(([, init]) => init?.method === 'POST')![1].body,
  )
  expect(payload).toEqual({
    name: 'Анна',
    login: 'anna',
    active: true,
    permissions: ['orders.read'],
  })
  expect(Object.values(localStorage).join('')).not.toContain('one-time-secret-password')
  await user.click(screen.getByRole('button', { name: 'Реквизиты сохранены, скрыть' }))
  expect(screen.queryByText('one-time-secret-password')).not.toBeInTheDocument()
})

test('password reset requires confirmation, supports cancel, and submits the selected revision', async () => {
  request.mockImplementation(async (_path: string, init?: RequestInit) =>
    init?.method === 'POST'
      ? {
          employee: { ...employee, revision: 'new-revision' },
          temporaryPassword: 'new-temporary-secret',
        }
      : { employees: [employee] },
  )
  const user = userEvent.setup()
  render(<EmployeesEditor />)
  await user.click(await screen.findByRole('button', { name: /Анна.*anna/ }))
  expect(screen.getByLabelText('Логин сотрудника')).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Выдать новый временный пароль' }))
  await user.click(screen.getByRole('button', { name: 'Отмена' }))
  expect(
    request.mock.calls.some(
      ([path, init]) => path.endsWith('/reset-password') && init?.method === 'POST',
    ),
  ).toBe(false)
  await user.click(screen.getByRole('button', { name: 'Выдать новый временный пароль' }))
  await user.click(screen.getByRole('button', { name: 'Подтвердить выдачу пароля' }))
  expect(await screen.findByText('new-temporary-secret')).toBeInTheDocument()
  expect(request).toHaveBeenCalledWith('/admin/employees/employee/reset-password', {
    method: 'POST',
    body: JSON.stringify({ revision: 'old-revision' }),
  })
})

test('stale employee edit displays conflict and does not silently retry or replace the draft', async () => {
  request.mockImplementation(async (_path: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') throw new Error('Запись изменилась. Выберите сотрудника заново')
    return { employees: [employee] }
  })
  const user = userEvent.setup()
  render(<EmployeesEditor />)
  await user.click(await screen.findByRole('button', { name: /Анна.*anna/ }))
  await user.clear(screen.getByLabelText('Имя сотрудника'))
  await user.type(screen.getByLabelText('Имя сотрудника'), 'Анна новая')
  await user.click(screen.getByRole('button', { name: 'Сохранить сотрудника и отозвать сессии' }))
  expect(
    await screen.findByText('Запись изменилась. Выберите сотрудника заново'),
  ).toBeInTheDocument()
  expect(screen.getByLabelText('Имя сотрудника')).toHaveValue('Анна новая')
  expect(request.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1)
})

test('read-only catalog and bonus codes still permit selecting records while disabling all mutations', async () => {
  const product: Product = {
    _id: 'dish',
    categoryId: 'cat',
    sortOrder: 0,
    name: 'Суп',
    details: '',
    description: 'Состав супа',
    image: '',
    imageAlt: '',
    badges: [],
    action: 'add',
    measure: 'г',
    amount: 250,
    calories: null,
    ingredients: ['Картофель'],
    allergenNote: '',
    extras: [],
    portions: '',
    priceKopecks: 25000,
    available: true,
  }
  const view = render(
    <ProductsEditor
      canManage={false}
      data={{
        ...dashboard,
        products: [product],
        categories: [{ _id: 'cat', title: 'Супы', subtitle: '', sortOrder: 0 }],
      }}
      refresh={vi.fn()}
    />,
  )
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Суп' }))
  expect(screen.getByLabelText('Название')).toHaveValue('Суп')
  expect(screen.getByLabelText('Название')).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Удалить товар' })).toBeDisabled()
  expect(screen.getAllByRole('button', { name: 'Сохранить товар' })[0]).toBeDisabled()
  expect(request).not.toHaveBeenCalled()
  view.unmount()
  request.mockResolvedValue({
    codes: [
      {
        _id: 'TASTE10',
        kind: 'percent',
        value: 10,
        startsAt: '2026-11-01T00:00:00Z',
        endsAt: '2026-12-01T00:00:00Z',
        active: true,
      },
    ],
  })
  render(<BonusCodesEditor canManage={false} />)
  await user.click(await screen.findByRole('button', { name: 'TASTE10' }))
  expect(screen.getByLabelText('Код для клиента')).toHaveValue('TASTE10')
  expect(screen.getByRole('button', { name: 'Удалить код' })).toBeDisabled()
  expect(request).toHaveBeenCalledTimes(1)
})

test('read-only orders keep filters available but do not expose stage transitions', async () => {
  request.mockImplementation(async (path: string) => {
    if (path === '/admin/activity') return undefined
    if (path === '/admin/session')
      return { authenticated: true, principal: principal(['orders.read']) }
    if (path === '/admin/dashboard') return dashboard
    return {
      orders: [
        {
          _id: 'order',
          fulfillmentStatus: 'new',
          createdAt: new Date().toISOString(),
          quote: { totalKopecks: 100, lines: [] },
          input: { fulfillment: { mode: 'pickup', label: 'Кафе' } },
        },
      ],
      nextBefore: null,
    }
  })
  renderPanel()
  await screen.findByText('№ORDER')
  expect(screen.queryByRole('button', { name: /Принять заказ/ })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('tab', { name: /В работе/ }))
  await waitFor(() =>
    expect(request.mock.calls.some(([path]) => path.includes('stage=preparing'))).toBe(true),
  )
})

test('employee search filters by login and a matching record opens with the keyboard', async () => {
  const second = { ...employee, id: 'second', login: 'boris', name: 'Борис' }
  request.mockResolvedValue({ employees: [employee, second] })
  const user = userEvent.setup()
  render(<EmployeesEditor />)
  await screen.findByRole('button', { name: /Борис.*boris/ })
  await user.click(screen.getByRole('searchbox', { name: 'Поиск сотрудника' }))
  await user.type(screen.getByRole('searchbox'), 'BOR')
  expect(screen.queryByRole('button', { name: /Анна.*anna/ })).not.toBeInTheDocument()
  await user.tab()
  await user.keyboard('{Enter}')
  expect(screen.getByLabelText('Имя сотрудника')).toHaveValue('Борис')
  expect(screen.getByLabelText('Логин сотрудника')).toHaveValue('boris')
  expect(screen.getByLabelText('Логин сотрудника')).toBeDisabled()
})

test('employee names render as text rather than executable markup', async () => {
  const dangerousName = '<img src=x onerror=alert(1)>'
  request.mockResolvedValue({ employees: [{ ...employee, name: dangerousName }] })
  const view = render(<EmployeesEditor />)
  expect(await screen.findByText(dangerousName)).toBeInTheDocument()
  expect(view.container.querySelector('img')).toBeNull()
  expect(view.container.querySelector('script')).toBeNull()
})

test.each([false, true])(
  'sign-in page (staff=%s) does not link to the other administrative entry',
  async (staffLogin) => {
    request.mockRejectedValue(new Error('not authenticated'))
    renderPanel(staffLogin)
    await screen.findByRole('button', { name: 'Войти' })
    const targets = screen.getAllByRole('link').map((link) => link.getAttribute('href'))
    expect(targets).toEqual(['/'])
    expect(screen.queryByText('Вход для владельца')).not.toBeInTheDocument()
    expect(screen.queryByText('Вход для сотрудника')).not.toBeInTheDocument()
  },
)

test('one-time credentials display the employee entry as plain text, without a cross-link', async () => {
  request.mockImplementation(async (_path: string, init?: RequestInit) =>
    init?.method === 'POST'
      ? { employee, temporaryPassword: 'temporary-test-secret' }
      : { employees: [] },
  )
  const user = userEvent.setup()
  render(<EmployeesEditor />)
  await screen.findByText('Сотрудников пока нет.')
  await user.type(screen.getByLabelText('Имя сотрудника'), 'Анна')
  await user.type(screen.getByLabelText('Логин сотрудника'), 'anna')
  await user.click(screen.getByRole('button', { name: 'Создать сотрудника' }))
  const credentials = await screen.findByRole('region', { name: 'Реквизиты сотрудника' })
  expect(within(credentials).getByText(`${window.location.origin}/staff`)).toBeInTheDocument()
  expect(within(credentials).queryByRole('link')).not.toBeInTheDocument()
})

test('restricted dashboard and save payloads preserve the allowed editor and do not send default fields from other sections', async () => {
  const writes: Partial<typeof defaultSiteContent>[] = []
  request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/admin/activity') return undefined
    if (path === '/admin/session')
      return { authenticated: true, principal: principal(['promotions.read', 'promotions.manage']) }
    if (path === '/admin/dashboard') return { ...dashboard, content: { promotions: [] } }
    if (path === '/admin/content') {
      const patch = JSON.parse(String(init?.body))
      writes.push(patch)
      return { content: { promotions: patch.promotions } }
    }
    throw new Error(path)
  })
  const user = userEvent.setup()
  renderPanel(true)
  await user.click(await screen.findByRole('button', { name: 'Добавить акцию' }))
  await user.click(screen.getAllByRole('button', { name: 'Сохранить акции' })[0]!)
  await waitFor(() => expect(writes).toHaveLength(1))
  expect(Object.keys(writes[0]!)).toEqual(['promotions'])
  expect(await screen.findAllByText('Сохранено. Сайт обновится автоматически.')).toHaveLength(2)
  expect(screen.getByRole('button', { name: 'Добавить акцию' })).toBeInTheDocument()
})

test('an immediate dashboard authentication failure clears the panel even before the authenticated effect is committed', async () => {
  request.mockImplementation(async (path: string) => {
    if (path === '/admin/activity') return undefined
    if (path === '/admin/session')
      return { authenticated: true, principal: principal(['orders.read']) }
    if (path === '/admin/dashboard') {
      window.dispatchEvent(new Event('drop-of-taste:admin-session-expired'))
      throw new Error('Войдите заново')
    }
    throw new Error(path)
  })
  renderPanel()
  expect(await screen.findByRole('button', { name: 'Войти' })).toBeInTheDocument()
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
})

test('checkbox permissions keep read and manage consistent and never offer client editing', async () => {
  request.mockResolvedValue({ employees: [] })
  const user = userEvent.setup()
  render(<EmployeesEditor />)
  await screen.findByText('Сотрудников пока нет.')
  const read = screen.getByRole('checkbox', { name: 'Каталог: просмотр' })
  const manage = screen.getByRole('checkbox', { name: 'Каталог: редактирование' })
  expect(read).not.toBeChecked()
  expect(manage).not.toBeChecked()
  await user.click(manage)
  expect(read).toBeChecked()
  expect(manage).toBeChecked()
  await user.click(read)
  expect(read).not.toBeChecked()
  expect(manage).not.toBeChecked()
  await user.click(read)
  expect(read).toBeChecked()
  expect(manage).not.toBeChecked()
  expect(
    screen.queryByRole('checkbox', { name: 'Клиенты: редактирование' }),
  ).not.toBeInTheDocument()
  expect(screen.queryByRole('combobox', { name: 'Каталог' })).not.toBeInTheDocument()
})

test('new credentials open in a modal, can be copied and reopened, and disappear after leaving the page', async () => {
  let created = false
  request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/admin/activity') return undefined
    if (init?.method === 'POST') {
      created = true
      return { employee, temporaryPassword: 'visible-one-time-password' }
    }
    return { employees: created ? [employee] : [] }
  })
  const user = userEvent.setup()
  const write = vi.spyOn(navigator.clipboard, 'writeText')
  const view = render(<EmployeesEditor />)
  await screen.findByText('Сотрудников пока нет.')
  expect(screen.getByText(/Пароль создаётся автоматически/)).toBeInTheDocument()
  await user.type(screen.getByLabelText('Имя сотрудника'), 'Анна')
  await user.type(screen.getByLabelText('Логин сотрудника'), 'anna')
  await user.click(screen.getByRole('button', { name: 'Создать сотрудника' }))
  const dialog = await screen.findByRole('dialog', { name: 'Сохраните временный пароль' })
  expect(within(dialog).getByText('visible-one-time-password')).toBeInTheDocument()
  await user.click(within(dialog).getByRole('button', { name: 'Скопировать данные для входа' }))
  expect(await screen.findByText('Реквизиты скопированы')).toBeInTheDocument()
  expect(write).toHaveBeenCalledWith(
    expect.stringContaining('Временный пароль: visible-one-time-password'),
  )
  expect(request).toHaveBeenCalledWith('/admin/activity', {
    method: 'POST',
    body: JSON.stringify({
      type: 'employee.credentials.copy',
      employeeId: employee.id,
      revision: employee.revision,
    }),
  })
  await user.click(screen.getByRole('button', { name: 'Реквизиты сохранены, скрыть' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Показать данные для входа' }))
  expect(await screen.findByRole('dialog')).toBeInTheDocument()
  expect(request).toHaveBeenCalledWith('/admin/activity', {
    method: 'POST',
    body: JSON.stringify({
      type: 'employee.credentials.view',
      employeeId: employee.id,
      revision: employee.revision,
    }),
  })
  expect(JSON.stringify(request.mock.calls)).not.toContain('visible-one-time-password')
  expect(Object.values(localStorage).join('')).not.toContain('visible-one-time-password')
  view.unmount()
  render(<EmployeesEditor />)
  await user.click(await screen.findByRole('button', { name: /Анна.*anna/ }))
  expect(screen.queryByText('visible-one-time-password')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Показать данные для входа' }),
  ).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Выдать новый временный пароль' })).toBeInTheDocument()
})

test.each(['view', 'copy'] as const)(
  'stale credentials are discarded when the server rejects %s',
  async (mode) => {
    request.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/admin/activity')
        throw new ApiError('EMPLOYEE_CREDENTIALS_CHANGED', 'Реквизиты сотрудника устарели.')
      if (init?.method === 'POST') return { employee, temporaryPassword: 'obsolete-secret' }
      return { employees: [] }
    })
    const user = userEvent.setup()
    const clipboard = vi.spyOn(navigator.clipboard, 'writeText')
    render(<EmployeesEditor />)
    await screen.findByText('Сотрудников пока нет.')
    await user.type(screen.getByLabelText('Имя сотрудника'), 'Анна')
    await user.type(screen.getByLabelText('Логин сотрудника'), 'anna')
    await user.click(screen.getByRole('button', { name: 'Создать сотрудника' }))
    await screen.findByRole('dialog')
    if (mode === 'view') {
      await user.click(screen.getByRole('button', { name: 'Реквизиты сохранены, скрыть' }))
      await user.click(screen.getByRole('button', { name: 'Показать данные для входа' }))
    } else await user.click(screen.getByRole('button', { name: 'Скопировать данные для входа' }))
    expect(await screen.findByText('Реквизиты сотрудника устарели.')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText('obsolete-secret')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Показать данные для входа' }),
    ).not.toBeInTheDocument()
    expect(clipboard).not.toHaveBeenCalled()
    expect(JSON.stringify(request.mock.calls)).not.toContain('obsolete-secret')
    expect(Object.values(localStorage).join('')).not.toContain('obsolete-secret')
  },
)

test('a journal failure cannot trigger clipboard access or suggest bypassing the failed check', async () => {
  request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/admin/activity') throw new ApiError('AUDIT_UNAVAILABLE', 'Журнал недоступен.')
    if (init?.method === 'POST') return { employee, temporaryPassword: 'protected-password' }
    return { employees: [] }
  })
  const user = userEvent.setup()
  const clipboard = vi.spyOn(navigator.clipboard, 'writeText')
  render(<EmployeesEditor />)
  await screen.findByText('Сотрудников пока нет.')
  await user.type(screen.getByLabelText('Имя сотрудника'), 'Анна')
  await user.type(screen.getByLabelText('Логин сотрудника'), 'anna')
  await user.click(screen.getByRole('button', { name: 'Создать сотрудника' }))
  await screen.findByRole('dialog')
  await user.click(screen.getByRole('button', { name: 'Скопировать данные для входа' }))
  expect(await screen.findByText('Журнал недоступен.')).toBeInTheDocument()
  expect(clipboard).not.toHaveBeenCalled()
  expect(screen.queryByText(/Выделите и скопируйте/)).not.toBeInTheDocument()
})

test('a generated password survives saving permissions and reselecting the same current employee', async () => {
  let current = { ...employee, active: false }
  let created = false
  request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/admin/activity') return undefined
    if (init?.method === 'POST') {
      created = true
      return {
        employee: current,
        temporaryPassword: 'keep-this-password',
        temporaryPasswordExpiresAt: '2099-01-01T00:00:00Z',
      }
    }
    if (init?.method === 'PATCH') {
      current = { ...current, active: true, revision: 'new-revision' }
      return { employee: current }
    }
    return { employees: created ? [current] : [] }
  })
  const user = userEvent.setup()
  render(<EmployeesEditor />)
  await user.type(screen.getByLabelText('Имя сотрудника'), 'Анна')
  await user.type(screen.getByLabelText('Логин сотрудника'), 'anna')
  await user.click(screen.getByLabelText('Статус сотрудника'))
  await user.click(screen.getByRole('option', { name: 'Заблокирован' }))
  await user.click(screen.getByRole('button', { name: 'Создать сотрудника' }))
  await screen.findByText('keep-this-password')
  expect(
    screen.getByText('Учётная запись заблокирована. Для входа включите сотрудника в его карточке.'),
  ).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Реквизиты сохранены, скрыть' }))
  await user.click(screen.getByLabelText('Статус сотрудника'))
  await user.click(screen.getByRole('option', { name: 'Активен' }))
  await user.click(screen.getByRole('button', { name: 'Сохранить сотрудника и отозвать сессии' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Показать данные для входа' })).toBeEnabled(),
  )
  await user.click(screen.getByRole('button', { name: /Анна.*anna/ }))
  await user.click(screen.getByRole('button', { name: 'Показать данные для входа' }))
  expect(await screen.findByText('keep-this-password')).toBeInTheDocument()
  expect(request).toHaveBeenCalledWith('/admin/activity', {
    method: 'POST',
    body: JSON.stringify({
      type: 'employee.credentials.view',
      employeeId: employee.id,
      revision: 'new-revision',
    }),
  })
  expect(
    screen.queryByText(
      'Учётная запись заблокирована. Для входа включите сотрудника в его карточке.',
    ),
  ).not.toBeInTheDocument()
})

test('reopening expired credentials shows the actual deadline and prevents copying them as valid', async () => {
  const deadline = new Date(Date.now() + 60_000).toISOString()
  request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/admin/activity') return undefined
    if (init?.method === 'POST')
      return {
        employee,
        temporaryPassword: 'expired-later-password',
        temporaryPasswordExpiresAt: deadline,
      }
    return { employees: [] }
  })
  const user = userEvent.setup()
  render(<EmployeesEditor />)
  await screen.findByText('Сотрудников пока нет.')
  await user.type(screen.getByLabelText('Имя сотрудника'), 'Анна')
  await user.type(screen.getByLabelText('Логин сотрудника'), 'anna')
  await user.click(screen.getByRole('button', { name: 'Создать сотрудника' }))
  const dialog = await screen.findByRole('dialog')
  expect(dialog.querySelector('time')).toHaveAttribute('datetime', deadline)
  await user.click(screen.getByRole('button', { name: 'Реквизиты сохранены, скрыть' }))
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse(deadline) + 1)
  try {
    await user.click(screen.getByRole('button', { name: 'Показать данные для входа' }))
    expect(
      await screen.findByText('Временный пароль истёк. Закройте окно и выдайте новый пароль.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Скопировать данные для входа' })).toBeDisabled()
  } finally {
    clock.mockRestore()
  }
})

test('a late initial employee list cannot hide an employee created while that list was loading', async () => {
  let finishInitial!: (value: unknown) => void
  let reads = 0
  request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/admin/activity') return undefined
    if (init?.method === 'POST') return { employee, temporaryPassword: 'new-account-secret' }
    if (++reads === 1)
      return new Promise((resolve) => {
        finishInitial = resolve
      })
    return { employees: [employee] }
  })
  const user = userEvent.setup()
  render(<EmployeesEditor />)
  await user.type(screen.getByLabelText('Имя сотрудника'), 'Анна')
  await user.type(screen.getByLabelText('Логин сотрудника'), 'anna')
  await user.click(screen.getByRole('button', { name: 'Создать сотрудника' }))
  await screen.findByText('new-account-secret')
  await user.click(screen.getByRole('button', { name: 'Реквизиты сохранены, скрыть' }))
  await screen.findByRole('button', { name: /Анна.*anna/ })
  await act(async () => finishInitial({ employees: [] }))
  expect(screen.getByRole('button', { name: /Анна.*anna/ })).toBeInTheDocument()
  expect(screen.queryByText('Сотрудников пока нет.')).not.toBeInTheDocument()
})

test('an abandoned employee save never starts a fresh request in the next screen', async () => {
  let failSave!: (error: Error) => void
  request.mockImplementation(async (_path: string, init?: RequestInit) => {
    if (init?.method === 'POST')
      return new Promise((_resolve, reject) => {
        failSave = reject
      })
    return { employees: [] }
  })
  const user = userEvent.setup()
  const view = render(<EmployeesEditor />)
  await screen.findByText('Сотрудников пока нет.')
  await user.type(screen.getByLabelText('Имя сотрудника'), 'Анна')
  await user.type(screen.getByLabelText('Логин сотрудника'), 'anna')
  await user.click(screen.getByRole('button', { name: 'Создать сотрудника' }))
  view.unmount()
  await act(async () => failSave(new Error('The administrative identity changed')))
  expect(request.mock.calls.filter(([path]) => path === '/admin/employees')).toHaveLength(2)
})

test.each(['close', 'leave'] as const)(
  'a late copy authorization cannot copy credentials after %s',
  async (mode) => {
    let finishCopy!: () => void
    request.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/admin/activity') {
        if (JSON.parse(String(init?.body)).type === 'employee.credentials.copy')
          return new Promise<void>((resolve) => {
            finishCopy = resolve
          })
        return undefined
      }
      if (init?.method === 'POST')
        return { employee, temporaryPassword: 'never-copy-after-dismissal' }
      return { employees: [] }
    })
    const user = userEvent.setup()
    const clipboard = vi.spyOn(navigator.clipboard, 'writeText')
    const view = render(<EmployeesEditor />)
    await screen.findByText('Сотрудников пока нет.')
    await user.type(screen.getByLabelText('Имя сотрудника'), 'Анна')
    await user.type(screen.getByLabelText('Логин сотрудника'), 'anna')
    await user.click(screen.getByRole('button', { name: 'Создать сотрудника' }))
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: 'Скопировать данные для входа' }))
    if (mode === 'leave') view.unmount()
    else await user.click(screen.getByRole('button', { name: 'Реквизиты сохранены, скрыть' }))
    await act(async () => finishCopy())
    expect(clipboard).not.toHaveBeenCalled()
  },
)

test('credentials that expire while copy authorization is in flight never reach the clipboard', async () => {
  const deadline = new Date(Date.now() + 60_000).toISOString()
  let finishCopy!: () => void
  request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/admin/activity') {
      if (JSON.parse(String(init?.body)).type === 'employee.credentials.copy')
        return new Promise<void>((resolve) => {
          finishCopy = resolve
        })
      return undefined
    }
    if (init?.method === 'POST')
      return {
        employee,
        temporaryPassword: 'must-not-copy-expired',
        temporaryPasswordExpiresAt: deadline,
      }
    return { employees: [] }
  })
  const user = userEvent.setup()
  const clipboard = vi.spyOn(navigator.clipboard, 'writeText')
  render(<EmployeesEditor />)
  await screen.findByText('Сотрудников пока нет.')
  await user.type(screen.getByLabelText('Имя сотрудника'), 'Анна')
  await user.type(screen.getByLabelText('Логин сотрудника'), 'anna')
  await user.click(screen.getByRole('button', { name: 'Создать сотрудника' }))
  await screen.findByRole('dialog')
  await user.click(screen.getByRole('button', { name: 'Скопировать данные для входа' }))
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse(deadline) + 1)
  try {
    await act(async () => finishCopy())
    expect(clipboard).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Скопировать данные для входа' })).toBeDisabled()
    expect(screen.getByText('Временный пароль истёк. Выдайте новый пароль.')).toBeInTheDocument()
  } finally {
    clock.mockRestore()
  }
})

test('opening an employee and editing fields do not submit activity events', async () => {
  request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/admin/employees' && !init?.method) return { employees: [employee] }
    if (path === `/admin/employees/${employee.id}` && init?.method === 'PATCH')
      return { employee: { ...employee, name: 'Анна Новая', revision: 'new-revision' } }
    throw new Error(`Unexpected request: ${path}`)
  })
  const user = userEvent.setup()
  render(<EmployeesEditor />)
  await user.click(await screen.findByRole('button', { name: /Анна.*anna/ }))
  const name = screen.getByLabelText('Имя сотрудника')
  await user.clear(name)
  await user.type(name, 'Анна Новая')
  await user.click(screen.getByRole('checkbox', { name: 'Заказы: редактирование' }))
  expect(request.mock.calls.some(([path]) => path === '/admin/activity')).toBe(false)
  expect(request.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false)
  await user.click(screen.getByRole('button', { name: 'Сохранить сотрудника и отозвать сессии' }))
  await waitFor(() =>
    expect(
      request.mock.calls.some(
        ([path, init]) => path === `/admin/employees/${employee.id}` && init?.method === 'PATCH',
      ),
    ).toBe(true),
  )
})

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { OrdersEditor, ClientsEditor } from './AdminOperations'

const request = vi.hoisted(() => vi.fn())
vi.mock('../../features/auth/api/authApi', () => ({ apiRequest: request }))

test('история клиента загружается страницами и отбрасывает повторы', async () => {
  const client = { _id: 'paged', name: 'Ирина', phone: '+79991234567' }
  const order = (id: string) => ({
    _id: id,
    accountId: client._id,
    createdAt: '2026-11-15T12:00:00Z',
    fulfillmentStatus: 'completed',
    input: { fulfillment: { mode: 'pickup', label: 'Кафе' } },
    quote: { lines: [], totalKopecks: 10000, deliveryKopecks: 0, discountKopecks: 0 },
  })
  request.mockImplementation(async (path: string) => {
    if (path.includes('?before='))
      return { orders: [order('first-order'), order('next-order')], nextBefore: null }
    if (path === '/admin/clients/paged')
      return { client, addresses: [], orders: [order('first-order')], nextBefore: 'cursor' }
    return { clients: [client], nextBefore: null }
  })
  render(<ClientsEditor />)
  fireEvent.click(await screen.findByRole('button', { name: /Ирина/ }))
  fireEvent.click(await screen.findByRole('button', { name: 'Показать ещё заказы' }))
  expect(await screen.findByText('История заказов · 2')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Показать ещё заказы' })).not.toBeInTheDocument()
})

test('список заказов показывает загрузку до ответа и пустое состояние только после него', async () => {
  let resolveRequest!: (value: { orders: []; nextBefore: null }) => void
  request.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveRequest = resolve
      }),
  )
  render(<OrdersEditor />)

  expect(screen.getByRole('status')).toHaveTextContent('Загружаем заказы…')
  expect(screen.queryByText('Заказов в этом разделе пока нет.')).not.toBeInTheDocument()
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1))
  resolveRequest({ orders: [], nextBefore: null })
  expect(await screen.findByText('Заказов в этом разделе пока нет.')).toBeInTheDocument()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

test('старый ответ опроса не возвращает заказ после смены этапа', async () => {
  const order = {
    _id: 'order-123456',
    accountId: 'user-1',
    createdAt: '2026-11-04T12:00:00.000Z',
    fulfillmentStatus: 'new',
    input: { fulfillment: { mode: 'pickup', label: 'Кафе' } },
    quote: { lines: [], totalKopecks: 32400, discountKopecks: 3600, deliveryKopecks: 0 },
  }
  let resolveOld!: (value: { orders: (typeof order)[]; nextBefore: null }) => void
  let reads = 0
  request.mockImplementation((path: string) => {
    if (path.endsWith('/stage')) return Promise.resolve({ order })
    reads++
    if (reads === 1) return Promise.resolve({ orders: [order], nextBefore: null })
    if (reads === 2)
      return new Promise((resolve) => {
        resolveOld = resolve
      })
    return Promise.resolve({ orders: [], nextBefore: null })
  })
  render(<OrdersEditor />)
  const accept = await screen.findByRole('button', { name: /Принять заказ/ })
  fireEvent.click(screen.getByRole('button', { name: 'Обновить' }))
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
  fireEvent.click(accept)
  await waitFor(() => expect(request).toHaveBeenCalledTimes(4))
  // Второй ответ успел устареть до завершения изменения этапа.
  await act(async () => resolveOld({ orders: [order], nextBefore: null }))
  expect(screen.queryByText('№ORDER-12')).not.toBeInTheDocument()
})

test('история клиента показывает отмену заказа отдельно от фактической оплаты', async () => {
  const client = { _id: 'u1', name: 'Анна', phone: '+79991234567' }
  request.mockImplementation((path: string) =>
    Promise.resolve(
      path === '/admin/clients/u1'
        ? {
            client,
            addresses: [],
            orders: [
              {
                _id: 'expired-order',
                accountId: 'u1',
                createdAt: '2026-11-14T12:00:00Z',
                canceledAt: '2026-11-14T12:15:00Z',
                fulfillmentStatus: 'new',
                payment: { status: 'pending' },
                input: { fulfillment: { mode: 'pickup', label: 'Кафе' } },
                quote: { lines: [], totalKopecks: 32400, discountKopecks: 0, deliveryKopecks: 0 },
              },
            ],
          }
        : { clients: [client], nextBefore: null },
    ),
  )
  render(<ClientsEditor />)
  fireEvent.click(await screen.findByRole('button', { name: /Анна/ }))
  const summary = await screen.findByText('№EXPIRED-')
  await userEvent.click(summary)
  expect(screen.getByText('Отменён')).toBeVisible()
  expect(screen.getByText('Ожидает подтверждения')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Принять заказ/ })).not.toBeInTheDocument()
})

test('смена этапа сохраняет список до ответа и блокирует действия для прежнего этапа', async () => {
  const order = {
    _id: 'stable-order',
    accountId: 'u1',
    createdAt: '2026-11-04T12:00:00Z',
    fulfillmentStatus: 'new',
    input: { fulfillment: { mode: 'pickup', label: 'Кафе' } },
    quote: { lines: [], totalKopecks: 10000, deliveryKopecks: 0, discountKopecks: 0 },
  }
  let finish!: (value: { orders: []; nextBefore: null }) => void
  request.mockImplementation((path: string) =>
    path.includes('stage=preparing')
      ? new Promise((resolve) => {
          finish = resolve
        })
      : Promise.resolve({ orders: [order], nextBefore: null }),
  )
  render(<OrdersEditor />)
  const accept = await screen.findByRole('button', { name: /Принять заказ/ })
  const card = accept.closest('article')!
  fireEvent.click(screen.getByRole('tab', { name: 'В работе' }))
  await waitFor(() => expect(finish).toBeDefined())
  expect(card).toBeInTheDocument()
  expect(accept).toBeDisabled()
  expect(screen.queryByText('Загружаем заказы…')).not.toBeInTheDocument()
  await act(async () => finish({ orders: [], nextBefore: null }))
  expect(card).not.toBeInTheDocument()
  expect(screen.getByText('Заказов в этом разделе пока нет.')).toBeInTheDocument()
})

test('поиск клиентов сохраняет список до нового ответа', async () => {
  const client = { _id: 'stable-client', name: 'Ирина', phone: '+79991234567' }
  let finish!: (value: { clients: []; nextBefore: null }) => void
  request.mockImplementation((path: string) =>
    path.includes('q=') && !path.includes('q=&')
      ? new Promise((resolve) => {
          finish = resolve
        })
      : Promise.resolve({ clients: [client], nextBefore: null }),
  )
  render(<ClientsEditor />)
  const card = await screen.findByRole('button', { name: /Ирина/ })
  fireEvent.change(screen.getByRole('textbox', { name: 'Поиск клиентов' }), {
    target: { value: 'Анна' },
  })
  await waitFor(() => expect(finish).toBeDefined())
  expect(card).toBeInTheDocument()
  expect(card).toBeDisabled()
  expect(screen.queryByText('Загружаем клиентов…')).not.toBeInTheDocument()
  await act(async () => finish({ clients: [], nextBefore: null }))
  expect(card).not.toBeInTheDocument()
  expect(screen.getByText('Клиенты не найдены.')).toBeInTheDocument()
})

function mockMobileLayout() {
  const media = {
    matches: true,
    media: '(max-width: 720px)',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }
  const spy = vi.spyOn(window, 'matchMedia').mockReturnValue(media as unknown as MediaQueryList)
  return { media, spy }
}

test('мобильная карточка раскрывается под клиентом и игнорирует ответ после сворачивания', async () => {
  const { spy } = mockMobileLayout()
  const clients = [
    { _id: 'first', name: 'Анна', phone: '+79991234567' },
    { _id: 'second', name: 'Ирина', phone: '+79991234568' },
  ]
  let finish!: (value: unknown) => void
  request.mockImplementation((path: string) =>
    path === '/admin/clients/first'
      ? new Promise((resolve) => {
          finish = resolve
        })
      : Promise.resolve(
          path === '/admin/clients/second'
            ? { client: clients[1], addresses: [], orders: [] }
            : { clients, nextBefore: null },
        ),
  )
  try {
    render(<ClientsEditor />)
    const first = await screen.findByRole('button', { name: /Анна/ })
    const second = screen.getByRole('button', { name: /Ирина/ })
    fireEvent.click(first)
    expect(first).toHaveAttribute('aria-expanded', 'true')
    expect(within(first.parentElement!).getByRole('status')).toHaveTextContent('Загружаем профиль')
    fireEvent.click(first)
    expect(first).toHaveAttribute('aria-expanded', 'false')
    await act(async () => finish({ client: clients[0], addresses: [], orders: [] }))
    expect(screen.queryByRole('region', { name: 'Профиль клиента' })).not.toBeInTheDocument()
    fireEvent.click(second)
    await within(second.parentElement!).findByText('Заказов пока нет.')
    expect(first.parentElement!.nextElementSibling).toBe(second.parentElement)
    expect(second.nextElementSibling).toBe(screen.getByRole('region', { name: 'Профиль клиента' }))
    fireEvent.click(first)
    expect(second).toHaveAttribute('aria-expanded', 'false')
    expect(within(first.parentElement!).getByRole('status')).toBeInTheDocument()
  } finally {
    spy.mockRestore()
  }
})

test('заказы клиента изначально свернуты, открываются целиком и сохраняются при подгрузке', async () => {
  const user = userEvent.setup()
  const client = { _id: 'history', name: 'Анна', phone: '+79991234567' }
  const order = {
    _id: 'history-order',
    accountId: client._id,
    createdAt: '2026-11-15T12:00:00Z',
    fulfillmentStatus: 'completed',
    payment: { status: 'succeeded' },
    input: { fulfillment: { mode: 'pickup', label: 'Кафе' } },
    quote: {
      lines: [{ name: 'Борщ', quantity: 2, lineTotalKopecks: 40000 }],
      totalKopecks: 40000,
      deliveryKopecks: 0,
      discountKopecks: 0,
    },
  }
  request.mockImplementation(async (path: string) => {
    if (path.includes('?before='))
      return { orders: [{ ...order, _id: 'another-order' }], nextBefore: null }
    if (path === '/admin/clients/history')
      return { client, addresses: [], orders: [order], nextBefore: 'cursor' }
    return { clients: [client], nextBefore: null }
  })
  render(<ClientsEditor />)
  await user.click(await screen.findByRole('button', { name: /Анна/ }))
  const title = await screen.findByText('№HISTORY-')
  const accordion = title.closest('details')!
  expect(accordion).not.toHaveAttribute('open')
  expect(screen.getByText('Борщ × 2')).not.toBeVisible()
  await user.click(title)
  expect(screen.getByText('Борщ × 2')).toBeVisible()
  expect(screen.getByText('Оплачено')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Показать ещё заказы' }))
  await screen.findByText('История заказов · 2')
  expect(accordion).toHaveAttribute('open')
  expect(screen.getByText('№ANOTHER-').closest('details')).not.toHaveAttribute('open')
  await user.click(title)
  expect(within(accordion).getByText('Борщ × 2')).not.toBeVisible()
})

test('выбор фильтра запрашивает нужный список и сбрасывает открытый профиль', async () => {
  const user = userEvent.setup()
  const client = { _id: 'filtered', name: 'Анна', phone: '+79991234567' }
  request.mockImplementation(async (path: string) =>
    path === '/admin/clients/filtered'
      ? { client, addresses: [], orders: [] }
      : { clients: [client], nextBefore: null },
  )
  render(<ClientsEditor />)
  await user.click(await screen.findByRole('button', { name: /Анна/ }))
  await screen.findByText('Заказов пока нет.')
  await user.click(screen.getByRole('combobox', { name: 'Фильтр клиентов' }))
  await user.click(screen.getByRole('option', { name: 'С заказами' }))
  await waitFor(() => expect(request).toHaveBeenCalledWith('/admin/clients?q=&filter=ordered'))
  expect(screen.queryByText('Заказов пока нет.')).not.toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: 'Фильтр клиентов' })).toHaveAttribute(
    'aria-expanded',
    'false',
  )
})

test('ошибка профиля показана под клиентом и повтор загружает его без сворачивания', async () => {
  const { spy } = mockMobileLayout()
  const client = { _id: 'retry', name: 'Анна', phone: '+79991234567' }
  let reads = 0
  request.mockImplementation(async (path: string) => {
    if (path === '/admin/clients/retry') {
      if (++reads === 1) throw new Error('Нет связи')
      return { client, addresses: [], orders: [] }
    }
    return { clients: [client], nextBefore: null }
  })
  try {
    render(<ClientsEditor />)
    const row = await screen.findByRole('button', { name: /Анна/ })
    fireEvent.click(row)
    expect(await within(row.parentElement!).findByRole('alert')).toHaveTextContent('Нет связи')
    fireEvent.click(screen.getByRole('button', { name: 'Повторить загрузку профиля' }))
    await screen.findByText('Заказов пока нет.')
    expect(row).toHaveAttribute('aria-expanded', 'true')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(reads).toBe(2)
  } finally {
    spy.mockRestore()
  }
})

test('поздние ответы профиля и истории не подменяют нового выбранного клиента', async () => {
  const { spy } = mockMobileLayout()
  const first = { _id: 'first', name: 'Анна', phone: '+79991234567' }
  const second = { _id: 'second', name: 'Ирина', phone: '+79991234568' }
  let finishProfile!: (value: unknown) => void
  let finishHistory!: (value: unknown) => void
  let reads = 0
  request.mockImplementation((path: string) => {
    if (path.includes('?before='))
      return new Promise((resolve) => {
        finishHistory = resolve
      })
    if (path === '/admin/clients/first') {
      if (++reads === 1)
        return new Promise((resolve) => {
          finishProfile = resolve
        })
      return Promise.resolve({ client: first, addresses: [], orders: [], nextBefore: 'cursor' })
    }
    if (path === '/admin/clients/second')
      return Promise.resolve({ client: second, addresses: ['Адрес Ирины'], orders: [] })
    return Promise.resolve({ clients: [first, second], nextBefore: null })
  })
  try {
    render(<ClientsEditor />)
    const firstRow = await screen.findByRole('button', { name: /Анна/ })
    const secondRow = screen.getByRole('button', { name: /Ирина/ })
    fireEvent.click(firstRow)
    fireEvent.click(secondRow)
    await screen.findByText('Адрес Ирины')
    await act(async () =>
      finishProfile({ client: first, addresses: ['Старый адрес Анны'], orders: [] }),
    )
    expect(screen.getByRole('region', { name: 'Профиль клиента' })).toHaveTextContent('Адрес Ирины')
    expect(screen.queryByText('Старый адрес Анны')).not.toBeInTheDocument()
    fireEvent.click(firstRow)
    fireEvent.click(await screen.findByRole('button', { name: 'Показать ещё заказы' }))
    fireEvent.click(secondRow)
    await screen.findByText('Адрес Ирины')
    await act(async () => finishHistory({ orders: [], nextBefore: 'stale-cursor' }))
    expect(screen.getByRole('region', { name: 'Профиль клиента' })).toHaveTextContent('Адрес Ирины')
    expect(screen.queryByRole('button', { name: 'Показать ещё заказы' })).not.toBeInTheDocument()
  } finally {
    spy.mockRestore()
  }
})

test('смена мобильной и большой компоновки сохраняет выбранный профиль без повторного запроса', async () => {
  const { media, spy } = mockMobileLayout()
  const client = { _id: 'resize', name: 'Анна', phone: '+79991234567' }
  request.mockImplementation(async (path: string) =>
    path === '/admin/clients/resize'
      ? { client, addresses: ['Адрес Анны'], orders: [] }
      : { clients: [client], nextBefore: null },
  )
  try {
    render(<ClientsEditor />)
    const row = await screen.findByRole('button', { name: /Анна/ })
    fireEvent.click(row)
    await screen.findByText('Адрес Анны')
    expect(row.nextElementSibling).toBe(screen.getByRole('region', { name: 'Профиль клиента' }))
    const change = media.addEventListener.mock.calls[0]![1] as () => void
    act(() => {
      media.matches = false
      change()
    })
    expect(row.nextElementSibling).toBeNull()
    expect(screen.getAllByRole('region', { name: 'Профиль клиента' })).toHaveLength(1)
    expect(screen.getByRole('region', { name: 'Профиль клиента' })).toHaveTextContent('Адрес Анны')
    act(() => {
      media.matches = true
      change()
    })
    expect(row.nextElementSibling).toBe(screen.getByRole('region', { name: 'Профиль клиента' }))
    expect(request.mock.calls.filter(([path]) => path === '/admin/clients/resize')).toHaveLength(1)
  } finally {
    spy.mockRestore()
  }
})

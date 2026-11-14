import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import { OrdersEditor, ClientsEditor } from './AdminOperations'

const request = vi.hoisted(() => vi.fn())
vi.mock('../../features/auth/api/authApi', () => ({ apiRequest: request }))

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
  expect(await screen.findByText('Отменён')).toBeInTheDocument()
  expect(screen.getByText('Ожидает подтверждения')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Принять заказ/ })).not.toBeInTheDocument()
})

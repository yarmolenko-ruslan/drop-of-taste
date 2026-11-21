import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ActivityPage, AdminActivity } from '../../../shared/admin-activity'
import { ActivityLog } from './ActivityLog'
const request = vi.hoisted(() => vi.fn())
vi.mock('../../features/auth/api/authApi', () => ({ apiRequest: request }))
const owner: AdminActivity = {
  _id: 'owner-event',
  at: '2026-11-17T00:00:00Z',
  actor: { id: 'owner', name: 'Владелец', role: 'owner' },
  action: 'employee.create',
  kind: 'change',
  outcome: 'success',
  method: 'POST',
  route: '/api/admin/employees',
  statusCode: 201,
}
const employee: AdminActivity = {
  ...owner,
  _id: 'employee-event',
  actor: { id: 'employee', name: 'Анна', role: 'employee' },
  action: 'order.accept',
  kind: 'change',
  outcome: 'denied',
  statusCode: 403,
  errorCode: 'ADMIN_FORBIDDEN',
}
beforeEach(() => {
  request.mockReset()
})

test('the activity journal shows authors and results, loads older entries and filters employee actions', async () => {
  request.mockImplementation(async (path: string) => {
    if (path.includes('role=employee')) return { activities: [employee], nextBefore: null }
    if (path.includes('before=next-cursor')) return { activities: [employee], nextBefore: null }
    return { activities: [owner], nextBefore: 'next-cursor' }
  })
  const user = userEvent.setup()
  render(<ActivityLog />)
  expect(await screen.findByText('Создание сотрудника')).toBeInTheDocument()
  expect(screen.getByText(/Владелец \(владелец\)/)).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Показать ещё действия' }))
  expect(await screen.findByText('Заказ принят в работу')).toBeInTheDocument()
  expect(screen.getByText('Отказано в доступе', { selector: 'span' })).toBeInTheDocument()
  expect(screen.getByText(/Анна \(сотрудник\)/)).toBeInTheDocument()
  await user.click(screen.getByLabelText('Кто совершил действие'))
  await user.click(screen.getByRole('option', { name: 'Сотрудники' }))
  await waitFor(() => expect(screen.queryByText('Создание сотрудника')).not.toBeInTheDocument())
  expect(await screen.findByText(/Анна \(сотрудник\)/)).toBeInTheDocument()
  expect(
    request.mock.calls.some(
      ([path]) => path.includes('role=employee') && !path.includes('before='),
    ),
  ).toBe(true)
})

test('a stale journal response cannot replace a newly selected filter', async () => {
  let finish!: (page: ActivityPage) => void
  request.mockImplementation(async (path: string) => {
    if (path.includes('role=owner')) return { activities: [owner], nextBefore: null }
    return new Promise((resolve) => {
      finish = resolve
    })
  })
  const user = userEvent.setup()
  render(<ActivityLog />)
  await waitFor(() => expect(request).toHaveBeenCalled())
  await user.click(screen.getByLabelText('Кто совершил действие'))
  await user.click(screen.getByRole('option', { name: 'Владелец' }))
  await screen.findByText('Создание сотрудника')
  await act(async () => finish({ activities: [employee], nextBefore: null }))
  expect(screen.queryByText(/Анна \(сотрудник\)/)).not.toBeInTheDocument()
  expect(screen.getByText('Создание сотрудника')).toBeInTheDocument()
})

test('journal errors can be retried and a name search is explicitly submitted', async () => {
  request
    .mockRejectedValueOnce(new Error('Нет связи'))
    .mockResolvedValue({ activities: [], nextBefore: null })
  const user = userEvent.setup()
  render(<ActivityLog />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Нет связи')
  await user.click(screen.getByRole('button', { name: 'Обновить действия' }))
  expect(await screen.findByText('Действий по выбранным фильтрам пока нет.')).toBeInTheDocument()
  await user.type(screen.getByLabelText('Имя автора действия'), 'Анна')
  await user.click(screen.getByRole('button', { name: 'Найти автора' }))
  await waitFor(() =>
    expect(
      request.mock.calls.some(
        ([path]) => new URLSearchParams(path.split('?')[1]).get('q') === 'Анна',
      ),
    ).toBe(true),
  )
})

test('submitting the same author search twice refetches rather than leaving the journal loading', async () => {
  request.mockResolvedValue({ activities: [owner], nextBefore: null })
  const user = userEvent.setup()
  render(<ActivityLog />)
  await screen.findByText('Создание сотрудника')
  await user.type(screen.getByLabelText('Имя автора действия'), 'Владелец')
  await user.click(screen.getByRole('button', { name: 'Найти автора' }))
  await screen.findByText('Создание сотрудника')
  const previous = request.mock.calls.length
  await user.click(screen.getByRole('button', { name: 'Найти автора' }))
  await waitFor(() => expect(request.mock.calls.length).toBe(previous + 1))
  expect(await screen.findByText('Создание сотрудника')).toBeInTheDocument()
  expect(screen.queryByText('Загружаем действия…')).not.toBeInTheDocument()
})

test('retrying the same next-page cursor after a network error actually sends the request again', async () => {
  let pageAttempts = 0
  request.mockImplementation(async (path: string) => {
    if (!path.includes('before=next-cursor'))
      return { activities: [owner], nextBefore: 'next-cursor' }
    pageAttempts++
    if (pageAttempts === 1) throw new Error('Connection lost on the next page')
    return { activities: [employee], nextBefore: null }
  })
  const user = userEvent.setup()
  render(<ActivityLog />)
  await screen.findByText('Создание сотрудника')
  await user.click(screen.getByRole('button', { name: 'Показать ещё действия' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Connection lost')
  await user.click(screen.getByRole('button', { name: 'Показать ещё действия' }))
  expect(await screen.findByText('Заказ принят в работу')).toBeInTheDocument()
  expect(pageAttempts).toBe(2)
  expect(screen.getAllByText('Создание сотрудника')).toHaveLength(1)
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

test('filtering retains the current entries until the new page is ready', async () => {
  let finish!: (page: ActivityPage) => void
  request.mockImplementation((path: string) =>
    path.includes('role=employee')
      ? new Promise((resolve) => {
          finish = resolve
        })
      : Promise.resolve({ activities: [owner], nextBefore: null }),
  )
  const user = userEvent.setup()
  render(<ActivityLog />)
  const entry = await screen.findByText('Создание сотрудника')
  await user.click(screen.getByLabelText('Кто совершил действие'))
  await user.click(screen.getByRole('option', { name: 'Сотрудники' }))
  await waitFor(() => expect(finish).toBeDefined())
  expect(screen.getByText('Создание сотрудника')).toBe(entry)
  await act(async () => finish({ activities: [employee], nextBefore: null }))
  expect(entry).not.toBeInTheDocument()
  expect(screen.getByText('Заказ принят в работу')).toBeInTheDocument()
})

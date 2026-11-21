import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { defaultSiteContent } from '../../../shared/site-content'
import { SiteContentProvider } from '../../features/site-content/SiteContentProvider'
import { publishSiteUpdate } from '../../shared/lib/siteUpdates'
import { AccountScreen } from './AccountScreen'

const request = vi.hoisted(() => vi.fn())
vi.mock('../../features/auth/api/authApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../features/auth/api/authApi')>()),
  apiRequest: request,
}))

beforeEach(() => {
  request.mockReset()
})

afterEach(() => vi.useRealTimers())

test('окончание акции скрывает плашку даже при потере связи с сервером', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-21T10:00:00Z'))
  let requests = 0
  request.mockImplementation(async (path: string) => {
    if (path === '/site-content') {
      if (++requests > 1) throw new Error('offline')
      return {
        ...defaultSiteContent,
        nextPromotionChangeInMs: 1000,
        promotions: defaultSiteContent.promotions.map((item) =>
          item.id === 'birthday' ? { ...item, endsAt: '2026-11-21T10:00:01Z' } : item,
        ),
      }
    }
    if (path === '/profile')
      return {
        profile: {
          name: 'Тест',
          email: '',
          birthday: '1990-01-01',
          notifications: { push: false, email: false, sms: false },
          selectedAddressId: null,
        },
      }
    if (path === '/orders') return { orders: [], nextCursor: null }
    if (path === '/addresses') return { addresses: [] }
    if (path === '/checkout/config') return { testPaymentEnabled: false }
    throw new Error(`Unexpected request: ${path}`)
  })
  await act(async () => {
    render(
      <MemoryRouter initialEntries={['/account/profile']}>
        <SiteContentProvider>
          <Routes>
            <Route
              path="/account/:section"
              element={
                <AccountScreen
                  user={{ id: 'test-user', name: 'Тест', phone: '+79991234567' }}
                  onLogout={vi.fn()}
                  onUpdateUser={vi.fn()}
                />
              }
            />
          </Routes>
        </SiteContentProvider>
      </MemoryRouter>,
    )
  })
  expect(screen.getByText('Скидка ко дню рождения')).toBeInTheDocument()
  await act(async () => vi.advanceTimersByTimeAsync(1100))
  expect(requests).toBe(2)
  expect(screen.queryByText('Скидка ко дню рождения')).not.toBeInTheDocument()
})

test.each(['disabled', 'active', 'error'])(
  'профиль не обещает скидку до ответа сервера и получает обновления акции: %s',
  async (initial) => {
    let finish!: (value: typeof defaultSiteContent) => void
    let reject!: (error: Error) => void
    let content = defaultSiteContent
    const pending = new Promise<typeof defaultSiteContent>((resolve, rejectRequest) => {
      finish = resolve
      reject = rejectRequest
    })
    let contentRequests = 0
    request.mockImplementation(async (path: string) => {
      if (path === '/site-content') return ++contentRequests === 1 ? pending : content
      if (path === '/checkout/config') return { testPaymentEnabled: false }
      if (path === '/orders') return { orders: [], nextCursor: null }
      if (path === '/addresses') return { addresses: [] }
      if (path === '/profile')
        return {
          profile: {
            name: 'Тест',
            email: '',
            birthday: '1990-01-01',
            notifications: { push: false, email: false, sms: false },
            selectedAddressId: null,
          },
        }
      throw new Error(`Unexpected request: ${path}`)
    })
    render(
      <MemoryRouter initialEntries={['/account/profile']}>
        <SiteContentProvider>
          <Routes>
            <Route
              path="/account/:section"
              element={
                <AccountScreen
                  user={{ id: 'test-user', name: 'Тест', phone: '+79991234567' }}
                  onLogout={vi.fn()}
                  onUpdateUser={vi.fn()}
                />
              }
            />
          </Routes>
        </SiteContentProvider>
      </MemoryRouter>,
    )
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'День' })).toHaveTextContent('1'),
    )
    expect(screen.queryByText('Скидка ко дню рождения')).not.toBeInTheDocument()
    content = {
      ...defaultSiteContent,
      promotions: initial === 'active' ? defaultSiteContent.promotions : [],
    }
    await act(async () => (initial === 'error' ? reject(new Error('offline')) : finish(content)))
    expect(Boolean(screen.queryByText('Скидка ко дню рождения'))).toBe(initial === 'active')
    // Включение и выключение в открытом профиле без перезагрузки и потери даты.
    content = defaultSiteContent
    act(() => publishSiteUpdate('content'))
    expect(await screen.findByText('Скидка ко дню рождения')).toBeInTheDocument()
    content = { ...defaultSiteContent, promotions: [] }
    act(() => publishSiteUpdate('content'))
    await waitFor(() =>
      expect(screen.queryByText('Скидка ко дню рождения')).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('combobox', { name: 'День' })).toBeDisabled()
  },
)

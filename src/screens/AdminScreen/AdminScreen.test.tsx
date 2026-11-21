import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLayoutEffect } from 'react'
import { MemoryRouter } from 'react-router'
import { beforeEach, expect, test, vi } from 'vitest'
import { defaultSiteContent, type SiteContent } from '../../../shared/site-content'
import {
  SiteContentProvider,
  useSiteContent,
} from '../../features/site-content/SiteContentProvider'
import { AdminScreen } from './AdminScreen'
import { permissions } from '../../../shared/admin-access'
import { ApiError } from '../../features/auth/api/authApi'

const request = vi.hoisted(() => vi.fn())
vi.mock('../../features/auth/api/authApi', async (original) => ({
  ...(await original<typeof import('../../features/auth/api/authApi')>()),
  apiRequest: request,
}))

function SiteName() {
  return <output aria-label="Название на сайте">{useSiteContent().brandName}</output>
}

beforeEach(() => {
  request.mockReset()
  localStorage.clear()
})

test('an already expired session does not leave logout pending forever', async () => {
  localStorage.setItem('drop-of-taste:admin-logout-pending', '1')
  request.mockRejectedValue(new ApiError('ADMIN_UNAUTHORIZED', 'Session expired', 0, 401))
  render(
    <MemoryRouter>
      <AdminScreen />
    </MemoryRouter>,
  )
  await waitFor(() => expect(screen.getByRole('button', { name: 'Войти' })).toBeEnabled())
  expect(localStorage.getItem('drop-of-taste:admin-logout-pending')).toBeNull()
})

test('failed logout hides administrative data and retries revocation before restoring a session', async () => {
  let online = false
  request.mockImplementation(async (path: string) => {
    if (path === '/admin/activity') return undefined
    if (path === '/admin/session')
      return {
        authenticated: true,
        principal: {
          id: 'owner',
          name: 'Владелец',
          role: 'owner',
          permissions,
          mustChangePassword: false,
        },
      }
    if (path === '/admin/dashboard')
      return { content: defaultSiteContent, categories: [], products: [], iikoConfigured: false }
    if (path.startsWith('/admin/orders?')) return { orders: [], nextBefore: null }
    if (path === '/admin/logout') {
      if (!online) throw new Error('offline')
      return { authenticated: false }
    }
    throw new Error(`Unexpected ${path}`)
  })
  const user = userEvent.setup()
  const view = render(
    <MemoryRouter>
      <AdminScreen />
    </MemoryRouter>,
  )
  await user.click(await screen.findByRole('button', { name: 'Выйти' }))
  expect(screen.queryByRole('navigation', { name: 'Разделы панели' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Войти' })).toBeDisabled()
  view.unmount()
  request.mockClear()
  render(
    <MemoryRouter>
      <AdminScreen />
    </MemoryRouter>,
  )
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith('/admin/logout', {
      method: 'POST',
      headers: { 'X-Admin-Account-Id': 'owner' },
    }),
  )
  expect(request.mock.calls.some(([path]) => path === '/admin/session')).toBe(false)
  expect(screen.queryByRole('navigation', { name: 'Разделы панели' })).not.toBeInTheDocument()
  online = true
  act(() => window.dispatchEvent(new Event('online')))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Войти' })).toBeEnabled())
})

test('a logout in another tab prevents a late initial dashboard from restoring access', async () => {
  let resolveDashboard!: (data: unknown) => void
  request.mockImplementation(async (path: string) => {
    if (path === '/admin/activity') return undefined
    if (path === '/admin/session')
      return {
        authenticated: true,
        principal: {
          id: 'owner',
          name: 'Владелец',
          role: 'owner',
          permissions,
          mustChangePassword: false,
        },
      }
    if (path === '/admin/dashboard')
      return new Promise((resolve) => {
        resolveDashboard = resolve
      })
    if (path === '/admin/logout') return { authenticated: false }
    throw new Error(`Unexpected ${path}`)
  })
  render(
    <MemoryRouter>
      <AdminScreen />
    </MemoryRouter>,
  )
  await waitFor(() => expect(request).toHaveBeenCalledWith('/admin/dashboard'))
  act(() => {
    localStorage.setItem('drop-of-taste:admin-logout-pending', '1')
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'drop-of-taste:admin-logout-pending', newValue: '1' }),
    )
  })
  await act(async () =>
    resolveDashboard({
      content: defaultSiteContent,
      categories: [],
      products: [],
      iikoConfigured: false,
    }),
  )
  expect(screen.queryByRole('navigation', { name: 'Разделы панели' })).not.toBeInTheDocument()
})

test('сохранение в админке сразу обновляет сайт и повторное сохранение отправляет только новую правку', async () => {
  let content: SiteContent = { ...defaultSiteContent, brandName: 'Первое имя' }
  const patches: Partial<SiteContent>[] = []
  request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/admin/activity') return undefined
    if (path === '/admin/session')
      return {
        authenticated: true,
        principal: {
          id: 'owner',
          name: 'Владелец',
          role: 'owner',
          permissions,
          mustChangePassword: false,
        },
      }
    if (path === '/admin/dashboard')
      return { content, categories: [], products: [], iikoConfigured: false }
    if (path === '/admin/orders?stage=new&limit=50') return { orders: [], nextBefore: null }
    if (path === '/site-content') return content
    if (path === '/admin/content' && init?.method === 'PATCH') {
      const patch = JSON.parse(String(init.body)) as Partial<SiteContent>
      patches.push(patch)
      content = { ...content, ...patch }
      return { content }
    }
    throw new Error(`Неожиданный запрос: ${path}`)
  })
  const user = userEvent.setup()
  render(
    <SiteContentProvider>
      <MemoryRouter>
        <AdminScreen />
        <SiteName />
      </MemoryRouter>
    </SiteContentProvider>,
  )
  expect(await screen.findByText('Первое имя')).toBeInTheDocument()
  await user.click(await screen.findByRole('button', { name: 'Сайт и баннеры' }))
  await user.clear(screen.getByRole('textbox', { name: 'Название кафе' }))
  await user.type(screen.getByRole('textbox', { name: 'Название кафе' }), 'Новое имя')
  await user.click(screen.getAllByRole('button', { name: 'Сохранить сайт' })[0]!)
  await waitFor(() =>
    expect(screen.getByRole('status', { name: 'Название на сайте' })).toHaveTextContent(
      'Новое имя',
    ),
  )
  await user.clear(screen.getByRole('textbox', { name: 'Название кафе' }))
  await user.type(screen.getByRole('textbox', { name: 'Название кафе' }), 'Третье имя')
  await user.click(screen.getAllByRole('button', { name: 'Сохранить сайт' })[0]!)
  await waitFor(() => expect(patches).toHaveLength(2))
  expect(patches[1]).toEqual({ brandName: 'Третье имя' })
})

test('меню разделов сворачивается при нехватке места и раскрывается после расширения окна', async () => {
  request.mockImplementation(async (path: string) => {
    if (path === '/admin/activity') return undefined
    if (path === '/admin/session')
      return {
        authenticated: true,
        principal: {
          id: 'owner',
          name: 'Владелец',
          role: 'owner',
          permissions,
          mustChangePassword: false,
        },
      }
    if (path === '/admin/dashboard')
      return { content: defaultSiteContent, categories: [], products: [], iikoConfigured: false }
    if (path === '/admin/orders?stage=new&limit=50') return { orders: [], nextBefore: null }
    throw new Error(`Неожиданный запрос: ${path}`)
  })
  const user = userEvent.setup()
  render(
    <SiteContentProvider>
      <MemoryRouter>
        <AdminScreen />
      </MemoryRouter>
    </SiteContentProvider>,
  )
  const nav = await screen.findByRole('navigation', { name: 'Разделы панели' })
  const list = nav.querySelector('[id="admin-section-list"]') as HTMLDivElement
  Object.defineProperty(nav, 'clientWidth', { configurable: true, writable: true, value: 500 })
  Object.defineProperty(list, 'scrollWidth', { configurable: true, value: 1200 })
  fireEvent.resize(window)

  const toggle = await within(nav).findByRole('button', { name: 'Разделы' })
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await user.click(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await user.click(within(nav).getByRole('button', { name: 'Сайт и баннеры' }))
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(await screen.findByRole('textbox', { name: 'Название кафе' })).toBeInTheDocument()

  expect(request.mock.calls.some(([path]) => path === '/admin/activity')).toBe(false)

  Object.defineProperty(nav, 'clientWidth', { configurable: true, writable: true, value: 1400 })
  fireEvent.resize(window)
  await waitFor(() => expect(within(nav).queryByRole('button', { name: 'Разделы' })).toBeNull())
  expect(within(nav).getByRole('button', { name: 'Сайт и баннеры' })).toHaveAttribute(
    'aria-current',
    'page',
  )
})

test('a delayed logout remains bound to the old session across reload and a new login notification', async () => {
  let online = false
  request.mockImplementation(async (path: string) => {
    if (path === '/admin/session')
      return {
        authenticated: true,
        sessionId: 'old-session',
        principal: {
          id: 'owner',
          name: 'Владелец',
          role: 'owner',
          permissions,
          mustChangePassword: false,
        },
      }
    if (path === '/admin/dashboard')
      return { content: defaultSiteContent, categories: [], products: [], iikoConfigured: false }
    if (path.startsWith('/admin/orders?')) return { orders: [], nextBefore: null }
    if (path === '/admin/logout') {
      if (!online) throw new Error('offline')
      throw new ApiError('ADMIN_SESSION_CHANGED', 'Another session is active', 0, 409)
    }
    throw new Error(path)
  })
  const user = userEvent.setup()
  const view = render(
    <MemoryRouter>
      <AdminScreen />
    </MemoryRouter>,
  )
  await user.click(await screen.findByRole('button', { name: 'Выйти' }))
  const stored = JSON.parse(localStorage.getItem('drop-of-taste:admin-logout-pending')!)
  expect(stored).toMatchObject({ accountId: 'owner', sessionId: 'old-session' })
  view.unmount()
  render(
    <MemoryRouter>
      <AdminScreen />
    </MemoryRouter>,
  )
  await act(async () =>
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'drop-of-taste:admin-session-changed',
        newValue: 'new-login',
      }),
    ),
  )
  online = true
  act(() => window.dispatchEvent(new Event('online')))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Войти' })).toBeEnabled())
  const calls = request.mock.calls.filter(([path]) => path === '/admin/logout')
  expect(calls.length).toBeGreaterThanOrEqual(2)
  expect(calls.every(([, init]) => init.headers['X-Admin-Session-Id'] === 'old-session')).toBe(true)
  expect(localStorage.getItem('drop-of-taste:admin-logout-pending')).toBeNull()
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
})

test('checking the session on focus detects a different login of the same account', async () => {
  let currentSession = 'first-session'
  request.mockImplementation(async (path: string) => {
    if (path === '/admin/session')
      return {
        authenticated: true,
        sessionId: currentSession,
        principal: {
          id: 'owner',
          name: 'Владелец',
          role: 'owner',
          permissions,
          mustChangePassword: false,
        },
      }
    if (path === '/admin/dashboard')
      return { content: defaultSiteContent, categories: [], products: [], iikoConfigured: false }
    if (path.startsWith('/admin/orders?')) return { orders: [], nextBefore: null }
    throw new Error(path)
  })
  render(
    <MemoryRouter>
      <AdminScreen />
    </MemoryRouter>,
  )
  await screen.findByRole('button', { name: 'Выйти' })
  currentSession = 'second-session'
  act(() => window.dispatchEvent(new Event('focus')))
  expect(await screen.findByRole('button', { name: 'Войти' })).toBeInTheDocument()
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
})

test('finishing another tab’s logout between render and effects does not restore a different session automatically', async () => {
  const key = 'drop-of-taste:admin-logout-pending'
  localStorage.setItem(
    key,
    JSON.stringify({ id: 'old-intent', accountId: 'owner', sessionId: 'old-session' }),
  )
  function OtherTabFinishes() {
    useLayoutEffect(() => {
      localStorage.removeItem(key)
    }, [])
    return null
  }
  request.mockImplementation(async (path: string) => {
    if (path === '/admin/logout')
      throw new ApiError('ADMIN_SESSION_CHANGED', 'New session already exists', 0, 409)
    if (path === '/admin/session')
      return {
        authenticated: true,
        sessionId: 'new-session',
        principal: {
          id: 'owner',
          name: 'Владелец',
          role: 'owner',
          permissions,
          mustChangePassword: false,
        },
      }
    if (path === '/admin/dashboard')
      return { content: defaultSiteContent, categories: [], products: [], iikoConfigured: false }
    throw new Error(path)
  })
  render(
    <MemoryRouter>
      <AdminScreen />
      <OtherTabFinishes />
    </MemoryRouter>,
  )
  await waitFor(() => expect(screen.getByRole('button', { name: 'Войти' })).toBeEnabled())
  expect(request.mock.calls.some(([path]) => path === '/admin/session')).toBe(false)
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
})

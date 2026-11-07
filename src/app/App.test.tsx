import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useCartStore } from '../features/cart'
import { App } from './App'

const { me, logout } = vi.hoisted(() => ({ me: vi.fn(), logout: vi.fn() }))

vi.mock('../features/auth/api/authApi', () => ({
  authApi: { me, logout },
  apiRequest: vi.fn(),
  ApiError: class extends Error {
    code = 'UNAUTHENTICATED'
  },
}))
vi.mock('../features/catalog/api/CatalogProvider', () => ({
  CatalogProvider: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock('../screens/HomeScreen/HomeScreen', () => ({
  HomeScreen: ({ onLogin }: { onLogin: () => void }) => <button onClick={onLogin}>Вход</button>,
}))
vi.mock('../screens/AccountScreen/AccountScreen', async () => {
  const { useState } = await import('react')
  return {
    AccountScreen: ({ user, onLogout }: { user: { name: string }; onLogout: () => void }) => {
      const [loadedName] = useState(user.name)
      return (
        <div>
          <span data-testid="loaded-account">{loadedName}</span>
          <button onClick={onLogout}>Выйти</button>
        </div>
      )
    },
  }
})
vi.mock('../features/site-header/ui/SiteHeader', () => ({
  SiteHeader: ({ accountLabel }: { accountLabel?: string }) => (
    <div data-testid="account-label">{accountLabel}</div>
  ),
}))
vi.mock('../features/site-footer/ui/SiteFooter', () => ({ SiteFooter: () => null }))
vi.mock('../shared/ui/ScrollTopButton/ScrollTopButton', () => ({ ScrollTopButton: () => null }))
vi.mock('../features/auth/ui/AuthDialog/AuthDialog', () => ({
  AuthDialog: ({ onAuthenticate }: { onAuthenticate: (user: unknown) => void }) => (
    <button onClick={() => onAuthenticate({ id: 'b', phone: '+79991234568', name: 'Борис' })}>
      Подтвердить Б
    </button>
  ),
}))
vi.mock('../features/cart/ui/CartDrawer/CartDrawer', () => ({
  CartDrawer: ({ onRequireAuth }: { onRequireAuth: () => void }) => (
    <button onClick={onRequireAuth}>Повторный вход</button>
  ),
}))

const accountA = { id: 'a', phone: '+79991234567', name: 'Анна' }

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn())
  localStorage.clear()
  window.history.replaceState({}, '', '/')
  useCartStore.setState({ lines: [], isOpen: false })
  me.mockReset()
  logout.mockReset()
})

test('late /auth/me response cannot replace a newer sign-in', async () => {
  let finishMe!: (value: { user: typeof accountA }) => void
  me.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishMe = resolve
      }),
  )
  render(<App />)
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Вход' }))
  await user.click(screen.getByRole('button', { name: 'Подтвердить Б' }))
  expect(screen.getByTestId('account-label')).toHaveTextContent('Борис')
  await act(async () => finishMe({ user: accountA }))
  await waitFor(() => expect(screen.getByTestId('account-label')).toHaveTextContent('Борис'))
})

test('changing account remounts private screen state', async () => {
  me.mockResolvedValue({ user: accountA })
  render(<App />)
  await screen.findByTestId('account-label')
  act(() => {
    window.history.pushState({}, '', '/account/orders')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  expect(await screen.findByTestId('loaded-account')).toHaveTextContent('Анна')
  act(() => useCartStore.setState({ isOpen: true }))
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Повторный вход' }))
  await user.click(screen.getByRole('button', { name: 'Подтвердить Б' }))
  expect(await screen.findByTestId('loaded-account')).toHaveTextContent('Борис')
})

test('account change response clears old private state and loads the current account', async () => {
  const accountB = { id: 'b', phone: '+79991234568', name: 'Борис' }
  me.mockResolvedValueOnce({ user: accountA }).mockResolvedValueOnce({ user: accountB })
  render(<App />)
  await waitFor(() => expect(screen.getByTestId('account-label')).toHaveTextContent('Анна'))
  useCartStore
    .getState()
    .add(
      { id: 'item', name: 'Блюдо', priceRub: 100 },
      { variant: '', removedIngredients: [], extras: {}, quantity: 1 },
    )
  act(() => window.dispatchEvent(new Event('drop-of-taste:account-changed')))
  await waitFor(() => expect(screen.getByTestId('account-label')).toHaveTextContent('Борис'))
  expect(useCartStore.getState().lines).toHaveLength(0)
})

test('failed logout hides data and finishes after connection returns', async () => {
  me.mockResolvedValue({ user: accountA })
  logout.mockRejectedValue(new Error('offline'))
  const view = render(<App />)
  await screen.findByTestId('account-label')
  act(() => {
    window.history.pushState({}, '', '/account/orders')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  expect(await screen.findByTestId('loaded-account')).toHaveTextContent('Анна')
  await userEvent.setup().click(screen.getByRole('button', { name: 'Выйти' }))
  expect(screen.queryByTestId('loaded-account')).not.toBeInTheDocument()
  await waitFor(() => expect(localStorage.getItem('drop-of-taste:pending-logout')).toBe('1'))
  view.unmount()
  render(<App />)
  expect(screen.queryByTestId('loaded-account')).not.toBeInTheDocument()
  logout.mockResolvedValue(undefined)
  act(() => window.dispatchEvent(new Event('online')))
  await waitFor(() => expect(localStorage.getItem('drop-of-taste:pending-logout')).toBeNull())
})

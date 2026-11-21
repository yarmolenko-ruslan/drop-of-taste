import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useCartStore } from '../features/cart'
import { App } from './App'
import type { FulfillmentSelection } from '../features/fulfillment/ui/FulfillmentDialog/FulfillmentDialog'

const { me, logout, cartMounted } = vi.hoisted(() => ({
  me: vi.fn(),
  logout: vi.fn(),
  cartMounted: vi.fn(),
}))

vi.mock('../features/auth/api/authApi', () => ({
  authApi: { me, logout },
  apiRequest: vi.fn(),
  ApiError: class extends Error {
    code = 'UNAUTHENTICATED'
  },
}))
vi.mock('../features/catalog/api/CatalogProvider', () => ({
  CatalogProvider: ({ children }: { children: React.ReactNode }) => children,
  useCatalog: () => null,
}))
vi.mock('../screens/HomeScreen/HomeScreen', () => ({
  HomeScreen: ({ onLogin }: { onLogin: () => void }) => <button onClick={onLogin}>Вход</button>,
}))
vi.mock('../screens/AccountScreen/AccountScreen', async () => {
  const { useState } = await import('react')
  return {
    AccountScreen: ({
      user,
      onLogout,
      onAddressPicked,
    }: {
      user: { name: string }
      onLogout: () => void
      onAddressPicked?: (selection: FulfillmentSelection) => void
    }) => {
      const [loadedName] = useState(user.name)
      return (
        <div>
          <span data-testid="loaded-account">{loadedName}</span>
          <button onClick={onLogout}>Выйти</button>
          {onAddressPicked && (
            <button
              onClick={() =>
                onAddressPicked({
                  mode: 'delivery',
                  label: 'Тестовая улица, 10',
                  details: {
                    street: 'Тестовая улица, 10',
                    entrance: '1',
                    floor: '2',
                    flat: '3',
                    comment: '',
                    isHouse: false,
                  },
                })
              }
            >
              Выбрать адрес для корзины
            </button>
          )}
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
vi.mock('../features/cart/ui/CartDrawer/CartDrawer', async () => {
  const { useEffect } = await import('react')
  return {
    CartDrawer: ({
      onRequireAuth,
      isOpen,
      fulfillment,
      onGoToAddresses,
    }: {
      onRequireAuth: () => void
      isOpen: boolean
      fulfillment: FulfillmentSelection
      onGoToAddresses: () => void
    }) => {
      useEffect(() => {
        cartMounted()
      }, [])
      return isOpen ? (
        <>
          <button onClick={onRequireAuth}>Повторный вход</button>
          <button onClick={onGoToAddresses}>Выбрать доставку</button>
          <span data-testid="cart-fulfillment">
            {fulfillment.mode}: {fulfillment.label}
          </span>
        </>
      ) : null
    },
  }
})

const accountA = { id: 'a', phone: '+79991234567', name: 'Анна' }

test.each(['guest', 'same-account'])(
  'вход в другой вкладке сохраняет общую корзину: %s',
  async (mode) => {
    if (mode === 'guest') me.mockRejectedValueOnce(new Error('guest'))
    else me.mockResolvedValueOnce({ user: accountA })
    render(<App />)
    await waitFor(() => expect(me).toHaveBeenCalledTimes(1))
    await act(async () => {})
    act(() =>
      useCartStore
        .getState()
        .add(
          { id: 'borscht', name: 'Борщ', priceRub: 360 },
          { variant: '', removedIngredients: [], extras: {}, quantity: 1 },
        ),
    )
    me.mockResolvedValueOnce({ user: accountA })
    act(() =>
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'drop-of-taste:session-change',
          newValue: crypto.randomUUID(),
          storageArea: localStorage,
        }),
      ),
    )
    await waitFor(() => expect(screen.getByTestId('account-label')).toHaveTextContent('Анна'))
    expect(useCartStore.getState().lines).toHaveLength(1)
    expect(JSON.parse(localStorage.getItem('drop-of-taste:cart')!).state.lines).toHaveLength(1)
  },
)

test('смена аккаунта в другой вкладке очищает корзину предыдущего пользователя', async () => {
  me.mockResolvedValueOnce({ user: accountA })
  render(<App />)
  await waitFor(() => expect(screen.getByTestId('account-label')).toHaveTextContent('Анна'))
  act(() =>
    useCartStore
      .getState()
      .add(
        { id: 'borscht', name: 'Борщ', priceRub: 360 },
        { variant: '', removedIngredients: [], extras: {}, quantity: 1 },
      ),
  )
  me.mockResolvedValueOnce({ user: { ...accountA, id: 'b', name: 'Борис' } })
  act(() =>
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'drop-of-taste:session-change',
        newValue: crypto.randomUUID(),
        storageArea: localStorage,
      }),
    ),
  )
  await waitFor(() => expect(screen.getByTestId('account-label')).toHaveTextContent('Борис'))
  expect(useCartStore.getState().lines).toHaveLength(0)
})

test('сообщение после смены аккаунта не очищает повторно новую общую корзину', async () => {
  me.mockResolvedValueOnce({ user: accountA })
  render(<App />)
  await waitFor(() => expect(screen.getByTestId('account-label')).toHaveTextContent('Анна'))
  // Другая вкладка уже очистила старую корзину и начала новую от нового аккаунта.
  act(() => {
    useCartStore.getState().clear()
    useCartStore
      .getState()
      .add(
        { id: 'borscht', name: 'Борщ', priceRub: 360 },
        { variant: '', removedIngredients: [], extras: {}, quantity: 1 },
      )
  })
  me.mockResolvedValueOnce({ user: { ...accountA, id: 'b', name: 'Борис' } })
  act(() =>
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'drop-of-taste:session-change',
        newValue: JSON.stringify({ accountId: 'b', cartCleared: true }),
        storageArea: localStorage,
      }),
    ),
  )
  await waitFor(() => expect(screen.getByTestId('account-label')).toHaveTextContent('Борис'))
  expect(useCartStore.getState().lines).toHaveLength(1)
})

test('выбор адреса из корзины возвращает её в режим доставки с выбранным адресом', async () => {
  me.mockResolvedValue({ user: accountA })
  render(<App />)
  await waitFor(() => expect(screen.getByTestId('account-label')).toHaveTextContent('Анна'))
  act(() => useCartStore.getState().open())
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Выбрать доставку' }))
  await user.click(await screen.findByRole('button', { name: 'Выбрать адрес для корзины' }))
  expect(await screen.findByTestId('cart-fulfillment')).toHaveTextContent(
    'delivery: Тестовая улица, 10',
  )
})

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn())
  localStorage.clear()
  window.history.replaceState({}, '', '/')
  useCartStore.setState({ lines: [], isOpen: false })
  me.mockReset()
  logout.mockReset()
  cartMounted.mockClear()
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
  await user.click(await screen.findByRole('button', { name: 'Подтвердить Б' }))
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
  await user.click(await screen.findByRole('button', { name: 'Повторный вход' }))
  await user.click(await screen.findByRole('button', { name: 'Подтвердить Б' }))
  expect(await screen.findByTestId('loaded-account')).toHaveTextContent('Борис')
})

test('корзина загружается по первому открытию и сохраняет экземпляр после закрытия', async () => {
  me.mockResolvedValue({ user: accountA })
  render(<App />)
  await waitFor(() => expect(screen.getByTestId('account-label')).toHaveTextContent('Анна'))
  expect(cartMounted).not.toHaveBeenCalled()
  act(() => useCartStore.getState().open())
  expect(await screen.findByRole('button', { name: 'Повторный вход' })).toBeInTheDocument()
  expect(cartMounted).toHaveBeenCalledOnce()
  act(() => useCartStore.getState().close())
  expect(screen.queryByRole('button', { name: 'Повторный вход' })).not.toBeInTheDocument()
  act(() => useCartStore.getState().open())
  expect(await screen.findByRole('button', { name: 'Повторный вход' })).toBeInTheDocument()
  expect(cartMounted).toHaveBeenCalledOnce()
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

test('session toast stays above page content and inside an open dialog', async () => {
  me.mockRejectedValue(new Error('offline'))
  render(<App />)

  const toast = await screen.findByRole('alert', { hidden: true })
  expect(toast).toHaveAttribute('popover', 'manual')
  expect(toast.parentElement).toBe(document.body)

  const dialog = document.createElement('dialog')
  dialog.setAttribute('open', '')
  document.body.append(dialog)
  await waitFor(() =>
    expect(dialog.contains(screen.getByRole('alert', { hidden: true }))).toBe(true),
  )

  dialog.removeAttribute('open')
  await waitFor(() =>
    expect(screen.getByRole('alert', { hidden: true }).parentElement).toBe(document.body),
  )
  dialog.remove()
})

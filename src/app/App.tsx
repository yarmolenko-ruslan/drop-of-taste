import {
  Component,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router'
import { HomeScreen } from '../screens/HomeScreen/HomeScreen'
// Экраны подгружаются по маршруту: первый визит начинается с лёгкого чанка,
// тяжёлые экраны (кабинет, юридические страницы) не тормозят старт.
const CategoryScreen = lazy(() =>
  import('../screens/CategoryScreen/CategoryScreen').then((m) => ({ default: m.CategoryScreen })),
)
const SearchScreen = lazy(() =>
  import('../screens/SearchScreen/SearchScreen').then((m) => ({ default: m.SearchScreen })),
)
const AboutScreen = lazy(() =>
  import('../screens/AboutScreen/AboutScreen').then((m) => ({ default: m.AboutScreen })),
)
const PromotionsScreen = lazy(() =>
  import('../screens/PromotionsScreen/PromotionsScreen').then((m) => ({
    default: m.PromotionsScreen,
  })),
)
const LegalScreen = lazy(() =>
  import('../screens/LegalScreen/LegalScreen').then((m) => ({ default: m.LegalScreen })),
)
const AccountScreen = lazy(() =>
  import('../screens/AccountScreen/AccountScreen').then((m) => ({ default: m.AccountScreen })),
)
const AdminScreen = lazy(() =>
  import('../screens/AdminScreen/AdminScreen').then((m) => ({ default: m.AdminScreen })),
)
const PaymentReturnScreen = lazy(() =>
  import('../screens/PaymentReturnScreen/PaymentReturnScreen').then((m) => ({
    default: m.PaymentReturnScreen,
  })),
)
const NotFoundScreen = lazy(() =>
  import('../screens/NotFoundScreen/NotFoundScreen').then((m) => ({ default: m.NotFoundScreen })),
)
import { SiteHeader } from '../features/site-header/ui/SiteHeader'
import { SiteFooter } from '../features/site-footer/ui/SiteFooter'
import { addOneToCart, useCartStore } from '../features/cart'
import { CartDrawer } from '../features/cart/ui/CartDrawer/CartDrawer'
import { AuthDialog } from '../features/auth/ui/AuthDialog/AuthDialog'
import type { FulfillmentSelection } from '../features/fulfillment/ui/FulfillmentDialog/FulfillmentDialog'
import { CafeMapDialog } from '../features/fulfillment/ui/FulfillmentDialog/CafeMapDialog'
import { ApiError, apiRequest, authApi, type AuthUser } from '../features/auth/api/authApi'
import { CatalogProvider, useCatalog } from '../features/catalog/api/CatalogProvider'
import { SiteContentProvider, useSiteContent } from '../features/site-content/SiteContentProvider'
import { Spinner } from '../shared/ui/Spinner/Spinner'
import { ScrollTopButton } from '../shared/ui/ScrollTopButton/ScrollTopButton'
import { ErrorPage } from '../shared/ui/ErrorPage/ErrorPage'
import styles from './App.module.css'
import errorStyles from '../shared/ui/ErrorPage/ErrorPage.module.css'

const pendingLogoutKey = 'drop-of-taste:pending-logout'
const sessionChangeKey = 'drop-of-taste:session-change'

function hasPendingLogout() {
  try {
    return localStorage.getItem(pendingLogoutKey) === '1'
  } catch {
    return false
  }
}

function storePendingLogout(pending: boolean) {
  try {
    if (pending) localStorage.setItem(pendingLogoutKey, '1')
    else localStorage.removeItem(pendingLogoutKey)
  } catch {
    // Private browsing can deny storage; the current tab still hides private data.
  }
}

function broadcastSessionChange() {
  try {
    localStorage.setItem(sessionChangeKey, crypto.randomUUID())
  } catch {
    // Session state in this tab remains correct without cross-tab storage.
  }
}

function ScrollToTopOnRouteChange() {
  const { pathname, hash } = useLocation()

  useEffect(() => {
    if (hash) {
      document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView()
    } else {
      window.scrollTo(0, 0)
    }
  }, [pathname, hash])

  return null
}

function ToastLayer({ children }: { children: ReactNode }) {
  const [container, setContainer] = useState<HTMLElement>(document.body)
  const toastRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const updateContainer = () => {
      const dialogs = document.querySelectorAll<HTMLDialogElement>('dialog[open]')
      setContainer(dialogs[dialogs.length - 1] ?? document.body)
    }
    updateContainer()
    const observer = new MutationObserver(updateContainer)
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['open'],
    })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const toast = toastRef.current
    if (!toast || !toast.showPopover) return
    toast.showPopover()
    return () => {
      if (toast.matches(':popover-open')) toast.hidePopover()
    }
  }, [container])

  return createPortal(
    <div ref={toastRef} className={styles.noticeToast} popover="manual" role="alert">
      {children}
    </div>,
    container,
  )
}

/**
 * Ленивые экраны грузятся отдельными чанками: если старый открытый сайт запросит
 * чанк, которого уже нет после выкладки (хеши имён меняются), импорт отклоняется.
 * Без границы такой сбой ронял бы всё приложение — показываем предложение обновиться.
 */
class RouteErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(failure: unknown, info: unknown) {
    // Без журнала диагностировать фейлы чанков в проде нечем.
    console.error('Route render failed', failure, info)
  }

  render() {
    if (this.state.failed) {
      return (
        <ErrorPage
          title="Страница не загрузилась"
          message="Похоже, приложение обновилось или прервалась связь. Обновите вкладку — и всё заварится заново."
          actions={
            <button
              type="button"
              className={`${errorStyles.action} ${errorStyles.primary}`}
              onClick={() => window.location.reload()}
            >
              Обновить страницу
            </button>
          }
        />
      )
    }
    return this.props.children
  }
}

function AppContent() {
  const siteContent = useSiteContent()
  const catalog = useCatalog()?.data
  const recommendations = useMemo(() => {
    if (!catalog) return []
    const products = new Map(
      catalog.categories.flatMap((category) =>
        category.products.map((product) => [product._id, product] as const),
      ),
    )
    return catalog.newArrivalIds.flatMap((id) => {
      const product = products.get(id)
      return product?.available
        ? [
            {
              id,
              name: product.name,
              image: product.image ?? '',
              priceRub: product.priceKopecks / 100,
            },
          ]
        : []
    })
  }, [catalog])
  useEffect(() => {
    if (catalog)
      useCartStore
        .getState()
        .syncCatalog(catalog.categories.flatMap((category) => category.products))
  }, [catalog])
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const isAdmin = pathname === '/admin'
  const isCartOpen = useCartStore((state) => state.isOpen)
  const closeCart = useCartStore((state) => state.close)
  const openCart = useCartStore((state) => state.open)
  const clearCart = useCartStore((state) => state.clear)
  const cafeAddress = siteContent.address
  const [fulfillment, setFulfillment] = useState<FulfillmentSelection>({
    mode: 'pickup',
    label: cafeAddress,
  })
  const [isCafeMapOpen, setCafeMapOpen] = useState(false)
  /** Сценарий «выбор адреса из корзины»: после сохранения выбора возвращаем пользователя в корзину. */
  const [pickAddressForCart, setPickAddressForCart] = useState(false)
  const [isAuthOpen, setAuthOpen] = useState(false)
  const [authReturnToCart, setAuthReturnToCart] = useState(false)
  const [user, setUser] = useState<AuthUser>()
  const activeUserId = useRef<string | undefined>(undefined)
  const [ordersRevision, setOrdersRevision] = useState(0)
  const [sessionLoading, setSessionLoading] = useState(() => !hasPendingLogout())
  const [sessionNotice, setSessionNotice] = useState('')
  const [logoutPending, setLogoutPending] = useState(hasPendingLogout)
  const sessionEpoch = useRef(0)
  const logoutInFlight = useRef(false)
  const [savedDelivery, setSavedDelivery] = useState<{
    forUser: string
    selection: FulfillmentSelection | null
  } | null>(null)
  const fulfillmentRef = useRef(fulfillment)
  useEffect(() => {
    fulfillmentRef.current = fulfillment
  }, [fulfillment])

  // Если пользователь ушёл из кабинета, не выбрав адрес, сценарий возврата в корзину снимается
  const [prevPathname, setPrevPathname] = useState(pathname)
  if (prevPathname !== pathname) {
    setPrevPathname(pathname)
    if (pickAddressForCart && !pathname.startsWith('/account')) setPickAddressForCart(false)
  }

  useEffect(() => {
    if (!user || !isCartOpen) return
    let active = true
    const headers = { 'X-Account-Id': user.id }
    Promise.all([
      apiRequest<{ profile: { selectedAddressId: string | null } }>('/profile', { headers }),
      apiRequest<{
        addresses: { id: string; label: string; details: FulfillmentSelection['details'] }[]
      }>('/addresses', { headers }),
    ])
      .then(([profile, addressResult]) => {
        if (!active) return
        const selected = addressResult.addresses.find(
          (address) => address.id === profile.profile.selectedAddressId,
        )
        const selection = selected?.details
          ? { mode: 'delivery' as const, label: selected.label, details: selected.details }
          : null
        setSavedDelivery({
          forUser: user.id,
          selection,
        })
        // Если в корзине выбрана доставка, подтягиваем свежий выбранный адрес из кабинета;
        // если адрес исчез (удалён), доставка больше не валидна — сбрасываем на самовывоз
        if (fulfillmentRef.current.mode === 'delivery') {
          if (selection) setFulfillment(selection)
          else setFulfillment({ mode: 'pickup', label: cafeAddress })
        }
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [user, isCartOpen, cafeAddress])

  const clearPrivateState = useCallback(() => {
    closeCart()
    clearCart()
    setFulfillment({ mode: 'pickup', label: cafeAddress })
    setSavedDelivery(null)
    setPickAddressForCart(false)
    setAuthReturnToCart(false)
    setAuthOpen(false)
    setCafeMapOpen(false)
    setOrdersRevision(0)
  }, [clearCart, closeCart, cafeAddress])

  const revokeSession = useCallback(async () => {
    if (logoutInFlight.current) return
    logoutInFlight.current = true
    try {
      await authApi.logout()
      storePendingLogout(false)
      setLogoutPending(false)
      setSessionNotice('')
    } catch {
      setSessionNotice(
        'Данные скрыты. Нет связи с сервером; выход будет завершён при восстановлении связи.',
      )
    } finally {
      logoutInFlight.current = false
    }
  }, [])

  useEffect(() => {
    if (!logoutPending) return
    queueMicrotask(() => void revokeSession())
    window.addEventListener('online', revokeSession)
    return () => window.removeEventListener('online', revokeSession)
  }, [logoutPending, revokeSession])

  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key !== pendingLogoutKey && event.key !== sessionChangeKey) return
      sessionEpoch.current += 1
      clearPrivateState()
      activeUserId.current = undefined
      setUser(undefined)
      navigate('/')
      if (event.key === pendingLogoutKey) {
        setLogoutPending(event.newValue === '1')
        return
      }
      if (hasPendingLogout()) return
      const epoch = sessionEpoch.current
      void authApi
        .me()
        .then(({ user: account }) => {
          if (epoch === sessionEpoch.current) {
            activeUserId.current = account.id
            setUser(account)
          }
        })
        .catch(() => undefined)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [clearPrivateState, navigate])

  useEffect(() => {
    function onAccountChanged() {
      sessionEpoch.current += 1
      const epoch = sessionEpoch.current
      clearPrivateState()
      activeUserId.current = undefined
      setUser(undefined)
      navigate('/')
      if (hasPendingLogout()) return
      void authApi
        .me()
        .then(({ user: account }) => {
          if (epoch === sessionEpoch.current) {
            activeUserId.current = account.id
            setUser(account)
          }
        })
        .catch(() => undefined)
    }
    window.addEventListener('drop-of-taste:account-changed', onAccountChanged)
    return () => window.removeEventListener('drop-of-taste:account-changed', onAccountChanged)
  }, [clearPrivateState, navigate])

  useEffect(() => {
    if (hasPendingLogout()) return
    let active = true
    const epoch = sessionEpoch.current
    authApi
      .me()
      .then(({ user: account }) => {
        if (active && epoch === sessionEpoch.current) {
          activeUserId.current = account.id
          setUser(account)
        }
      })
      .catch((failure) => {
        if (
          active &&
          epoch === sessionEpoch.current &&
          !(failure instanceof ApiError && failure.code === 'UNAUTHENTICATED')
        )
          setSessionNotice('Не удалось проверить вход: нет связи с сервером.')
      })
      .finally(() => {
        if (active) setSessionLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  // Связь вернулась после старта без сервера: вход не был проверен — пробуем снова,
  // чтобы пользователь не сидел «гостем», пока не обновит вкладку.
  useEffect(() => {
    if (user || logoutPending || hasPendingLogout()) return
    function onOnline() {
      const epoch = sessionEpoch.current
      void authApi
        .me()
        .then(({ user: account }) => {
          if (epoch === sessionEpoch.current) {
            activeUserId.current = account.id
            setUser(account)
            setSessionNotice('')
          }
        })
        .catch(() => undefined)
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [user, logoutPending])

  function goToAddressesFromCart() {
    setPickAddressForCart(true)
    closeCart()
    navigate('/account/addresses')
  }

  function returnToCartAfterPick() {
    setPickAddressForCart(false)
    navigate(-1)
    openCart()
  }

  const logout = useCallback(async () => {
    sessionEpoch.current += 1
    storePendingLogout(true)
    broadcastSessionChange()
    setLogoutPending(true)
    clearPrivateState()
    activeUserId.current = undefined
    setUser(undefined)
    navigate('/')
  }, [clearPrivateState, navigate])

  const logoutCurrentUser = useMemo(() => {
    const expectedId = user?.id
    return () => {
      if (expectedId && activeUserId.current === expectedId) void logout()
    }
  }, [logout, user?.id])

  const authDialogEpoch = sessionEpoch.current

  return (
    <>
      <ScrollToTopOnRouteChange />
      {sessionNotice && (
        <ToastLayer>
          <span className={styles.noticeIcon} aria-hidden="true">
            <svg viewBox="0 0 20 20" width="18" height="18" fill="none">
              <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.6" />
              <path d="M10 5.6v5.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              <circle cx="10" cy="14" r="1.1" fill="currentColor" />
            </svg>
          </span>
          <p className={styles.noticeText}>{sessionNotice}</p>
          {logoutPending && (
            <button
              type="button"
              className={styles.noticeAction}
              onClick={() => void revokeSession()}
            >
              Повторить выход
            </button>
          )}
          <button
            type="button"
            className={styles.noticeClose}
            aria-label="Скрыть уведомление"
            onClick={() => setSessionNotice('')}
          >
            ✕
          </button>
        </ToastLayer>
      )}
      {!isAdmin && (
        <SiteHeader
          phoneNumber={siteContent.phone}
          addressLabel="Кафе на карте"
          accountLabel={user ? user.name.split(' ')[0] || 'Кабинет' : undefined}
          onAddressClick={() => setCafeMapOpen(true)}
          onAccountClick={() => {
            if (logoutPending) return
            if (user) navigate('/account/orders')
            else setAuthOpen(true)
          }}
        />
      )}
      <RouteErrorBoundary>
        <Suspense
          fallback={
            <main className={styles.sessionLoading}>
              <Spinner label="Загружаем страницу…" />
            </main>
          }
        >
          <Routes>
            <Route
              index
              element={
                <HomeScreen
                  onLogin={() => {
                    if (logoutPending) return
                    if (user) navigate('/account/orders')
                    else setAuthOpen(true)
                  }}
                />
              }
            />
            <Route path="menu/:categoryId" element={<CategoryScreen />} />
            <Route path="search" element={<SearchScreen />} />
            <Route path="about" element={<AboutScreen />} />
            <Route path="admin" element={<AdminScreen />} />
            <Route
              path="payment/return"
              element={
                sessionLoading ? (
                  <Spinner label="Проверяем вход…" />
                ) : user ? (
                  <PaymentReturnScreen />
                ) : (
                  <Navigate to="/" replace />
                )
              }
            />
            <Route
              path="promotions"
              element={
                <PromotionsScreen
                  onLogin={() => {
                    if (logoutPending) return
                    if (user) navigate('/account/orders')
                    else setAuthOpen(true)
                  }}
                />
              }
            />
            <Route
              path="promotions/:promotionId"
              element={
                <PromotionsScreen
                  onLogin={() => {
                    if (logoutPending) return
                    if (user) navigate('/account/orders')
                    else setAuthOpen(true)
                  }}
                />
              }
            />
            <Route path="privacy" element={<LegalScreen variant="privacy" />} />
            <Route path="data-consent" element={<LegalScreen variant="consent" />} />
            <Route
              path="account/:section?"
              element={
                sessionLoading ? (
                  <main className={styles.sessionLoading}>
                    <Spinner label="Проверяем вход…" />
                  </main>
                ) : user ? (
                  <AccountScreen
                    key={user.id}
                    user={user}
                    ordersRevision={ordersRevision}
                    onLogout={logoutCurrentUser}
                    onUpdateUser={(updated) =>
                      setUser((current) =>
                        current?.id === user.id ? { ...current, ...updated } : current,
                      )
                    }
                    onAddressPicked={
                      pickAddressForCart
                        ? () => {
                            if (activeUserId.current === user.id) returnToCartAfterPick()
                          }
                        : undefined
                    }
                  />
                ) : (
                  <Navigate to="/" replace />
                )
              }
            />
            <Route path="*" element={<NotFoundScreen />} />
          </Routes>
        </Suspense>
      </RouteErrorBoundary>
      {!isAdmin && <SiteFooter />}
      {!isAdmin && <ScrollTopButton />}
      {isCartOpen && (
        <CartDrawer
          fulfillment={
            fulfillment.mode === 'pickup' ? { mode: 'pickup', label: cafeAddress } : fulfillment
          }
          savedDelivery={
            user && savedDelivery?.forUser === user.id ? savedDelivery.selection : null
          }
          user={user}
          onRequireAuth={() => {
            closeCart()
            if (logoutPending) return
            setAuthReturnToCart(true)
            setAuthOpen(true)
          }}
          onFulfillmentChange={setFulfillment}
          onGoToAddresses={goToAddressesFromCart}
          recommendations={recommendations}
          onAddRecommendation={addOneToCart}
          onOrderCreated={() => setOrdersRevision((current) => current + 1)}
        />
      )}
      {isCafeMapOpen && <CafeMapDialog onClose={() => setCafeMapOpen(false)} />}
      {isAuthOpen && !logoutPending && (
        <AuthDialog
          onClose={() => {
            setAuthOpen(false)
            setAuthReturnToCart(false)
          }}
          onAuthenticate={(account) => {
            if (logoutPending || hasPendingLogout() || authDialogEpoch !== sessionEpoch.current)
              return
            sessionEpoch.current += 1
            activeUserId.current = account.id
            const changedAccount = user && user.id !== account.id
            if (changedAccount) clearPrivateState()
            broadcastSessionChange()
            setSessionNotice('')
            setUser(account)
            setAuthOpen(false)
            if (authReturnToCart && !changedAccount) {
              setAuthReturnToCart(false)
              openCart()
            } else navigate('/account/orders')
          }}
        />
      )}
    </>
  )
}

export function App() {
  return (
    <BrowserRouter>
      <SiteContentProvider>
        <CatalogProvider>
          <AppContent />
        </CatalogProvider>
      </SiteContentProvider>
    </BrowserRouter>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router'
import { HomeScreen } from '../screens/HomeScreen/HomeScreen'
import { CategoryScreen } from '../screens/CategoryScreen/CategoryScreen'
import { AboutScreen } from '../screens/AboutScreen/AboutScreen'
import { PromotionsScreen } from '../screens/PromotionsScreen/PromotionsScreen'
import { LegalScreen } from '../screens/LegalScreen/LegalScreen'
import { AccountScreen } from '../screens/AccountScreen/AccountScreen'
import { SiteHeader } from '../features/site-header/ui/SiteHeader'
import { SiteFooter } from '../features/site-footer/ui/SiteFooter'
import { addOneToCart, useCartStore } from '../features/cart'
import { CartDrawer } from '../features/cart/ui/CartDrawer/CartDrawer'
import { AuthDialog } from '../features/auth/ui/AuthDialog/AuthDialog'
import {
  FulfillmentDialog,
  type FulfillmentSelection,
} from '../features/fulfillment/ui/FulfillmentDialog/FulfillmentDialog'
import { newArrivals } from '../features/catalog/model/newArrivals'
import { ApiError, apiRequest, authApi, type AuthUser } from '../features/auth/api/authApi'
import { CatalogProvider } from '../features/catalog/api/CatalogProvider'
import { Spinner } from '../shared/ui/Spinner/Spinner'
import { ScrollTopButton } from '../shared/ui/ScrollTopButton/ScrollTopButton'
import styles from './App.module.css'

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

function AppContent() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const isCartOpen = useCartStore((state) => state.isOpen)
  const closeCart = useCartStore((state) => state.close)
  const openCart = useCartStore((state) => state.open)
  const cafeAddress = 'г. Красноярск, улица Петра Подзолкова, 3и'
  const [fulfillment, setFulfillment] = useState<FulfillmentSelection>({
    mode: 'pickup',
    label: cafeAddress,
  })
  const [isFulfillmentOpen, setFulfillmentOpen] = useState(false)
  /** Сценарий «выбор адреса из корзины»: после сохранения выбора возвращаем пользователя в корзину. */
  const [pickAddressForCart, setPickAddressForCart] = useState(false)
  const [isAuthOpen, setAuthOpen] = useState(false)
  const [authReturnToCart, setAuthReturnToCart] = useState(false)
  const [user, setUser] = useState<AuthUser>()
  const [sessionLoading, setSessionLoading] = useState(true)
  const [sessionNotice, setSessionNotice] = useState('')
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
    Promise.all([
      apiRequest<{ profile: { selectedAddressId: string | null } }>('/profile'),
      apiRequest<{
        addresses: { id: string; label: string; details: FulfillmentSelection['details'] }[]
      }>('/addresses'),
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
  }, [user, isCartOpen])

  useEffect(() => {
    let active = true
    authApi
      .me()
      .then(({ user }) => {
        if (active) setUser(user)
      })
      .catch((failure) => {
        if (active && !(failure instanceof ApiError && failure.code === 'UNAUTHENTICATED'))
          setSessionNotice('Не удалось проверить вход: нет связи с сервером.')
      })
      .finally(() => {
        if (active) setSessionLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

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
    try {
      await authApi.logout()
    } catch {
      setSessionNotice('Не удалось выйти: нет связи с сервером. Повторите попытку.')
      return
    }
    setSessionNotice('')
    setUser(undefined)
    navigate('/')
  }, [navigate])

  return (
    <>
      <ScrollToTopOnRouteChange />
      {sessionNotice && <p role="alert">{sessionNotice}</p>}
      <SiteHeader
        phoneNumber="+7 123 456-78-90"
        addressLabel="Кафе на карте"
        accountLabel={user ? user.name.split(' ')[0] || 'Кабинет' : undefined}
        onAddressClick={() => setFulfillmentOpen(true)}
        onAccountClick={() => (user ? navigate('/account/orders') : setAuthOpen(true))}
      />
      <Routes>
        <Route
          index
          element={
            <HomeScreen onLogin={() => (user ? navigate('/account/loyalty') : setAuthOpen(true))} />
          }
        />
        <Route path="menu/:categoryId" element={<CategoryScreen />} />
        <Route path="about" element={<AboutScreen />} />
        <Route
          path="promotions"
          element={
            <PromotionsScreen
              onLogin={() => (user ? navigate('/account/loyalty') : setAuthOpen(true))}
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
                user={user}
                onLogout={logout}
                onUpdateUser={(updated) =>
                  setUser((current) => (current ? { ...current, ...updated } : current))
                }
                onAddressPicked={pickAddressForCart ? returnToCartAfterPick : undefined}
              />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
      </Routes>
      <SiteFooter />
      <ScrollTopButton />
      {isCartOpen && (
        <CartDrawer
          fulfillment={fulfillment}
          savedDelivery={
            user && savedDelivery?.forUser === user.id ? savedDelivery.selection : null
          }
          user={user}
          onRequireAuth={() => {
            closeCart()
            setAuthReturnToCart(true)
            setAuthOpen(true)
          }}
          onFulfillmentChange={setFulfillment}
          onGoToAddresses={goToAddressesFromCart}
          recommendations={newArrivals}
          onAddRecommendation={addOneToCart}
        />
      )}
      {isFulfillmentOpen && (
        <FulfillmentDialog
          onClose={() => setFulfillmentOpen(false)}
          onSave={(selection) => {
            setFulfillment(selection)
            setFulfillmentOpen(false)
          }}
        />
      )}
      {isAuthOpen && (
        <AuthDialog
          onClose={() => {
            setAuthOpen(false)
            setAuthReturnToCart(false)
          }}
          onAuthenticate={(account) => {
            setSessionNotice('')
            setUser(account)
            setAuthOpen(false)
            if (authReturnToCart) {
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
      <CatalogProvider>
        <AppContent />
      </CatalogProvider>
    </BrowserRouter>
  )
}

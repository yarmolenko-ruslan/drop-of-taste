import { useCallback, useEffect, useState } from 'react'
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
import { ApiError, authApi, type AuthUser } from '../features/auth/api/authApi'
import { CatalogProvider } from '../features/catalog/api/CatalogProvider'

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
  const isCartOpen = useCartStore((state) => state.isOpen)
  const closeCart = useCartStore((state) => state.close)
  const openCart = useCartStore((state) => state.open)
  const [fulfillment, setFulfillment] = useState<FulfillmentSelection>({
    mode: 'pickup',
    label: 'г. Красноярск, улица Петра Подзолкова, 3и',
  })
  const [isFulfillmentOpen, setFulfillmentOpen] = useState(false)
  const [returnToCart, setReturnToCart] = useState(false)
  const [isAuthOpen, setAuthOpen] = useState(false)
  const [authReturnToCart, setAuthReturnToCart] = useState(false)
  const [user, setUser] = useState<AuthUser>()
  const [sessionLoading, setSessionLoading] = useState(true)
  const [sessionNotice, setSessionNotice] = useState('')

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

  function chooseFulfillment(fromCart: boolean) {
    if (fromCart) closeCart()
    setReturnToCart(fromCart)
    setFulfillmentOpen(true)
  }

  function closeFulfillment() {
    setFulfillmentOpen(false)
    if (returnToCart) openCart()
    setReturnToCart(false)
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
        addressLabel={fulfillment?.mode === 'pickup' ? 'Кафе на карте' : fulfillment?.label}
        accountLabel={user ? user.name.split(' ')[0] || 'Кабинет' : undefined}
        onAddressClick={() => chooseFulfillment(false)}
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
              <main role="status">Проверяем вход…</main>
            ) : user ? (
              <AccountScreen
                user={user}
                onLogout={logout}
                onUpdateUser={(updated) =>
                  setUser((current) => (current ? { ...current, ...updated } : current))
                }
              />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
      </Routes>
      <SiteFooter />
      {isCartOpen && (
        <CartDrawer
          fulfillmentLabel={fulfillment?.label}
          fulfillment={fulfillment}
          user={user}
          onRequireAuth={() => {
            closeCart()
            setAuthReturnToCart(true)
            setAuthOpen(true)
          }}
          onChooseFulfillment={() => chooseFulfillment(true)}
          recommendations={newArrivals}
          onAddRecommendation={addOneToCart}
        />
      )}
      {isFulfillmentOpen && (
        <FulfillmentDialog
          allowPickup={!returnToCart}
          current={fulfillment}
          onClose={closeFulfillment}
          onSave={(selection) => {
            setFulfillment(selection)
            closeFulfillment()
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

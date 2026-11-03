import { useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router'
import { HomeScreen } from '../screens/HomeScreen/HomeScreen'
import { CategoryScreen } from '../screens/CategoryScreen/CategoryScreen'
import { AboutScreen } from '../screens/AboutScreen/AboutScreen'
import { PromotionsScreen } from '../screens/PromotionsScreen/PromotionsScreen'
import { LegalScreen } from '../screens/LegalScreen/LegalScreen'
import { AccountScreen, type AccountUser } from '../screens/AccountScreen/AccountScreen'
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
  const [fulfillment, setFulfillment] = useState<FulfillmentSelection>()
  const [isFulfillmentOpen, setFulfillmentOpen] = useState(false)
  const [returnToCart, setReturnToCart] = useState(false)
  const [isAuthOpen, setAuthOpen] = useState(false)
  const [user, setUser] = useState<AccountUser>()

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

  function logout() {
    setUser(undefined)
    navigate('/')
  }

  return (
    <>
      <ScrollToTopOnRouteChange />
      <SiteHeader
        phoneNumber="+7 123 456-78-90"
        addressLabel={fulfillment?.mode === 'pickup' ? 'Самовывоз' : fulfillment?.label}
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
            user ? (
              <AccountScreen user={user} onLogout={logout} onUpdateUser={setUser} />
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
          onChooseFulfillment={() => chooseFulfillment(true)}
          recommendations={newArrivals}
          onAddRecommendation={addOneToCart}
        />
      )}
      {isFulfillmentOpen && (
        <FulfillmentDialog
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
          onClose={() => setAuthOpen(false)}
          onAuthenticate={(phone) => {
            setUser({ name: '', phone })
            setAuthOpen(false)
            navigate('/account/orders')
          }}
        />
      )}
    </>
  )
}

export function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  )
}

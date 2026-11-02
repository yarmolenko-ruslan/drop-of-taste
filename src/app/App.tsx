import { useEffect, useState } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router'
import { useLocation } from 'react-router'
import { HomeScreen } from '../screens/HomeScreen/HomeScreen'
import { CategoryScreen } from '../screens/CategoryScreen/CategoryScreen'
import { SiteHeader } from '../features/site-header/ui/SiteHeader'
import { SiteFooter } from '../features/site-footer/ui/SiteFooter'
import { useCartStore } from '../features/cart'
import { CartDrawer } from '../features/cart/ui/CartDrawer/CartDrawer'
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

export function App() {
  const isCartOpen = useCartStore((state) => state.isOpen)
  const closeCart = useCartStore((state) => state.close)
  const openCart = useCartStore((state) => state.open)
  const addToCart = useCartStore((state) => state.add)
  const [fulfillment, setFulfillment] = useState<FulfillmentSelection>()
  const [isFulfillmentOpen, setFulfillmentOpen] = useState(false)
  const [returnToCart, setReturnToCart] = useState(false)

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

  return (
    <BrowserRouter>
      <ScrollToTopOnRouteChange />
      <SiteHeader
        phoneNumber="+7 123 456-78-90"
        addressLabel={fulfillment?.label}
        onAddressClick={() => chooseFulfillment(false)}
      />
      <Routes>
        <Route index element={<HomeScreen />} />
        <Route path="menu/:categoryId" element={<CategoryScreen />} />
      </Routes>
      <SiteFooter />
      {isCartOpen && (
        <CartDrawer
          fulfillmentLabel={fulfillment?.label}
          onChooseFulfillment={() => chooseFulfillment(true)}
          recommendations={newArrivals.slice(0, 4)}
          onAddRecommendation={(item) =>
            addToCart(item, { variant: '', removedIngredients: [], extras: {}, quantity: 1 })
          }
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
    </BrowserRouter>
  )
}

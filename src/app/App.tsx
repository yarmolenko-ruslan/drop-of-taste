import { useEffect } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router'
import { useLocation } from 'react-router'
import { HomeScreen } from '../screens/HomeScreen/HomeScreen'
import { CategoryScreen } from '../screens/CategoryScreen/CategoryScreen'
import { SiteHeader } from '../features/site-header/ui/SiteHeader'

function ScrollToTopOnRouteChange() {
  const { pathname, hash } = useLocation()

  useEffect(() => {
    if (!hash) window.scrollTo(0, 0)
  }, [pathname, hash])

  return null
}

export function App() {
  return (
    <BrowserRouter>
      <ScrollToTopOnRouteChange />
      <SiteHeader phoneNumber="+7 123 456-78-90" />
      <Routes>
        <Route index element={<HomeScreen />} />
        <Route path="menu/:categoryId" element={<CategoryScreen />} />
      </Routes>
    </BrowserRouter>
  )
}

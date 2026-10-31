import { BrowserRouter, Route, Routes } from 'react-router'
import { HomeScreen } from '../screens/HomeScreen/HomeScreen'

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route index element={<HomeScreen />} />
      </Routes>
    </BrowserRouter>
  )
}

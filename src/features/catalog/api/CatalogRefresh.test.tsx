import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { CatalogProvider } from './CatalogProvider'
import { CategoryScreen } from '../../../screens/CategoryScreen/CategoryScreen'
import { HomeScreen } from '../../../screens/HomeScreen/HomeScreen'
import { SearchScreen } from '../../../screens/SearchScreen/SearchScreen'

const catalog = {
  categories: [
    {
      id: 'soups',
      title: 'Супы',
      subtitle: '',
      products: [
        {
          _id: 'borscht',
          id: 'borscht',
          name: 'Борщ стабильный',
          details: 'Свежий борщ',
          priceKopecks: 40000,
          available: true,
          badges: [],
          action: 'add',
          image: '',
          imageAlt: '',
          amount: 250,
          measure: 'г',
          calories: 100,
        },
      ],
    },
  ],
  newArrivalIds: [],
}

afterEach(() => vi.unstubAllGlobals())

test.each(['/', '/menu/soups', '/search?q=борщ'])(
  'фоновое обновление и его ошибка сохраняют товары на странице %s',
  async (path) => {
    let fail!: (reason: Error) => void
    let requests = 0
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url !== '/api/catalog')
          return Promise.resolve(Response.json({ testPaymentEnabled: false }))
        if (++requests === 1) return Promise.resolve(Response.json(catalog))
        return new Promise<Response>((_resolve, reject) => {
          fail = reject
        })
      }),
    )
    render(
      <MemoryRouter initialEntries={[path]}>
        <CatalogProvider>
          <Routes>
            <Route path="/" element={<HomeScreen />} />
            <Route path="/menu/:categoryId" element={<CategoryScreen />} />
            <Route path="/search" element={<SearchScreen />} />
          </Routes>
        </CatalogProvider>
      </MemoryRouter>,
    )
    const product = await screen.findByText('Борщ стабильный')
    act(() => window.dispatchEvent(new Event('focus')))
    await waitFor(() => expect(requests).toBe(2))
    expect(screen.getByText('Борщ стабильный')).toBe(product)
    expect(screen.queryByLabelText('Загружаем меню…')).not.toBeInTheDocument()
    await act(async () => fail(new Error('offline')))
    expect(await screen.findByText('Нет связи с локальным сервером')).toBeInTheDocument()
    expect(screen.getByText('Борщ стабильный')).toBe(product)
  },
)

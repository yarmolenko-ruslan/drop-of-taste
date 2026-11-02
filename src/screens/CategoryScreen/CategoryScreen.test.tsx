import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { CategoryScreen } from './CategoryScreen'

test('ссылка раздела открывает список товаров категории', () => {
  render(
    <MemoryRouter initialEntries={['/menu/soups']}>
      <Routes>
        <Route path="/menu/:categoryId" element={<CategoryScreen />} />
      </Routes>
    </MemoryRouter>,
  )

  expect(screen.getByRole('heading', { level: 1, name: 'Супы' })).toBeInTheDocument()
  expect(screen.getAllByRole('article')).toHaveLength(4)
  expect(screen.getByRole('heading', { name: 'Борщ с пампушками' })).toBeInTheDocument()
})

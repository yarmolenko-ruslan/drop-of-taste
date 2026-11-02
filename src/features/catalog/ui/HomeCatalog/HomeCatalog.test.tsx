import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { HomeCatalog } from './HomeCatalog'

test('показывает комбо, восемь разделов и ссылки на страницы категорий', () => {
  render(
    <MemoryRouter>
      <HomeCatalog />
    </MemoryRouter>,
  )

  expect(screen.getAllByRole('article')).toHaveLength(36)
  expect(screen.getByRole('heading', { name: 'Комбо и наборы' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Напитки' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Соусы' })).not.toBeInTheDocument()
  expect(screen.getAllByRole('link', { name: /Весь раздел/ })).toHaveLength(8)
  expect(screen.getAllByRole('link', { name: /Весь раздел/ })[0]).toHaveAttribute(
    'href',
    '/menu/breakfast',
  )
})

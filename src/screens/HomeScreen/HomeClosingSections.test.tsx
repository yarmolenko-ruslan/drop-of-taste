import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { HomeClosingSections } from './HomeClosingSections'

test('показывает блоки от соусов до информации о кафе без строки о доставке в городе', () => {
  render(
    <MemoryRouter>
      <HomeClosingSections />
    </MemoryRouter>,
  )

  expect(screen.getAllByRole('article')).toHaveLength(5)
  expect(screen.getByRole('heading', { name: 'Соусы' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /Весь раздел/ })).toHaveAttribute('href', '/menu/sauces')
  expect(
    screen.getByRole('heading', { name: 'Копите бонусы с каждого заказа' }),
  ).toBeInTheDocument()
  expect(
    screen.getByRole('heading', { name: 'Больше, чем еда — это наш край' }),
  ).toBeInTheDocument()
  expect(screen.queryByText(/Доставка домашней еды в/)).not.toBeInTheDocument()
})

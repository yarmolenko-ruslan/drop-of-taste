import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { NotFoundScreen } from './NotFoundScreen'

test('404 page offers a way back home', () => {
  render(
    <MemoryRouter>
      <NotFoundScreen />
    </MemoryRouter>,
  )

  expect(screen.getByRole('heading', { name: 'Такой страницы нет' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'На главную' })).toHaveAttribute('href', '/')
  expect(screen.getByRole('button', { name: 'Назад' })).toBeInTheDocument()
})

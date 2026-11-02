import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { HomeScreen } from './HomeScreen'

test('показывает заголовок главной страницы', () => {
  render(
    <MemoryRouter>
      <HomeScreen />
    </MemoryRouter>,
  )
  expect(screen.getByRole('heading', { level: 1, name: 'Капела вкуса' })).toBeInTheDocument()
})

import { render, screen } from '@testing-library/react'
import { HomeScreen } from './HomeScreen'

test('показывает заголовок главной страницы', () => {
  render(<HomeScreen />)
  expect(screen.getByRole('heading', { level: 1, name: 'Drop of Taste' })).toBeInTheDocument()
})

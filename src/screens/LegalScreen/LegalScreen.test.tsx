import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { LegalScreen } from './LegalScreen'

test.each([
  ['privacy' as const, 'Политика конфиденциальности'],
  ['consent' as const, 'Согласие на обработку персональных данных'],
])('показывает документ %s', (variant, title) => {
  render(
    <MemoryRouter>
      <LegalScreen variant={variant} />
    </MemoryRouter>,
  )

  expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument()
  expect(screen.getAllByRole('heading', { level: 2 }).length).toBeGreaterThan(5)
})

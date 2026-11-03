import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { SiteFooter } from './SiteFooter'

test('ссылки покупателям ведут на существующие страницы', () => {
  render(
    <MemoryRouter>
      <SiteFooter />
    </MemoryRouter>,
  )

  expect(screen.getByRole('link', { name: 'Акции' })).toHaveAttribute('href', '/promotions')
  expect(screen.getByRole('link', { name: 'О нас' })).toHaveAttribute('href', '/about')
  expect(screen.getByRole('link', { name: 'Политика конфиденциальности' })).toHaveAttribute(
    'href',
    '/privacy',
  )
  expect(screen.getByRole('link', { name: 'Согласие на обработку данных' })).toHaveAttribute(
    'href',
    '/data-consent',
  )
  expect(screen.queryByText('Адреса кафе')).not.toBeInTheDocument()
})

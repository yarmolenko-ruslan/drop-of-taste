import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { SiteHeader } from './SiteHeader'

test('номер в шапке открывает звонок без подписи', () => {
  render(
    <MemoryRouter>
      <SiteHeader phoneNumber="+7 (999) 123-45-67" />
    </MemoryRouter>,
  )

  expect(screen.getByRole('link', { name: '+7 (999) 123-45-67' })).toHaveAttribute(
    'href',
    'tel:+79991234567',
  )
  expect(screen.queryByText('Звонок бесплатный')).not.toBeInTheDocument()
})

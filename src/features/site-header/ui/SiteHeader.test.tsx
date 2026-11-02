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
  expect(screen.getByRole('navigation', { name: 'Категории меню' })).toBeInTheDocument()
})

test('скрывает меню категорий на странице «О кафе»', () => {
  render(
    <MemoryRouter initialEntries={['/about']}>
      <SiteHeader />
    </MemoryRouter>,
  )

  expect(screen.queryByRole('navigation', { name: 'Категории меню' })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Капела вкуса — главная' })).toBeInTheDocument()
})

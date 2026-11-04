import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { SiteHeader } from './SiteHeader'

function scrollWindowTo(y: number) {
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true, writable: true })
  fireEvent.scroll(window)
}

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

test('скрывает меню категорий на странице «О ресторане»', () => {
  render(
    <MemoryRouter initialEntries={['/about']}>
      <SiteHeader />
    </MemoryRouter>,
  )

  expect(screen.queryByRole('navigation', { name: 'Категории меню' })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Капела вкуса — главная' })).toBeInTheDocument()
})

test('компактный хедер появляется после прокрутки и прячется у верха страницы', async () => {
  render(
    <MemoryRouter>
      <SiteHeader />
    </MemoryRouter>,
  )
  // В jsdom offsetHeight = 0, поэтому порог срабатывания — любая прокрутка
  const compact = screen.getByRole('region', { hidden: true })
  expect(compact).toHaveAttribute('aria-hidden', 'true')

  scrollWindowTo(200)
  await waitFor(() => expect(compact).toHaveAttribute('aria-hidden', 'false'))

  scrollWindowTo(0)
  await waitFor(() => expect(compact).toHaveAttribute('aria-hidden', 'true'))
})

test('компактный хедер содержит логотип, категории, кабинет и корзину', async () => {
  render(
    <MemoryRouter>
      <SiteHeader accountLabel="Руслан" />
    </MemoryRouter>,
  )

  const compact = screen.getByRole('region', { hidden: true })
  scrollWindowTo(200)
  await waitFor(() => expect(compact).toHaveAttribute('aria-hidden', 'false'))

  expect(compact.querySelectorAll('a[href^="#"], a[href^="/#"]').length).toBeGreaterThan(0)
  expect(compact).toHaveTextContent('Акции')
  expect(compact).toHaveTextContent('Комбо')
  expect(compact).toHaveAccessibleName()
  expect(screen.getAllByRole('button', { name: 'Руслан' }).length).toBe(2)
  expect(screen.getAllByRole('button', { name: /Корзина, 0 поз\./ }).length).toBe(2)
})

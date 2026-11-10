import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { vi } from 'vitest'
import { useCartStore } from '../../features/cart'
import { HomeClosingSections } from './HomeClosingSections'

afterEach(() => vi.unstubAllGlobals())

test('при включённой тестовой оплате убирает устаревший текст, что оплата не принимается', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ testPaymentEnabled: true })),
  )
  render(
    <MemoryRouter>
      <HomeClosingSections />
    </MemoryRouter>,
  )
  expect(await screen.findByText('Банковской картой')).toBeInTheDocument()
  expect(screen.queryByText('Оплата пока не принимается')).not.toBeInTheDocument()
})

test('показывает блоки от соусов до информации о ресторане без строки о доставке в городе', () => {
  render(
    <MemoryRouter>
      <HomeClosingSections />
    </MemoryRouter>,
  )

  expect(screen.getAllByRole('article')).toHaveLength(5)
  expect(screen.getByRole('heading', { name: 'Соусы' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /Весь раздел/ })).toHaveAttribute('href', '/menu/sauces')
  expect(screen.getByRole('heading', { name: 'Всё для удобного заказа' })).toBeInTheDocument()
  expect(
    screen.getByRole('heading', { name: 'Больше, чем еда — это наш край' }),
  ).toBeInTheDocument()
  expect(screen.queryByText(/Доставка домашней еды в/)).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'О кафе' })).toHaveAttribute('href', '/about')
  expect(screen.queryByRole('link', { name: 'Адрес кафе' })).not.toBeInTheDocument()
})

test('кнопка входа в бонусной программе открывает сценарий входа', () => {
  const onLogin = vi.fn()
  render(
    <MemoryRouter>
      <HomeClosingSections onLogin={onLogin} />
    </MemoryRouter>,
  )

  fireEvent.click(screen.getByRole('button', { name: 'Войти по номеру' }))
  expect(onLogin).toHaveBeenCalledTimes(1)
})

test('кнопка соуса добавляет его сразу, а карточка открывает описание', () => {
  useCartStore.setState({ lines: [], isOpen: false })
  const onSauceAction = vi.fn()
  render(
    <MemoryRouter>
      <HomeClosingSections onSauceAction={onSauceAction} />
    </MemoryRouter>,
  )

  fireEvent.click(screen.getByRole('button', { name: 'Добавить соус «Сметана» в корзину' }))
  expect(useCartStore.getState().lines[0]).toMatchObject({
    productId: 'sauce-Сметана',
    quantity: 1,
  })
  expect(useCartStore.getState().isOpen).toBe(false)
  expect(onSauceAction).not.toHaveBeenCalled()

  fireEvent.click(screen.getByRole('button', { name: 'Подробнее о соусе «Сметана»' }))
  expect(onSauceAction).toHaveBeenCalledWith('Сметана')
})

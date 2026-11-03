import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { vi } from 'vitest'
import { useCartStore } from '../../../cart'
import { HomeCatalog } from './HomeCatalog'

test('показывает комбо, восемь разделов и ссылки на страницы категорий', () => {
  render(
    <MemoryRouter>
      <HomeCatalog />
    </MemoryRouter>,
  )

  expect(screen.getAllByRole('article')).toHaveLength(36)
  expect(screen.getByRole('heading', { name: 'Комбо и наборы' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Напитки' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Соусы' })).not.toBeInTheDocument()
  expect(screen.getAllByRole('link', { name: /Весь раздел/ })).toHaveLength(8)
  expect(screen.getAllByRole('link', { name: /Весь раздел/ })[0]).toHaveAttribute(
    'href',
    '/menu/breakfast',
  )
})

test('кнопка набора добавляет его без открытия описания', () => {
  useCartStore.setState({ lines: [], isOpen: false })
  const onComboAction = vi.fn()
  render(
    <MemoryRouter>
      <HomeCatalog onComboAction={onComboAction} />
    </MemoryRouter>,
  )

  const cardButton = screen.getByRole('button', { name: 'Подробнее о наборе «Обед как дома»' })
  const card = cardButton.closest('article')
  expect(card).not.toBeNull()
  fireEvent.click(within(card!).getByRole('button', { name: 'В корзину' }))
  expect(useCartStore.getState().lines[0]).toMatchObject({ productId: 'lunch', quantity: 1 })
  expect(onComboAction).not.toHaveBeenCalled()

  fireEvent.click(cardButton)
  expect(onComboAction).toHaveBeenCalledTimes(1)
})

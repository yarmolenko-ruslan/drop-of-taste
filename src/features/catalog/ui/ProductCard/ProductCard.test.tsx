import { fireEvent, render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import type { CatalogProduct } from '../../model/product'
import { ProductCard } from './ProductCard'

test('карточка принимает данные и передаёт выбранный товар обработчику', () => {
  const product: CatalogProduct = {
    id: 'test',
    name: 'Тестовое блюдо',
    details: 'Описание блюда',
    image: '/products/ukha.jpg',
    imageAlt: 'Тестовое блюдо на тарелке',
    badges: ['hit'],
    action: 'choose',
    measure: 'г',
    amount: 350,
    calories: 210,
    priceRub: 420,
  }
  const onAction = vi.fn()

  render(<ProductCard product={product} onAction={onAction} />)

  expect(screen.getByText('Тестовое блюдо')).toBeInTheDocument()
  expect(screen.getByText('ХИТ')).toBeInTheDocument()
  expect(screen.getByText('350 г · 210 ккал')).toBeInTheDocument()
  expect(screen.getByText('420 ₽')).toBeInTheDocument()
  const action = screen.getByRole('button', { name: 'В корзину' })
  fireEvent.mouseEnter(action)
  expect(screen.getByRole('button', { name: 'Выбрать' })).toBeInTheDocument()
  fireEvent.mouseLeave(action)
  expect(screen.getByRole('button', { name: 'В корзину' })).toBeInTheDocument()
  fireEvent.focus(action)
  fireEvent.click(screen.getByRole('button', { name: 'Выбрать' }))
  expect(onAction).toHaveBeenCalledWith(product)
})

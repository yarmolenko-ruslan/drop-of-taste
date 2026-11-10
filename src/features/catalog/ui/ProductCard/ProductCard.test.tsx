import { fireEvent, render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { useCartStore } from '../../../cart'
import type { CatalogProduct } from '../../model/product'
import { ProductCard } from './ProductCard'

test('кнопка выбора открывает карточку, а не добавляет блюдо без выбора', () => {
  useCartStore.setState({ lines: [], isOpen: false })
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
  const action = screen.getByRole('button', { name: 'Выбрать' })
  fireEvent.click(action)
  expect(useCartStore.getState().lines).toHaveLength(0)
  expect(useCartStore.getState().isOpen).toBe(false)
  expect(onAction).toHaveBeenCalledWith(product)

  fireEvent.click(screen.getByRole('button', { name: 'Подробнее о блюде «Тестовое блюдо»' }))
  expect(onAction).toHaveBeenCalledWith(product)
})

test('после добавления кнопка меняется на счётчик количества, минус при единице убирает блюдо', () => {
  useCartStore.setState({ lines: [], isOpen: false })
  const product: CatalogProduct = {
    id: 'stepper',
    name: 'Блюдо со счётчиком',
    details: 'Описание',
    image: '/products/ukha.jpg',
    imageAlt: 'Блюдо на тарелке',
    badges: [],
    action: 'add',
    measure: 'г',
    amount: 300,
    calories: 200,
    priceRub: 300,
  }

  render(<ProductCard product={product} />)

  fireEvent.click(screen.getByRole('button', { name: 'В корзину' }))
  expect(screen.queryByRole('button', { name: 'В корзину' })).not.toBeInTheDocument()
  expect(screen.getByText('1')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Добавить «Блюдо со счётчиком» в корзину' }))
  expect(screen.getByText('2')).toBeInTheDocument()
  expect(useCartStore.getState().lines[0]).toMatchObject({ quantity: 2 })

  fireEvent.click(screen.getByRole('button', { name: 'Убрать «Блюдо со счётчиком» из корзины' }))
  expect(screen.getByText('1')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Убрать «Блюдо со счётчиком» из корзины' }))
  expect(useCartStore.getState().lines).toHaveLength(0)
  expect(screen.getByRole('button', { name: 'В корзину' })).toBeInTheDocument()
})

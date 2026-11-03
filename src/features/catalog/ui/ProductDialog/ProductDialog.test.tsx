import { fireEvent, render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { useCartStore } from '../../../cart'
import type { DialogItem } from '../../model/dialogContent'
import { ProductDialog } from './ProductDialog'

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})

const item: DialogItem = {
  id: 'borscht',
  name: 'Борщ',
  description: 'Наваристый домашний борщ.',
  badges: [],
  measure: 'г',
  amount: null,
  calories: null,
  priceRub: null,
  ingredients: ['Говядина', 'Свёкла'],
  allergenNote: 'Информацию об аллергенах уточняйте при заказе.',
  extras: ['Сметана'],
}

test('показывает состав без удаления ингредиентов, сохраняет добавки и количество', () => {
  useCartStore.setState({ lines: [], isOpen: false })
  const onClose = vi.fn()
  render(<ProductDialog item={item} onClose={onClose} />)

  expect(screen.getByRole('dialog', { name: 'Борщ' })).toBeInTheDocument()
  expect(screen.getByText('Наваристый домашний борщ.')).toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Состав блюда' })).toHaveTextContent('Говядина, Свёкла')
  expect(
    screen.queryByRole('button', { name: /Говядина|Свёкла|Большая|Обычная/ }),
  ).not.toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Добавить к блюду' })).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Добавить добавку «Сметана»' }))
  fireEvent.click(screen.getByRole('button', { name: 'Увеличить количество' }))
  fireEvent.click(screen.getByRole('button', { name: /Добавить в корзину/ }))

  expect(useCartStore.getState().lines[0]).toMatchObject({
    productId: 'borscht',
    variant: '',
    removedIngredients: [],
    extras: [{ name: 'Сметана', quantity: 1 }],
    quantity: 2,
  })
  expect(useCartStore.getState().isOpen).toBe(false)
  expect(onClose).toHaveBeenCalledOnce()
})

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import { useCartStore } from '../../../cart'
import type { DialogItem } from '../../model/dialogContent'
import { ProductDialog } from './ProductDialog'
import { CatalogProvider } from '../../api/CatalogProvider'
import { publishSiteUpdate } from '../../../../shared/lib/siteUpdates'

const request = vi.hoisted(() => vi.fn())
vi.mock('../../../auth/api/authApi', () => ({ apiRequest: request }))

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})

test('удаление открытого блюда блокирует добавление в корзину', async () => {
  useCartStore.getState().clear()
  let products = [{ ...item, _id: item.id, available: true, priceKopecks: 36000 }]
  request.mockImplementation(async () => ({
    categories: [{ id: 'soups', title: 'Супы', subtitle: '', products }],
    newArrivalIds: [],
  }))
  render(
    <CatalogProvider>
      <ProductDialog item={item} onClose={() => {}} />
    </CatalogProvider>,
  )
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /Добавить в корзину/ })).toBeEnabled(),
  )
  products = []
  act(() => publishSiteUpdate('catalog'))
  await waitFor(() => expect(screen.getByRole('button', { name: /Нет в наличии/ })).toBeDisabled())
  fireEvent.click(screen.getByRole('button', { name: /Нет в наличии/ }))
  expect(useCartStore.getState().lines).toHaveLength(0)
})

test('количество добавок ограничено 99 и блюдо переживает восстановление', async () => {
  useCartStore.getState().clear()
  render(<ProductDialog item={item} onClose={() => {}} />)
  const add = screen.getByRole('button', { name: 'Добавить добавку «Сметана»' })
  for (let count = 0; count < 100; count++) fireEvent.click(add)
  expect(add).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: /Добавить в корзину/ }))
  await useCartStore.persist.rehydrate()
  expect(useCartStore.getState().lines[0]?.extras).toEqual([{ name: 'Сметана', quantity: 99 }])
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

test('товар без фото и напиток без объёма получают подходящие подписи', () => {
  render(<ProductDialog item={{ ...item, measure: 'мл', calories: 100 }} onClose={() => {}} />)
  expect(screen.getByText('Фото пока нет')).toBeInTheDocument()
  expect(screen.queryByText('СОУС К БЛЮДУ')).not.toBeInTheDocument()
  expect(screen.getByText(/Объём уточняется · 100 ккал/)).toBeInTheDocument()
  expect(screen.queryByText('Пищевая ценность уточняется')).not.toBeInTheDocument()
  expect(screen.getByText(/Заказ с добавками пока недоступен/)).toBeInTheDocument()
})

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

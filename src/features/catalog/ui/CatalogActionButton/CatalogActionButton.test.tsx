import { render, screen } from '@testing-library/react'
import { useCartStore } from '../../../cart'
import { CatalogActionButton } from './CatalogActionButton'

beforeEach(() => useCartStore.setState({ lines: [], isOpen: false }))

test('недоступное блюдо нельзя добавить в корзину', () => {
  render(
    <CatalogActionButton item={{ id: 'borscht', name: 'Борщ', priceRub: 360, available: false }} />,
  )
  expect(screen.getByRole('button', { name: 'Нет в наличии' })).toBeDisabled()
  expect(useCartStore.getState().lines).toHaveLength(0)
})

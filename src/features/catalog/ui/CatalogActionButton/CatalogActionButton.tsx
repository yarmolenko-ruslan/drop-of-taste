import { addOneToCart, useCartStore } from '../../../cart'
import styles from './CatalogActionButton.module.css'

type CatalogActionButtonProps = {
  item: {
    id: string
    name: string
    image?: string
    priceRub: number | null
    available?: boolean
    action?: 'add' | 'choose'
  }
  onChoose?: () => void
}

export function CatalogActionButton({ item, onChoose }: CatalogActionButtonProps) {
  const line = useCartStore((state) =>
    state.lines.find(
      (entry) =>
        entry.productId === item.id &&
        entry.variant === '' &&
        entry.removedIngredients.length === 0 &&
        entry.extras.length === 0,
    ),
  )
  const changeQuantity = useCartStore((state) => state.changeQuantity)

  if (line) {
    return (
      <span className={styles.stepper} role="group" aria-label={`В корзине: ${item.name}`}>
        <button
          type="button"
          aria-label={`Убрать «${item.name}» из корзины`}
          onClick={() => changeQuantity(line.key, -1)}
        >
          −
        </button>
        <span aria-live="polite">{line.quantity}</span>
        <button
          type="button"
          aria-label={`Добавить «${item.name}» в корзину`}
          disabled={line.quantity >= 99 || item.available === false}
          onClick={() => changeQuantity(line.key, 1)}
        >
          +
        </button>
      </span>
    )
  }

  if (item.action === 'choose' && onChoose)
    return (
      <button
        className={styles.action}
        type="button"
        disabled={item.available === false}
        onClick={onChoose}
      >
        {item.available === false ? 'Нет в наличии' : 'Выбрать'}
      </button>
    )

  return (
    <button
      className={styles.action}
      type="button"
      disabled={item.available === false}
      onClick={() => addOneToCart(item)}
    >
      {item.available === false ? 'Нет в наличии' : 'В корзину'}
    </button>
  )
}

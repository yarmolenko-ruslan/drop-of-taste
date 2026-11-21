import { memo } from 'react'
import { formatCartPrice, MAX_CART_QUANTITY, type CartLine } from '../../model/cartStore'
import { Spinner } from '../../../../shared/ui/Spinner/Spinner'
import styles from './CartDrawer.module.css'

export function CartPrice({ value, calculating }: { value: number | null; calculating: boolean }) {
  if (value !== null) return formatCartPrice(value)
  return calculating ? (
    <span className={styles.priceLoader}>
      <Spinner size={16} label="Рассчитываем стоимость" />
    </span>
  ) : (
    '—'
  )
}

export const CartLineItem = memo(function CartLineItem({
  line,
  totalRub,
  calculating,
  busy,
  onChangeQuantity,
}: {
  line: CartLine
  totalRub: number | null
  calculating: boolean
  busy: boolean
  onChangeQuantity: (key: string, difference: number) => void
}) {
  return (
    <article className={styles.line}>
      <div className={styles.lineImage}>
        {line.image ? <img src={line.image} alt="" /> : <span aria-hidden="true">◉</span>}
      </div>
      <div className={styles.lineInfo}>
        <h4>{line.name}</h4>
        {line.variant && <span>{line.variant}</span>}
        {line.removedIngredients.length > 0 && (
          <span>Без: {line.removedIngredients.join(', ')}</span>
        )}
        {line.extras.length > 0 && (
          <span>
            Добавки: {line.extras.map(({ name, quantity }) => `${name} × ${quantity}`).join(', ')}
          </span>
        )}
        <strong>
          <CartPrice value={totalRub} calculating={calculating} />
        </strong>
      </div>
      <div className={styles.counter} aria-label={`Количество «${line.name}»`}>
        <button
          type="button"
          aria-label={`Уменьшить количество «${line.name}»`}
          disabled={busy}
          onClick={() => onChangeQuantity(line.key, -1)}
        >
          −
        </button>
        <span>{line.quantity}</span>
        <button
          type="button"
          aria-label={`Увеличить количество «${line.name}»`}
          disabled={line.quantity >= MAX_CART_QUANTITY || busy}
          onClick={() => onChangeQuantity(line.key, 1)}
        >
          +
        </button>
      </div>
    </article>
  )
})

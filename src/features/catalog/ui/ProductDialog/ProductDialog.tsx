import { useState } from 'react'
import { Dialog } from '../../../../shared/ui/Dialog/Dialog'
import { useCartStore } from '../../../cart'
import type { DialogItem } from '../../model/dialogContent'
import type { ProductBadge } from '../../model/product'
import styles from './ProductDialog.module.css'
import { useCatalogItem } from '../../api/CatalogProvider'

const badgeLabels: Record<ProductBadge, string> = {
  new: 'НОВИНКА',
  lenten: 'ПОСТНОЕ',
  hit: 'ХИТ',
  spicy: 'ОСТРОЕ',
  discount: 'СКИДКА',
}

type ProductDialogProps = {
  item: DialogItem
  onClose: () => void
}

export function ProductDialog({ item: inputItem, onClose }: ProductDialogProps) {
  const live = useCatalogItem(inputItem.id)
  const item = live
    ? { ...inputItem, ...live, id: live._id, priceRub: live.priceKopecks / 100 }
    : inputItem
  const addToCart = useCartStore((state) => state.add)
  const [extras, setExtras] = useState<Record<string, number>>({})
  const [quantity, setQuantity] = useState(1)
  const price =
    item.priceRub === null
      ? 'Цена уточняется'
      : `${(item.priceRub * quantity).toLocaleString('ru-RU')} ₽`
  const titleId = `dialog-title-${item.id}`

  function changeExtra(name: string, difference: number) {
    setExtras((current) => ({ ...current, [name]: Math.max(0, (current[name] ?? 0) + difference) }))
  }

  return (
    <Dialog titleId={titleId} onClose={onClose} className={styles.dialog}>
      <div className={styles.layout}>
        <div className={styles.visual}>
          {item.image ? (
            <img src={item.image} alt={item.imageAlt ?? item.name} />
          ) : (
            <div className={styles.sauceVisual} aria-label={`Соус «${item.name}»`}>
              <span aria-hidden="true">◉</span>
              <span>СОУС К БЛЮДУ</span>
            </div>
          )}
          {item.badges.length > 0 && (
            <div className={styles.badges}>
              {item.badges.map((badge) => (
                <span className={`${styles.badge} ${styles[badge]}`} key={badge}>
                  {badgeLabels[badge]}
                </span>
              ))}
            </div>
          )}
          <div className={styles.nutrition}>Пищевая ценность уточняется</div>
        </div>
        <div className={styles.right}>
          <div className={styles.details}>
            <h2 id={titleId}>{item.name}</h2>
            <p className={styles.meta}>
              {item.amount ? `${item.amount} ${item.measure}` : 'Вес уточняется'} ·{' '}
              {item.calories ? `${item.calories} ккал` : 'Калорийность уточняется'}
            </p>
            <p className={styles.description}>{item.description}</p>

            {item.ingredients.length > 0 && (
              <section className={styles.ingredients} aria-label="Состав блюда">
                <h3>Состав</h3>
                <p className={styles.ingredientList}>{item.ingredients.join(', ')}</p>
              </section>
            )}
            {item.allergenNote && <p className={styles.allergenNote}>{item.allergenNote}</p>}

            {item.extras.length > 0 && (
              <section className={styles.extras} aria-label="Добавки к блюду">
                <h3>Добавить к блюду</h3>
                <div className={styles.extraList}>
                  {item.extras.map((extra) => (
                    <div className={styles.extra} key={extra}>
                      <span>{extra}</span>
                      <strong>Цена уточняется</strong>
                      <div className={styles.extraCounter}>
                        <button
                          type="button"
                          aria-label={`Убрать добавку «${extra}»`}
                          disabled={!extras[extra]}
                          onClick={() => changeExtra(extra, -1)}
                        >
                          −
                        </button>
                        <span>{extras[extra] ?? 0}</span>
                        <button
                          type="button"
                          aria-label={`Добавить добавку «${extra}»`}
                          onClick={() => changeExtra(extra, 1)}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
          <div className={styles.footer}>
            <div className={styles.quantity} aria-label="Количество порций">
              <button
                type="button"
                aria-label="Уменьшить количество"
                disabled={quantity === 1}
                onClick={() => setQuantity((value) => Math.max(1, value - 1))}
              >
                −
              </button>
              <span aria-live="polite">{quantity}</span>
              <button
                type="button"
                aria-label="Увеличить количество"
                onClick={() => setQuantity((value) => value + 1)}
              >
                +
              </button>
            </div>
            <button
              className={styles.addButton}
              type="button"
              onClick={() => {
                addToCart(item, { variant: '', removedIngredients: [], extras, quantity })
                onClose()
              }}
            >
              Добавить в корзину <strong>{price}</strong>
            </button>
          </div>
        </div>
      </div>
    </Dialog>
  )
}

import { useState } from 'react'
import { Dialog } from '../../../../shared/ui/Dialog/Dialog'
import { useCartStore } from '../../../cart'
import type { DialogItem } from '../../model/dialogContent'
import type { ProductBadge } from '../../model/product'
import styles from './ProductDialog.module.css'

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

export function ProductDialog({ item, onClose }: ProductDialogProps) {
  const addToCart = useCartStore((state) => state.add)
  const openCart = useCartStore((state) => state.open)
  const [variant, setVariant] = useState(item.variants[0] ?? '')
  const [removed, setRemoved] = useState<readonly string[]>([])
  const [extras, setExtras] = useState<Record<string, number>>({})
  const [quantity, setQuantity] = useState(1)
  const price = item.priceRub === null ? '000' : (item.priceRub * quantity).toLocaleString('ru-RU')
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
          <div className={styles.nutrition}>
            <strong>ПИЩЕВАЯ ЦЕННОСТЬ НА 100 {item.measure}</strong>
            <div>
              <span>
                Белки <b>0,0</b>
              </span>
              <span>
                Жиры <b>0,0</b>
              </span>
              <span>
                Углев. <b>0,0</b>
              </span>
              <span>
                Ккал <b>{item.calories ?? '000'}</b>
              </span>
            </div>
          </div>
        </div>
        <div className={styles.right}>
          <div className={styles.details}>
            <h2 id={titleId}>{item.name}</h2>
            <p className={styles.meta}>
              {item.amount ?? '000'} {item.measure} · {item.calories ?? '000'} ккал
            </p>
            <p className={styles.description}>{item.description}</p>

            {item.variants.length > 1 && (
              <div className={styles.variants} role="group" aria-label="Размер порции">
                {item.variants.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={option === variant ? styles.selectedVariant : ''}
                    aria-pressed={option === variant}
                    onClick={() => setVariant(option)}
                  >
                    {item.measure === 'мл' ? option : `${option} · 000 ${item.measure}`}
                  </button>
                ))}
              </div>
            )}

            {item.ingredients.length > 0 && (
              <section className={styles.ingredients} aria-label="Состав блюда">
                <h3>Убрать ингредиенты</h3>
                <div className={styles.chips}>
                  {item.ingredients.map((ingredient) => {
                    const isRemoved = removed.includes(ingredient)
                    return (
                      <button
                        key={ingredient}
                        type="button"
                        aria-pressed={isRemoved}
                        className={isRemoved ? styles.removedChip : ''}
                        onClick={() =>
                          setRemoved(
                            isRemoved
                              ? removed.filter((value) => value !== ingredient)
                              : [...removed, ingredient],
                          )
                        }
                      >
                        {ingredient} <span aria-hidden="true">{isRemoved ? '+' : '×'}</span>
                      </button>
                    )
                  })}
                </div>
                {item.allergenNote && <p>{item.allergenNote}</p>}
              </section>
            )}

            {item.extras.length > 0 && (
              <section className={styles.extras} aria-label="Добавки к блюду">
                <h3>Добавить к блюду</h3>
                <div className={styles.extraList}>
                  {item.extras.map((extra) => (
                    <div className={styles.extra} key={extra}>
                      <span>{extra}</span>
                      <strong>+000 ₽</strong>
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
                addToCart(item, { variant, removedIngredients: removed, extras, quantity })
                onClose()
                openCart()
              }}
            >
              Добавить в корзину <strong>{price} ₽</strong>
            </button>
          </div>
        </div>
      </div>
    </Dialog>
  )
}

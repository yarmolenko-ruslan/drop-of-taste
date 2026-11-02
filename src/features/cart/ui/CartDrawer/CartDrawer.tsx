import { useState } from 'react'
import { Dialog } from '../../../../shared/ui/Dialog/Dialog'
import { cartCount, cartTotal, formatCartPrice, useCartStore } from '../../index'
import styles from './CartDrawer.module.css'

export type CartRecommendation = {
  id: string
  name: string
  image: string
  priceRub: number | null
}

type CartDrawerProps = {
  fulfillmentLabel?: string
  onChooseFulfillment: () => void
  recommendations: readonly CartRecommendation[]
  onAddRecommendation: (item: CartRecommendation) => void
}

export function CartDrawer({
  fulfillmentLabel,
  onChooseFulfillment,
  recommendations,
  onAddRecommendation,
}: CartDrawerProps) {
  const lines = useCartStore((state) => state.lines)
  const close = useCartStore((state) => state.close)
  const clear = useCartStore((state) => state.clear)
  const changeQuantity = useCartStore((state) => state.changeQuantity)
  const [promo, setPromo] = useState('')
  const [notice, setNotice] = useState('')
  const count = cartCount(lines)
  const total = cartTotal(lines)

  return (
    <Dialog titleId="cart-title" onClose={close} placement="right" className={styles.dialog}>
      <div className={styles.drawer}>
        <header className={styles.header}>
          <div>
            <span className={styles.eyebrow}>ВАШ ЗАКАЗ</span>
            <h2 id="cart-title">Корзина</h2>
          </div>
          {count > 0 && (
            <button className={styles.clear} type="button" onClick={clear}>
              Очистить
            </button>
          )}
        </header>

        {count === 0 ? (
          <div className={styles.empty}>
            <div className={styles.emptyIcon} aria-hidden="true">
              ◌
            </div>
            <h3>Пока тут пусто</h3>
            <p>Выберите что-нибудь вкусное из нашего меню — блюда появятся здесь.</p>
            <button type="button" onClick={close}>
              Вернуться в меню
            </button>
          </div>
        ) : (
          <>
            <div className={styles.scrollArea}>
              <section className={styles.card} aria-label="Товары в корзине">
                <h3>
                  {count}{' '}
                  {count % 10 === 1 && count % 100 !== 11
                    ? 'товар'
                    : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14)
                      ? 'товара'
                      : 'товаров'}{' '}
                  на {formatCartPrice(total)}
                </h3>
                <div className={styles.lines}>
                  {lines.map((line) => (
                    <article className={styles.line} key={line.key}>
                      <div className={styles.lineImage}>
                        {line.image ? (
                          <img src={line.image} alt="" />
                        ) : (
                          <span aria-hidden="true">◉</span>
                        )}
                      </div>
                      <div className={styles.lineInfo}>
                        <h4>{line.name}</h4>
                        {line.variant && <span>{line.variant}</span>}
                        {line.removedIngredients.length > 0 && (
                          <span>Без: {line.removedIngredients.join(', ')}</span>
                        )}
                        {line.extras.length > 0 && (
                          <span>
                            Добавки:{' '}
                            {line.extras
                              .map(({ name, quantity }) => `${name} × ${quantity}`)
                              .join(', ')}
                          </span>
                        )}
                        <strong>
                          {formatCartPrice(
                            line.unitPriceRub === null ? null : line.unitPriceRub * line.quantity,
                          )}
                        </strong>
                      </div>
                      <div className={styles.counter} aria-label={`Количество «${line.name}»`}>
                        <button
                          type="button"
                          aria-label={`Уменьшить количество «${line.name}»`}
                          onClick={() => changeQuantity(line.key, -1)}
                        >
                          −
                        </button>
                        <span>{line.quantity}</span>
                        <button
                          type="button"
                          aria-label={`Увеличить количество «${line.name}»`}
                          onClick={() => changeQuantity(line.key, 1)}
                        >
                          +
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>

              <button className={styles.fulfillment} type="button" onClick={onChooseFulfillment}>
                <span>
                  <strong>{fulfillmentLabel ? 'Способ получения' : 'Куда доставить заказ?'}</strong>
                  <small>{fulfillmentLabel ?? 'Выберите доставку или самовывоз'}</small>
                </span>
                <span aria-hidden="true">→</span>
              </button>

              <form
                className={styles.promo}
                onSubmit={(event) => {
                  event.preventDefault()
                  setNotice('Проверка промокода появится после подключения заказов.')
                }}
              >
                <label htmlFor="cart-promo">Промокод</label>
                <div>
                  <input
                    id="cart-promo"
                    placeholder="Введите промокод"
                    value={promo}
                    onChange={(event) => setPromo(event.target.value)}
                  />
                  <button type="submit" aria-label="Применить промокод" disabled={!promo.trim()}>
                    →
                  </button>
                </div>
              </form>

              {recommendations.length > 0 && (
                <section
                  className={styles.recommendations}
                  aria-labelledby="cart-recommendations-title"
                >
                  <h3 id="cart-recommendations-title">Добавить к заказу</h3>
                  <div className={styles.recommendationList}>
                    {recommendations.map((item) => (
                      <article className={styles.recommendation} key={item.id}>
                        <img src={item.image} alt="" loading="lazy" />
                        <div>
                          <strong>{item.name}</strong>
                          <span>{formatCartPrice(item.priceRub)}</span>
                          <button type="button" onClick={() => onAddRecommendation(item)}>
                            В корзину
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              )}
              <div className={styles.summary}>
                <span>Итого</span>
                <strong>{formatCartPrice(total)}</strong>
              </div>
              {notice && (
                <p className={styles.notice} role="status">
                  {notice}
                </p>
              )}
            </div>
            <footer className={styles.footer}>
              <button
                type="button"
                onClick={() =>
                  fulfillmentLabel
                    ? setNotice('Оформление заказа подключим на следующем этапе.')
                    : onChooseFulfillment()
                }
              >
                {fulfillmentLabel ? 'Оформить заказ' : 'Выбрать способ получения'}{' '}
                <span>{formatCartPrice(total)}</span>
              </button>
            </footer>
          </>
        )}
      </div>
    </Dialog>
  )
}

import { useState } from 'react'
import { Dialog } from '../../../../shared/ui/Dialog/Dialog'
import { cartCount, cartTotal, formatCartPrice, useCartStore } from '../../index'
import styles from './CartDrawer.module.css'
import { ApiError, apiRequest, type AuthUser } from '../../../auth/api/authApi'
import type { FulfillmentSelection } from '../../../fulfillment/ui/FulfillmentDialog/FulfillmentDialog'
import { useCatalog } from '../../../catalog/api/CatalogProvider'

type Quote = {
  lines: {
    productId: string
    name: string
    quantity: number
    unitPriceKopecks: number
    lineTotalKopecks: number
  }[]
  subtotalKopecks: number
  discountKopecks: number
  deliveryKopecks: number
  totalKopecks: number
  eligible: boolean
  testMode: boolean
}

export type CartRecommendation = {
  id: string
  name: string
  image: string
  priceRub: number | null
}

type CartDrawerProps = {
  fulfillmentLabel?: string
  fulfillment?: FulfillmentSelection
  user?: AuthUser
  onRequireAuth?: () => void
  onOrderCreated?: () => void
  onChooseFulfillment: () => void
  recommendations: readonly CartRecommendation[]
  onAddRecommendation: (item: CartRecommendation) => void
}

export function CartDrawer({
  fulfillmentLabel,
  fulfillment,
  user,
  onRequireAuth,
  onOrderCreated,
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
  const [quote, setQuote] = useState<Quote | null>(null)
  const [quoteSignature, setQuoteSignature] = useState('')
  const [busy, setBusy] = useState(false)
  const [orderKey, setOrderKey] = useState<string | null>(null)
  const catalog = useCatalog()
  const count = cartCount(lines)
  const total = cartTotal(lines)
  const signature = JSON.stringify([lines, fulfillment])
  const currentQuote = quoteSignature === signature ? quote : null
  const pricedRecommendations = recommendations.map((item) => {
    const live = catalog?.data?.categories
      .flatMap((category) => category.products)
      .find((product) => product._id === item.id)
    return live
      ? {
          ...item,
          name: live.name,
          image: live.image ?? item.image,
          priceRub: live.priceKopecks / 100,
        }
      : item
  })

  function orderInput() {
    if (!fulfillment) throw new Error('Выберите способ получения')
    if (lines.some((line) => line.extras.length > 0))
      throw new Error('Цены добавок уточняются. Уберите добавки для тестового заказа.')
    return {
      lines: lines.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        extras: line.extras,
      })),
      fulfillment:
        fulfillment.mode === 'delivery'
          ? { mode: 'delivery', label: fulfillment.label, details: fulfillment.details }
          : { mode: 'pickup', label: fulfillment.label },
    }
  }

  async function prepareQuote() {
    try {
      setBusy(true)
      setNotice('')
      const result = await apiRequest<Quote>('/checkout/quote', {
        method: 'POST',
        body: JSON.stringify(orderInput()),
      })
      setQuote(result)
      setQuoteSignature(signature)
      setOrderKey(crypto.randomUUID())
    } catch (failure) {
      setNotice(failure instanceof Error ? failure.message : 'Не удалось рассчитать заказ')
    } finally {
      setBusy(false)
    }
  }

  async function createOrder() {
    if (!currentQuote || !orderKey) return
    if (!user) {
      onRequireAuth?.()
      return
    }
    try {
      setBusy(true)
      setNotice('')
      const result = await apiRequest<{ order: { _id: string } }>('/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': orderKey },
        body: JSON.stringify({ ...orderInput(), expectedTotalKopecks: currentQuote.totalKopecks }),
      })
      clear()
      setQuote(null)
      setOrderKey(null)
      setNotice(`Тестовый заказ ${result.order._id.slice(0, 8)} сохранён. В кафе он не передаётся.`)
      onOrderCreated?.()
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === 'PRICE_CHANGED') setQuote(null)
      if (failure instanceof ApiError && failure.code === 'UNAUTHENTICATED') onRequireAuth?.()
      setNotice(failure instanceof Error ? failure.message : 'Не удалось сохранить тестовый заказ')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog titleId="cart-title" onClose={close} placement="right" className={styles.dialog}>
      <div className={styles.drawer}>
        <header className={styles.header}>
          <div>
            <span className={styles.eyebrow}>ВАШ ЗАКАЗ</span>
            <h2 id="cart-title">Корзина</h2>
          </div>
          {count > 0 && (
            <button
              className={styles.clear}
              type="button"
              onClick={() => {
                clear()
                setQuote(null)
              }}
            >
              Очистить
            </button>
          )}
        </header>

        {count === 0 ? (
          <div className={styles.empty}>
            <div className={styles.emptyIcon} aria-hidden="true">
              <svg viewBox="0 0 64 64" fill="none">
                <path d="M9 23h46l-5 29H14L9 23Z" />
                <path d="M21 23v-7a11 11 0 0 1 22 0v7M23 33v10m9-10v10m9-10v10" />
              </svg>
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
                    {pricedRecommendations
                      .filter((item) => !lines.some((line) => line.productId === item.id))
                      .map((item) => (
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
              {currentQuote && (
                <div className={styles.summary} role="status">
                  <div>
                    Тестовый расчёт. Блюда:{' '}
                    {(currentQuote.subtotalKopecks / 100).toLocaleString('ru-RU')} ₽; скидка:{' '}
                    {(currentQuote.discountKopecks / 100).toLocaleString('ru-RU')} ₽; доставка:{' '}
                    {(currentQuote.deliveryKopecks / 100).toLocaleString('ru-RU')} ₽.
                  </div>
                  <strong>
                    Итого: {(currentQuote.totalKopecks / 100).toLocaleString('ru-RU')} ₽
                  </strong>
                  <p>Тестовый режим — заказ не передаётся в кафе.</p>
                  {!currentQuote.eligible && <p>Для доставки нужно минимум 500 ₽ блюд.</p>}
                </div>
              )}
              {notice && (
                <p className={styles.notice} role="status">
                  {notice}
                </p>
              )}
            </div>
            <footer className={styles.footer}>
              <button
                type="button"
                disabled={busy || (currentQuote !== null && !currentQuote.eligible)}
                onClick={() => {
                  if (!fulfillment) onChooseFulfillment()
                  else if (!currentQuote) void prepareQuote()
                  else void createOrder()
                }}
              >
                {!fulfillment
                  ? 'Выбрать способ получения'
                  : currentQuote
                    ? 'Подтвердить тестовый заказ'
                    : 'Рассчитать заказ'}{' '}
                <span>
                  {formatCartPrice(currentQuote ? currentQuote.totalKopecks / 100 : total)}
                </span>
              </button>
            </footer>
          </>
        )}
      </div>
    </Dialog>
  )
}

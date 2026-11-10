import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Dialog } from '../../../../shared/ui/Dialog/Dialog'
import { cartCount, cartTotal, formatCartPrice, useCartStore, type CartLine } from '../../index'
import styles from './CartDrawer.module.css'
import { ApiError, apiRequest, type AuthUser } from '../../../auth/api/authApi'
import type { FulfillmentSelection } from '../../../fulfillment/ui/FulfillmentDialog/FulfillmentDialog'
import { useCatalog } from '../../../catalog/api/CatalogProvider'
import { formatCompactAddress } from '../../../../shared/lib/formatCompactAddress'
import { useSiteContent } from '../../../site-content/SiteContentProvider'

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
  promoCode?: string
  promoDiscountKopecks: number
  deliveryKopecks: number
  totalKopecks: number
  eligible: boolean
  testMode: boolean
}

function orderInput(lines: readonly CartLine[], fulfillment: FulfillmentSelection, code: string) {
  if (lines.some((line) => line.extras.length > 0))
    throw new Error('Цены добавок уточняются. Уберите добавки из заказа.')
  return {
    lines: lines.map((line) => ({
      productId: line.productId,
      quantity: line.quantity,
      extras: line.extras,
    })),
    fulfillment:
      fulfillment.mode === 'delivery'
        ? { mode: 'delivery' as const, label: fulfillment.label, details: fulfillment.details }
        : { mode: 'pickup' as const, label: fulfillment.label },
    ...(code && { promoCode: code }),
  }
}

export type CartRecommendation = {
  id: string
  name: string
  image: string
  priceRub: number | null
}

type CartDrawerProps = {
  fulfillment: FulfillmentSelection
  /** Адрес доставки, выбранный в личном кабинете; подставляется при переключении на «Доставка». */
  savedDelivery: FulfillmentSelection | null
  user?: AuthUser
  onRequireAuth?: () => void
  onOrderCreated?: () => void
  onFulfillmentChange: (selection: FulfillmentSelection) => void
  /** Переход в кабинет на вкладку адресов; вызывается из «Изменить» и при первом выборе доставки без адреса. */
  onGoToAddresses: () => void
  recommendations: readonly CartRecommendation[]
  onAddRecommendation: (item: CartRecommendation) => void
}

export function CartDrawer({
  fulfillment,
  savedDelivery,
  user,
  onRequireAuth,
  onOrderCreated,
  onFulfillmentChange,
  onGoToAddresses,
  recommendations,
  onAddRecommendation,
}: CartDrawerProps) {
  const siteContent = useSiteContent()
  const cafeAddress = siteContent.address
  const lines = useCartStore((state) => state.lines)
  const close = useCartStore((state) => state.close)
  const clear = useCartStore((state) => state.clear)
  const changeQuantity = useCartStore((state) => state.changeQuantity)
  const [promo, setPromo] = useState('')
  const [appliedPromo, setAppliedPromo] = useState('')
  const [notice, setNotice] = useState('')
  const [quote, setQuote] = useState<Quote | null>(null)
  const [quoteSignature, setQuoteSignature] = useState('')
  const [busy, setBusy] = useState(false)
  const [calculating, setCalculating] = useState(false)
  const [quoteFailed, setQuoteFailed] = useState(false)
  const [quoteAttempt, setQuoteAttempt] = useState(0)
  const [orderKey, setOrderKey] = useState<string | null>(null)
  const [testPaymentEnabled, setTestPaymentEnabled] = useState(false)
  const [orderIdToPay, setOrderIdToPay] = useState<string | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const catalog = useCatalog()
  const count = cartCount(lines)
  const total = cartTotal(lines)
  const hasUnpricedExtras = lines.some((line) => line.extras.length > 0)
  const signature = JSON.stringify([lines, fulfillment, appliedPromo, siteContent.promotions])
  const latestSignature = useRef(signature)
  useLayoutEffect(() => {
    latestSignature.current = signature
  }, [signature])
  const currentQuote = quoteSignature === signature ? quote : null
  const displayedSubtotal = currentQuote ? currentQuote.subtotalKopecks / 100 : total
  const pricedRecommendations = recommendations.flatMap((item) => {
    const live = catalog?.itemsById.get(item.id)
    return live?.available
      ? [
          {
            ...item,
            name: live.name,
            image: live.image ?? item.image,
            priceRub: live.priceKopecks / 100,
          },
        ]
      : []
  })
  const visibleRecommendations = pricedRecommendations.filter(
    (item) => !lines.some((line) => line.productId === item.id),
  )

  function chooseDelivery() {
    if (fulfillment.mode === 'delivery') return
    if (savedDelivery) onFulfillmentChange(savedDelivery)
    else if (!user) onRequireAuth?.()
    else onGoToAddresses()
  }

  useEffect(() => {
    if (!lines.length || busy || currentQuote) return
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setCalculating(true)
      setQuoteFailed(false)
      setNotice((previous) => (previous.startsWith('Заказ ') ? previous : ''))
      setOrderIdToPay(null)
      try {
        const input = orderInput(lines, fulfillment, appliedPromo)
        const [config, result] = await Promise.all([
          apiRequest<{ testPaymentEnabled: boolean }>('/checkout/config', {
            signal: controller.signal,
          }),
          apiRequest<Quote>('/checkout/quote', {
            method: 'POST',
            body: JSON.stringify(input),
            signal: controller.signal,
          }),
        ])
        if (controller.signal.aborted || !mounted.current) return
        setTestPaymentEnabled(config.testPaymentEnabled)
        setQuote(result)
        setQuoteSignature(signature)
        setOrderKey(crypto.randomUUID())
        if (appliedPromo)
          setNotice(
            result.promoDiscountKopecks > 0
              ? `Бонус-код ${appliedPromo} применён`
              : 'На этот заказ действует более выгодная скидка за самовывоз',
          )
      } catch (failure) {
        if (controller.signal.aborted || !mounted.current) return
        setQuote(null)
        setQuoteSignature('')
        setOrderKey(null)
        setQuoteFailed(true)
        setNotice(failure instanceof Error ? failure.message : 'Не удалось рассчитать заказ')
      } finally {
        if (!controller.signal.aborted && mounted.current) setCalculating(false)
      }
    }, 180)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [lines, fulfillment, appliedPromo, signature, busy, currentQuote, quoteAttempt])

  async function startPayment(id: string) {
    const result = await apiRequest<{ status: string; confirmationUrl?: string }>(
      `/orders/${encodeURIComponent(id)}/pay`,
      { method: 'POST', headers: { 'X-Account-Id': user!.id } },
    )
    if (result.confirmationUrl) {
      window.location.assign(result.confirmationUrl)
      return
    }
    if (result.status === 'succeeded') {
      clear()
      setNotice(`Оплата заказа ${id.slice(0, 8)} прошла успешно.`)
      setOrderIdToPay(null)
      return
    }
    setNotice('Платёж не открылся. Проверьте статус заказа в личном кабинете.')
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
      const submittedSignature = signature
      const result = orderIdToPay
        ? { order: { _id: orderIdToPay } }
        : await apiRequest<{ order: { _id: string } }>('/orders', {
            method: 'POST',
            headers: { 'Idempotency-Key': orderKey, 'X-Account-Id': user.id },
            body: JSON.stringify({
              ...orderInput(lines, fulfillment, appliedPromo),
              expectedTotalKopecks: currentQuote.totalKopecks,
            }),
          })
      if (!mounted.current) return
      if (currentQuote.totalKopecks === 0) {
        await apiRequest(`/orders/${encodeURIComponent(result.order._id)}/complete`, {
          method: 'POST',
          headers: { 'X-Account-Id': user.id },
        })
        const cartChanged = latestSignature.current !== submittedSignature
        if (!cartChanged) clear()
        setQuote(null)
        setOrderKey(null)
        setOrderIdToPay(null)
        setNotice(
          `Заказ ${result.order._id.slice(0, 8)} оформлен без оплаты.` +
            (cartChanged ? ' Корзина изменилась во время оформления — проверьте её.' : ''),
        )
        onOrderCreated?.()
        return
      }
      if (testPaymentEnabled) {
        const cartChanged = latestSignature.current !== submittedSignature
        if (cartChanged) {
          setOrderIdToPay(null)
          setNotice(
            `Заказ ${result.order._id.slice(0, 8)} сохранён. Корзина или способ получения изменились во время оформления; оплатить сохранённый заказ можно в личном кабинете.`,
          )
          onOrderCreated?.()
          return
        }
        setOrderIdToPay(result.order._id)
        setNotice('Заказ сохранён. Открываем страницу оплаты ЮKassa…')
        if (!orderIdToPay) onOrderCreated?.()
        await startPayment(result.order._id)
        return
      }
      const cartChanged = latestSignature.current !== submittedSignature
      if (!cartChanged) clear()
      setQuote(null)
      setOrderKey(null)
      setNotice(
        `Заказ ${result.order._id.slice(0, 8)} сохранён.` +
          (cartChanged
            ? ' Корзина или способ получения менялись во время сохранения — проверьте заказ.'
            : ''),
      )
      onOrderCreated?.()
    } catch (failure) {
      if (!mounted.current) return
      if (
        failure instanceof ApiError &&
        (failure.code === 'PRICE_CHANGED' ||
          failure.code === 'ADDRESS_CHANGED' ||
          failure.code === 'INVALID_PROMO_CODE' ||
          failure.code === 'PROMO_NOT_APPLICABLE')
      )
        setQuote(null)
      if (
        failure instanceof ApiError &&
        ['INVALID_PROMO_CODE', 'PROMO_NOT_APPLICABLE'].includes(failure.code)
      )
        setAppliedPromo('')
      if (failure instanceof ApiError && failure.code === 'UNAUTHENTICATED') onRequireAuth?.()
      setNotice(failure instanceof Error ? failure.message : 'Не удалось сохранить заказ')
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  return (
    <Dialog
      titleId="cart-title"
      onClose={busy ? () => undefined : close}
      placement="right"
      className={styles.dialog}
    >
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
              disabled={busy}
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
            {notice && (
              <p className={styles.notice} role="status">
                {notice}
              </p>
            )}
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
                  на {currentQuote ? '' : 'примерно '}
                  {formatCartPrice(displayedSubtotal)}
                </h3>
                <div className={styles.lines}>
                  {lines.map((line, index) => (
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
                            currentQuote
                              ? currentQuote.lines[index]
                                ? currentQuote.lines[index].lineTotalKopecks / 100
                                : null
                              : line.unitPriceRub === null
                                ? null
                                : line.unitPriceRub * line.quantity,
                          )}
                        </strong>
                      </div>
                      <div className={styles.counter} aria-label={`Количество «${line.name}»`}>
                        <button
                          type="button"
                          aria-label={`Уменьшить количество «${line.name}»`}
                          disabled={busy}
                          onClick={() => changeQuantity(line.key, -1)}
                        >
                          −
                        </button>
                        <span>{line.quantity}</span>
                        <button
                          type="button"
                          aria-label={`Увеличить количество «${line.name}»`}
                          disabled={line.quantity >= 99 || busy}
                          onClick={() => changeQuantity(line.key, 1)}
                        >
                          +
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>

              <section className={styles.fulfillment} aria-label="Способ получения">
                <div className={styles.fulfillmentTabs} role="group" aria-label="Способ получения">
                  <button
                    type="button"
                    aria-pressed={fulfillment.mode === 'pickup'}
                    disabled={busy}
                    onClick={() => onFulfillmentChange({ mode: 'pickup', label: cafeAddress })}
                  >
                    Самовывоз
                  </button>
                  <button
                    type="button"
                    aria-pressed={fulfillment.mode === 'delivery'}
                    disabled={busy}
                    onClick={chooseDelivery}
                  >
                    Доставка
                  </button>
                </div>
                <div className={styles.fulfillmentDetail}>
                  {fulfillment.mode === 'pickup' ? (
                    <span>{fulfillment.label}</span>
                  ) : (
                    <>
                      <span title={fulfillment.label}>
                        {fulfillment.details
                          ? formatCompactAddress(fulfillment.details)
                          : fulfillment.label}
                      </span>
                      <button
                        type="button"
                        className={styles.changeAddress}
                        disabled={busy}
                        onClick={onGoToAddresses}
                      >
                        Изменить
                      </button>
                    </>
                  )}
                </div>
              </section>

              <form
                className={styles.promo}
                onSubmit={(event) => {
                  event.preventDefault()
                  const code = promo.trim().toUpperCase()
                  setAppliedPromo(code)
                }}
              >
                <label htmlFor="cart-promo">Бонус-код</label>
                <div>
                  <input
                    id="cart-promo"
                    placeholder="Введите бонус-код"
                    value={promo}
                    onChange={(event) => setPromo(event.target.value)}
                  />
                  <button
                    type="submit"
                    aria-label="Применить бонус-код"
                    disabled={busy || (!promo.trim() && !appliedPromo)}
                  >
                    →
                  </button>
                </div>
                {appliedPromo && (
                  <small>
                    Код: {appliedPromo}. Очистите поле и нажмите стрелку, чтобы убрать его.
                  </small>
                )}
              </form>

              {visibleRecommendations.length > 0 && (
                <section
                  className={styles.recommendations}
                  aria-labelledby="cart-recommendations-title"
                >
                  <h3 id="cart-recommendations-title">Добавить к заказу</h3>
                  <div className={styles.recommendationList}>
                    {visibleRecommendations.map((item) => (
                      <article className={styles.recommendation} key={item.id}>
                        {item.image ? (
                          <img src={item.image} alt="" loading="lazy" />
                        ) : (
                          <span className={styles.recommendationPlaceholder} aria-hidden="true">
                            ◉
                          </span>
                        )}
                        <div>
                          <strong>{item.name}</strong>
                          <span>{formatCartPrice(item.priceRub)}</span>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => onAddRecommendation(item)}
                          >
                            В корзину
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              )}
              <div className={styles.summary}>
                <span>{currentQuote ? 'Стоимость блюд' : 'Стоимость блюд (примерно)'}</span>
                <strong>{formatCartPrice(displayedSubtotal)}</strong>
              </div>
              {currentQuote && (
                <div className={styles.summary} role="status">
                  <div>
                    Ваш заказ. Блюда: {(currentQuote.subtotalKopecks / 100).toLocaleString('ru-RU')}{' '}
                    ₽; скидка: {(currentQuote.discountKopecks / 100).toLocaleString('ru-RU')} ₽;
                    {currentQuote.promoCode && (
                      <>
                        {' '}
                        бонус-код {currentQuote.promoCode}:{' '}
                        {(currentQuote.promoDiscountKopecks / 100).toLocaleString('ru-RU')} ₽;
                      </>
                    )}
                    доставка: {(currentQuote.deliveryKopecks / 100).toLocaleString('ru-RU')} ₽.
                  </div>
                  <strong>
                    Итого: {(currentQuote.totalKopecks / 100).toLocaleString('ru-RU')} ₽
                  </strong>
                  {!currentQuote.eligible && <p>Для доставки нужно минимум 500 ₽ блюд.</p>}
                  {fulfillment.mode === 'delivery' && (
                    <small>
                      Минимум 500 ₽ и бесплатная доставка от 1 500 ₽ считаются по стоимости блюд до
                      скидок.
                    </small>
                  )}
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
                disabled={
                  busy ||
                  calculating ||
                  hasUnpricedExtras ||
                  (!currentQuote && !quoteFailed) ||
                  (currentQuote !== null && !currentQuote.eligible)
                }
                onClick={() => {
                  if (currentQuote) void createOrder()
                  else setQuoteAttempt((value) => value + 1)
                }}
              >
                {currentQuote
                  ? currentQuote.totalKopecks === 0
                    ? 'Оформить заказ'
                    : testPaymentEnabled
                      ? orderIdToPay
                        ? 'Повторить переход к оплате'
                        : 'Перейти к оплате'
                      : 'Оформить заказ'
                  : hasUnpricedExtras
                    ? 'Уберите добавки'
                    : calculating
                      ? 'Рассчитываем…'
                      : quoteFailed
                        ? 'Повторить расчёт'
                        : 'Ожидаем расчёт…'}{' '}
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

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Dialog } from '../../../../shared/ui/Dialog/Dialog'
import { cartCount, formatCartPrice, useCartStore, type CartLine } from '../../index'
import styles from './CartDrawer.module.css'
import { ApiError, apiRequest, type AuthUser } from '../../../auth/api/authApi'
import type { FulfillmentSelection } from '../../../fulfillment/ui/FulfillmentDialog/FulfillmentDialog'
import { useCatalog } from '../../../catalog/api/CatalogProvider'
import { formatCompactAddress } from '../../../../shared/lib/formatCompactAddress'
import { useSiteContent } from '../../../site-content/SiteContentProvider'
import { Spinner } from '../../../../shared/ui/Spinner/Spinner'
import { LoadingState } from '../../../../shared/ui/LoadingState/LoadingState'
import { BIRTHDAY_CLAIM_RELEASED_EVENT } from '../../../../../shared/birthday'

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
  birthdayDiscountKopecks?: number
  deliveryKopecks: number
  adjustments?: { label: string; amountKopecks: number }[]
  totalKopecks: number
  eligible: boolean
  minimumOrderMessage?: string
  deliveryTerms?: string
  testMode: boolean
}

function orderInput(
  lines: readonly CartLine[],
  fulfillment: FulfillmentSelection,
  code: string,
  birthdayDiscount = false,
) {
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
    ...(birthdayDiscount && { birthdayDiscount: true }),
  }
}

export type CartRecommendation = {
  id: string
  name: string
  image: string
  priceRub: number | null
}

type CartDrawerProps = {
  isOpen?: boolean
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
  isOpen = true,
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
  const birthdayPromotion = siteContent.promotions.find(
    (item) => item.id === 'birthday' && item.enabled !== false,
  )
  const accountId = user?.id
  const cafeAddress = siteContent.address
  const lines = useCartStore((state) => state.lines)
  const close = useCartStore((state) => state.close)
  const clear = useCartStore((state) => state.clear)
  const changeQuantity = useCartStore((state) => state.changeQuantity)
  const [promo, setPromo] = useState('')
  const [appliedPromo, setAppliedPromo] = useState('')
  const [birthdaySelected, setBirthdaySelected] = useState(false)
  const [birthdayAccountId, setBirthdayAccountId] = useState<string | null>(null)
  const [birthdayAvailability, setBirthdayAvailability] = useState({ accountId, available: false })
  const birthdayAvailable = Boolean(
    accountId &&
    birthdayAvailability.accountId === accountId &&
    birthdayAvailability.available &&
    birthdayPromotion,
  )
  const birthdaySelectedForAccount =
    birthdaySelected && birthdayAccountId === accountId && birthdayAvailable
  const [notice, setNotice] = useState('')
  const [quote, setQuote] = useState<Quote | null>(null)
  const [quoteSignature, setQuoteSignature] = useState('')
  // Цены блюд не меняются при выборе скидки; итог принимаем только из нового расчёта.
  const [pricedItems, setPricedItems] = useState<{ key: string; quote: Quote } | null>(null)
  const itemsKey = JSON.stringify(lines)
  const [busy, setBusy] = useState(false)
  const [calculation, setCalculation] = useState({ key: '', pending: true })
  const cachedSignature = useRef('')
  const [quoteFailed, setQuoteFailed] = useState(false)
  const [quoteAttempt, setQuoteAttempt] = useState(0)
  const [orderKey, setOrderKey] = useState<string | null>(null)
  const [testPaymentEnabled, setTestPaymentEnabled] = useState(false)
  const [orderIdToPay, setOrderIdToPay] = useState<string | null>(null)
  // При потере ответа заказ мог сохраниться: повторяем тот же ключ без нового расчёта.
  const [submittedInputSignature, setSubmittedInputSignature] = useState('')
  const mounted = useRef(true)
  useEffect(() => {
    const refreshAfterCancellation = () => {
      cachedSignature.current = ''
      setQuote(null)
      setOrderIdToPay(null)
      setSubmittedInputSignature('')
      setOrderKey(null)
      setQuoteAttempt((value) => value + 1)
    }
    window.addEventListener(BIRTHDAY_CLAIM_RELEASED_EVENT, refreshAfterCancellation)
    return () => window.removeEventListener(BIRTHDAY_CLAIM_RELEASED_EVENT, refreshAfterCancellation)
  }, [])
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const catalog = useCatalog()
  const count = cartCount(lines)
  const hasUnpricedExtras = lines.some((line) => line.extras.length > 0)
  useEffect(() => {
    if (!isOpen || !count || busy) return
    const refresh = () => setQuoteAttempt((value) => value + 1)
    const timer = window.setInterval(refresh, 60_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [isOpen, count, busy])
  const signature = JSON.stringify([
    lines,
    fulfillment,
    appliedPromo,
    birthdaySelectedForAccount,
    accountId,
    siteContent.promotions,
  ])
  const requestBody = hasUnpricedExtras
    ? null
    : JSON.stringify(orderInput(lines, fulfillment, appliedPromo, birthdaySelectedForAccount))
  const savedOrderMatches = Boolean(
    (orderIdToPay || submittedInputSignature === signature) &&
    quoteSignature === signature &&
    quote,
  )
  const calculationKey = JSON.stringify([signature, isOpen, quoteAttempt, savedOrderMatches])
  // Invalidate checkout synchronously, including the first frame after reopening.
  if (calculation.key !== calculationKey) {
    setCalculation({ key: calculationKey, pending: count > 0 && !savedOrderMatches })
  }
  const calculating = calculation.key !== calculationKey || calculation.pending
  const latestSignature = useRef(signature)
  const previousAccount = useRef(accountId)
  useEffect(() => {
    if (previousAccount.current === accountId) return
    previousAccount.current = accountId
    setBirthdaySelected(false)
    setBirthdayAccountId(null)
    setSubmittedInputSignature('')
    setOrderIdToPay(null)
  }, [accountId])
  useLayoutEffect(() => {
    latestSignature.current = signature
  }, [signature])
  const currentQuote = quoteSignature === signature ? quote : null
  const itemQuote = pricedItems?.key === itemsKey ? pricedItems.quote : null
  const displayedSubtotal = itemQuote ? itemQuote.subtotalKopecks / 100 : null
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
    if (!count) {
      cachedSignature.current = ''
      return
    }
    if (busy || !calculating || (!isOpen && cachedSignature.current === signature)) return
    const controller = new AbortController()
    const timer = window.setTimeout(
      async () => {
        setCalculation({ key: calculationKey, pending: true })
        setQuoteFailed(false)
        setNotice((previous) => (previous.startsWith('Заказ ') ? previous : ''))
        if (cachedSignature.current !== signature) {
          setOrderIdToPay(null)
          setSubmittedInputSignature('')
          setOrderKey(null)
        }
        try {
          if (!requestBody) throw new Error('Цены добавок уточняются. Уберите добавки из заказа.')
          const [configResponse, quoteResponse] = await Promise.allSettled([
            apiRequest<{ testPaymentEnabled: boolean; birthdayAvailable?: boolean }>(
              '/checkout/config',
              {
                ...(accountId && { headers: { 'X-Account-Id': accountId } }),
                signal: controller.signal,
              },
            ).then((config) => {
              if (!controller.signal.aborted && mounted.current) {
                setBirthdayAvailability({ accountId, available: config.birthdayAvailable === true })
              }
              return config
            }),
            apiRequest<Quote>('/checkout/quote', {
              method: 'POST',
              ...(accountId && { headers: { 'X-Account-Id': accountId } }),
              body: requestBody,
              signal: controller.signal,
            }),
          ])
          if (controller.signal.aborted || !mounted.current) return
          if (configResponse.status === 'rejected') throw configResponse.reason
          if (quoteResponse.status === 'rejected') throw quoteResponse.reason
          const config = configResponse.value
          const result = quoteResponse.value
          setTestPaymentEnabled(config.testPaymentEnabled)
          setQuote(result)
          setPricedItems({ key: itemsKey, quote: result })
          setQuoteSignature(signature)
          const sameQuote = cachedSignature.current === signature
          const nextOrderKey = crypto.randomUUID()
          setOrderKey((previous) => (sameQuote && previous ? previous : nextOrderKey))
          cachedSignature.current = signature
          if (appliedPromo)
            setNotice(
              result.promoDiscountKopecks > 0
                ? `Бонус-код ${appliedPromo} применён`
                : 'Бонус-код не применён: на этот заказ действует более выгодная скидка.',
            )
        } catch (failure) {
          if (controller.signal.aborted || !mounted.current) return
          setQuote(null)
          setQuoteSignature('')
          if (failure instanceof ApiError && failure.code === 'BIRTHDAY_OUTSIDE_WINDOW') {
            setBirthdaySelected(false)
            setBirthdayAvailability({ accountId, available: false })
            setNotice('')
          } else {
            setQuoteFailed(true)
            setNotice(failure instanceof Error ? failure.message : 'Не удалось рассчитать заказ')
          }
        } finally {
          if (!controller.signal.aborted && mounted.current)
            setCalculation({ key: calculationKey, pending: false })
        }
      },
      isOpen ? 0 : 180,
    )
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [
    count,
    requestBody,
    signature,
    busy,
    isOpen,
    calculationKey,
    appliedPromo,
    calculating,
    accountId,
    itemsKey,
  ])

  async function startPayment(id: string, submittedSignature: string) {
    const result = await apiRequest<{ status: string; confirmationUrl?: string }>(
      `/orders/${encodeURIComponent(id)}/pay`,
      { method: 'POST', headers: { 'X-Account-Id': user!.id } },
    )
    if (!mounted.current) return
    const cartChanged = latestSignature.current !== submittedSignature
    if (result.status === 'succeeded') useCartStore.getState().finishPayment(id, user!.id)
    if (cartChanged) {
      setNotice(
        'Корзина изменилась во время оплаты. Проверьте статус сохранённого заказа в личном кабинете.',
      )
      return
    }
    if (result.confirmationUrl) {
      window.location.assign(result.confirmationUrl)
      return
    }
    if (result.status === 'succeeded') {
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
      setSubmittedInputSignature(submittedSignature)
      const result = orderIdToPay
        ? { order: { _id: orderIdToPay } }
        : await apiRequest<{ order: { _id: string } }>('/orders', {
            method: 'POST',
            headers: { 'Idempotency-Key': orderKey, 'X-Account-Id': user.id },
            body: JSON.stringify({
              ...orderInput(lines, fulfillment, appliedPromo, birthdaySelectedForAccount),
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
        useCartStore.getState().rememberPayment(result.order._id, user.id)
        setNotice('Заказ сохранён. Открываем страницу оплаты ЮKassa…')
        if (!orderIdToPay) onOrderCreated?.()
        await startPayment(result.order._id, submittedSignature)
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
      const uncertain =
        failure instanceof ApiError &&
        (failure.status >= 500 || ['NETWORK_ERROR', 'TIMEOUT'].includes(failure.code))
      if (!uncertain) setSubmittedInputSignature('')
      if (failure instanceof ApiError && failure.code === 'ORDER_CANCELED') {
        const payment = useCartStore.getState().pendingPayment
        if (payment && payment.accountId === user.id)
          useCartStore.getState().forgetPayment(payment.orderId, user.id)
        setOrderIdToPay(null)
        setOrderKey(null)
        setQuote(null)
        cachedSignature.current = ''
        setQuoteAttempt((value) => value + 1)
        onOrderCreated?.()
      }
      if (
        failure instanceof ApiError &&
        (failure.code === 'PRICE_CHANGED' ||
          failure.code === 'ADDRESS_CHANGED' ||
          failure.code === 'INVALID_PROMO_CODE' ||
          failure.code === 'PROMO_NOT_APPLICABLE' ||
          failure.code.startsWith('BIRTHDAY_'))
      ) {
        setQuote(null)
        cachedSignature.current = ''
        setQuoteAttempt((value) => value + 1)
      }
      if (
        failure instanceof ApiError &&
        ['INVALID_PROMO_CODE', 'PROMO_NOT_APPLICABLE'].includes(failure.code)
      )
        setAppliedPromo('')
      if (failure instanceof ApiError && failure.code === 'UNAUTHENTICATED') onRequireAuth?.()
      if (failure instanceof ApiError && failure.code === 'BIRTHDAY_OUTSIDE_WINDOW') {
        setBirthdaySelected(false)
        setBirthdayAvailability({ accountId, available: false })
        setNotice('')
      } else {
        setNotice(failure instanceof Error ? failure.message : 'Не удалось сохранить заказ')
      }
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  if (!isOpen) return null

  const price = (value: number | null) =>
    value === null ? (
      calculating ? (
        <span className={styles.priceLoader}>
          <Spinner size={16} label="Рассчитываем стоимость" />
        </span>
      ) : (
        '—'
      )
    ) : (
      formatCartPrice(value)
    )

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
                  на {price(displayedSubtotal)}
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
                          {price(
                            itemQuote?.lines[index]
                              ? itemQuote.lines[index].lineTotalKopecks / 100
                              : null,
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

              {birthdayAvailable && birthdayPromotion && (
                <div className={styles.birthdayOffer}>
                  <label className={styles.birthdayOfferControl}>
                    <input
                      type="checkbox"
                      checked={birthdaySelectedForAccount}
                      disabled={busy}
                      onChange={(event) => {
                        if (!event.target.checked) {
                          setBirthdaySelected(false)
                          return
                        }
                        if (!user) {
                          onRequireAuth?.()
                          setNotice('Войдите и укажите дату рождения в личном кабинете.')
                          return
                        }
                        setBirthdayAccountId(user.id)
                        setBirthdaySelected(true)
                      }}
                    />
                    <span className={styles.birthdayOfferIcon} aria-hidden="true">
                      ✦
                    </span>
                    <span className={styles.birthdayOfferTitle}>Скидка ко дню рождения</span>
                    {birthdayPromotion.discountPercent != null && (
                      <span className={styles.birthdayOfferBadge}>
                        −{birthdayPromotion.discountPercent}%
                      </span>
                    )}
                  </label>
                  <p>
                    Вы можете воспользоваться скидкой на товары за 3 дня до дня рождения и 3 дня
                    после.
                  </p>
                  <a href="/account/profile">Дата рождения в профиле →</a>
                </div>
              )}

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
              {currentQuote && (
                <div className={styles.priceBreakdown} role="status" aria-label="Расчёт заказа">
                  <div className={styles.priceRow}>
                    <span>Стоимость блюд</span>
                    <span>{formatCartPrice(currentQuote.subtotalKopecks / 100)}</span>
                  </div>
                  {currentQuote.adjustments?.map((adjustment) => (
                    <div className={styles.priceRow} key={adjustment.label}>
                      <span>{adjustment.label}</span>
                      <span>
                        {adjustment.amountKopecks < 0
                          ? '−'
                          : adjustment.amountKopecks > 0
                            ? '+'
                            : ''}
                        {formatCartPrice(Math.abs(adjustment.amountKopecks) / 100)}
                      </span>
                    </div>
                  ))}
                  <div className={`${styles.priceRow} ${styles.priceTotal}`}>
                    <strong>Итого</strong>
                    <strong>{formatCartPrice(currentQuote.totalKopecks / 100)}</strong>
                  </div>
                  {!currentQuote.eligible && currentQuote.minimumOrderMessage && (
                    <p>{currentQuote.minimumOrderMessage}</p>
                  )}
                  {fulfillment.mode === 'delivery' && currentQuote.deliveryTerms && (
                    <small>{currentQuote.deliveryTerms}</small>
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
              {busy && !orderIdToPay && <LoadingState compact label="Оформляем заказ…" />}
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
                    : quoteFailed && !calculating
                      ? 'Повторить расчёт'
                      : 'Оформить заказ'}{' '}
                <span>{price(currentQuote ? currentQuote.totalKopecks / 100 : null)}</span>
              </button>
            </footer>
          </>
        )}
      </div>
    </Dialog>
  )
}

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Dialog } from '../../../../shared/ui/Dialog/Dialog'
import { cartCount, formatCartPrice, useCartStore, type CartLine } from '../../index'
import styles from './CartDrawer.module.css'
import { ApiError, apiRequest, type AuthUser } from '../../../auth/api/authApi'
import type { FulfillmentSelection } from '../../../fulfillment/ui/FulfillmentDialog/FulfillmentDialog'
import { useCatalog } from '../../../catalog/api/CatalogProvider'
import { formatCompactAddress } from '../../../../shared/lib/formatCompactAddress'
import { useSiteContent } from '../../../site-content/SiteContentProvider'
import { CartLineItem, CartPrice } from './CartLineItem'
import { LoadingState } from '../../../../shared/ui/LoadingState/LoadingState'
import { BIRTHDAY_CLAIM_RELEASED_EVENT } from '../../../../../shared/birthday'
import { usePromotionActive } from '../../../../shared/lib/usePromotionActive'
import type { CartQuote as Quote } from '../../model/checkoutAttempt'
import { checkoutSchema } from '../../../../../shared/validation/checkout'

function orderInput(
  lines: readonly CartLine[],
  fulfillment: FulfillmentSelection,
  code: string,
  birthdayDiscount = false,
) {
  if (lines.some((line) => line.extras.length > 0))
    throw new Error('Заказ с добавками пока недоступен. Добавьте блюдо заново без добавок.')
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

type CartRecommendation = {
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
  const birthdayPromotion = siteContent.promotions.find((item) => item.id === 'birthday')
  const birthdayInPeriod = usePromotionActive(birthdayPromotion)
  const birthdayPromotionActive = Boolean(
    birthdayInPeriod && birthdayPromotion && (birthdayPromotion.discountPercent ?? 10) > 0,
  )
  const accountId = user?.id
  const cafeAddress = siteContent.address
  const lines = useCartStore((state) => state.lines)
  const cartRevision = useCartStore((state) => state.revision)
  const checkoutAttempt = useCartStore((state) => state.checkoutAttempt)
  const savedAttempt =
    checkoutAttempt &&
    checkoutAttempt.accountId === accountId &&
    checkoutAttempt.revision === cartRevision
      ? checkoutAttempt
      : null
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
    birthdayPromotionActive,
  )
  const birthdaySelectedForAccount =
    birthdaySelected && birthdayAccountId === accountId && birthdayAvailable
  const [notice, setNotice] = useState('')
  const noticeRef = useRef<HTMLParagraphElement>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const area = scrollAreaRef.current
    const message = noticeRef.current
    if (!isOpen || !notice || !area || !message) return
    const bounds = area.getBoundingClientRect()
    if (!bounds.height) return
    const messageBounds = message.getBoundingClientRect()
    const top = bounds.top + 12
    const bottom = bounds.bottom - 12
    if (messageBounds.height > bottom - top || messageBounds.top < top) {
      area.scrollTop += messageBounds.top - top
    } else if (messageBounds.bottom > bottom) {
      area.scrollTop += messageBounds.bottom - bottom
    }
  }, [notice, isOpen])
  const [quote, setQuote] = useState<Quote | null>(null)
  const [quoteSignature, setQuoteSignature] = useState('')
  // Последний ответ остаётся на экране, пока сервер проверяет изменённую корзину.
  // Оформление использует только currentQuote с совпадающей подписью.
  const [pricedItems, setPricedItems] = useState<{
    key: string
    lines: readonly CartLine[]
    quote: Quote
    accountId: string | undefined
  } | null>(null)
  const itemsKey = JSON.stringify(lines)
  const [busy, setBusy] = useState(false)
  const [calculation, setCalculation] = useState({ key: '', pending: true })
  const cachedSignature = useRef('')
  const [quoteFailed, setQuoteFailed] = useState(false)
  const [quoteAttempt, setQuoteAttempt] = useState(0)
  const [orderKey, setOrderKey] = useState<string | null>(null)
  const [testPaymentEnabled, setTestPaymentEnabled] = useState(false)
  const [orderIdToPay, setOrderIdToPay] = useState<string | null>(null)
  const paymentEnabled = savedAttempt?.paymentEnabled ?? testPaymentEnabled
  const displayedFulfillment = savedAttempt?.input.fulfillment ?? fulfillment
  // При потере ответа заказ мог сохраниться: повторяем тот же ключ без нового расчёта.
  const [submittedInputSignature, setSubmittedInputSignature] = useState('')
  const mounted = useRef(true)
  useEffect(() => {
    const refreshAfterCancellation = () => {
      const attempt = useCartStore.getState().checkoutAttempt
      if (attempt) useCartStore.getState().forgetCheckout(attempt.key)
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
  const [restoredKey, setRestoredKey] = useState<string | null>(null)
  if (savedAttempt && restoredKey !== savedAttempt.key) {
    setRestoredKey(savedAttempt.key)
    setPromo(savedAttempt.input.promoCode ?? '')
    setAppliedPromo(savedAttempt.input.promoCode ?? '')
    setBirthdaySelected(Boolean(savedAttempt.input.birthdayDiscount))
    setBirthdayAccountId(savedAttempt.accountId)
    if (savedAttempt.input.birthdayDiscount)
      setBirthdayAvailability({ accountId: savedAttempt.accountId, available: true })
  }
  const restoredFulfillmentKey = useRef<string | null>(null)
  useEffect(() => {
    if (!savedAttempt || restoredFulfillmentKey.current === savedAttempt.key) return
    restoredFulfillmentKey.current = savedAttempt.key
    onFulfillmentChange(savedAttempt.input.fulfillment)
  }, [savedAttempt, onFulfillmentChange])
  const count = cartCount(lines)
  if (!count && pricedItems !== null) setPricedItems(null)
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
    cartRevision,
    lines,
    fulfillment,
    appliedPromo,
    birthdaySelectedForAccount,
    accountId,
    siteContent.promotions,
    siteContent.settings.delivery,
  ])
  const requestBody = hasUnpricedExtras
    ? null
    : JSON.stringify(orderInput(lines, fulfillment, appliedPromo, birthdaySelectedForAccount))
  const savedOrderMatches = Boolean(
    savedAttempt ||
    ((orderIdToPay || submittedInputSignature === signature) &&
      quoteSignature === signature &&
      quote),
  )
  const calculationKey = JSON.stringify([signature, isOpen, quoteAttempt, savedOrderMatches])
  // Invalidate checkout synchronously, including the first frame after reopening.
  if (calculation.key !== calculationKey) {
    setCalculation({ key: calculationKey, pending: count > 0 && !savedOrderMatches })
  }
  const calculating = calculation.key !== calculationKey || calculation.pending
  const latestSignature = useRef(signature)
  const [previousAccount, setPreviousAccount] = useState(accountId)
  if (previousAccount !== accountId) {
    setPreviousAccount(accountId)
    if (!savedAttempt) {
      setBirthdaySelected(false)
      setBirthdayAccountId(null)
    }
    setSubmittedInputSignature('')
    setOrderIdToPay(null)
  }
  useLayoutEffect(() => {
    latestSignature.current = signature
  }, [signature])
  const currentQuote = savedAttempt?.quote ?? (quoteSignature === signature ? quote : null)
  const itemQuote = pricedItems?.key === itemsKey ? pricedItems.quote : null
  const displayQuote =
    currentQuote ?? (pricedItems && pricedItems.accountId === accountId ? pricedItems.quote : null)
  const cachedPrices = new Map(
    pricedItems?.lines.map((line, index) => [
      line.key,
      { line, price: pricedItems.quote.lines[index] },
    ]),
  )
  const lineTotals = lines.map((line) => {
    if (line.extras.length > 0) return null
    const cached = cachedPrices.get(line.key)
    const serverPrice = cached?.line.unitPriceRub === line.unitPriceRub ? cached?.price : null
    const unitPrice = serverPrice
      ? (serverPrice.unitPriceKopecks ?? serverPrice.lineTotalKopecks / serverPrice.quantity) / 100
      : line.unitPriceRub
    return unitPrice === null ? null : unitPrice * line.quantity
  })
  const displayedSubtotal = itemQuote
    ? itemQuote.subtotalKopecks / 100
    : lineTotals.every((total) => total !== null)
      ? lineTotals.reduce((sum, total) => sum + total, 0)
      : null
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
    if (displayedFulfillment.mode === 'delivery') return
    if (savedDelivery) {
      discardSavedCheckout()
      onFulfillmentChange(savedDelivery)
    } else if (!user) onRequireAuth?.()
    else onGoToAddresses()
  }

  function discardSavedCheckout() {
    if (savedAttempt) useCartStore.getState().forgetCheckout(savedAttempt.key)
    setOrderIdToPay(null)
    setSubmittedInputSignature('')
    setOrderKey(null)
    setQuote(null)
    cachedSignature.current = ''
    setQuoteAttempt((value) => value + 1)
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
        if (cachedSignature.current !== signature) {
          setOrderIdToPay(null)
          setSubmittedInputSignature('')
          setOrderKey(null)
        }
        try {
          if (!requestBody)
            throw new Error('Заказ с добавками пока недоступен. Добавьте блюдо заново без добавок.')
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
          setPricedItems({ key: itemsKey, lines, quote: result, accountId })
          setQuoteSignature(signature)
          const sameQuote = cachedSignature.current === signature
          const nextOrderKey = crypto.randomUUID()
          setOrderKey((previous) => (sameQuote && previous ? previous : nextOrderKey))
          cachedSignature.current = signature
          if (appliedPromo)
            setNotice(
              result.promoDiscountKopecks > 0
                ? `Бонус-код ${appliedPromo} применён`
                : 'Бонус-код не изменил сумму заказа. Проверьте скидки в расчёте.',
            )
          else setNotice((previous) => (previous.startsWith('Заказ ') ? previous : ''))
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
    lines,
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
    if (!currentQuote || (!orderKey && !savedAttempt)) return
    if (!user) {
      onRequireAuth?.()
      return
    }
    try {
      setBusy(true)
      setNotice('')
      const submittedSignature = signature
      setSubmittedInputSignature(submittedSignature)
      const attempt = savedAttempt ?? {
        key: orderKey!,
        accountId: user.id,
        revision: cartRevision,
        input: checkoutSchema.parse(
          orderInput(lines, fulfillment, appliedPromo, birthdaySelectedForAccount),
        ),
        quote: currentQuote,
        paymentEnabled,
      }
      useCartStore.getState().rememberCheckout(attempt)
      const savedOrderId = attempt.orderId ?? orderIdToPay
      const result = savedOrderId
        ? { order: { _id: savedOrderId } }
        : await apiRequest<{ order: { _id: string } }>('/orders', {
            method: 'POST',
            headers: { 'Idempotency-Key': attempt.key, 'X-Account-Id': user.id },
            body: JSON.stringify({
              ...attempt.input,
              expectedTotalKopecks: attempt.quote.totalKopecks,
            }),
          })
      useCartStore.getState().rememberCheckout({ ...attempt, orderId: result.order._id })
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
      if (paymentEnabled) {
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
      const saved = useCartStore.getState().checkoutAttempt
      if (
        !uncertain &&
        !saved?.orderId &&
        saved &&
        !(failure instanceof ApiError && failure.code === 'UNAUTHENTICATED')
      )
        useCartStore.getState().forgetCheckout(saved.key)
      if (failure instanceof ApiError && failure.code === 'ORDER_CANCELED') {
        if (saved) useCartStore.getState().forgetCheckout(saved.key)
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

  const price = (value: number | null) => (
    <CartPrice value={value} calculating={value === null && calculating} />
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
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6m4-6v6" />
              </svg>
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
            <div className={styles.scrollArea} ref={scrollAreaRef}>
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
                    <CartLineItem
                      key={line.key}
                      line={line}
                      totalRub={lineTotals[index] ?? null}
                      calculating={lineTotals[index] === null && calculating}
                      busy={busy}
                      onChangeQuantity={changeQuantity}
                    />
                  ))}
                </div>
              </section>

              <section className={styles.fulfillment} aria-label="Способ получения">
                <div className={styles.fulfillmentTabs} role="group" aria-label="Способ получения">
                  <button
                    type="button"
                    aria-pressed={displayedFulfillment.mode === 'pickup'}
                    disabled={busy}
                    onClick={() => {
                      if (
                        displayedFulfillment.mode === 'pickup' &&
                        displayedFulfillment.label === cafeAddress
                      )
                        return
                      discardSavedCheckout()
                      onFulfillmentChange({ mode: 'pickup', label: cafeAddress })
                    }}
                  >
                    Самовывоз
                  </button>
                  <button
                    type="button"
                    aria-pressed={displayedFulfillment.mode === 'delivery'}
                    disabled={busy}
                    onClick={chooseDelivery}
                  >
                    Доставка
                  </button>
                </div>
                <div className={styles.fulfillmentDetail}>
                  {displayedFulfillment.mode === 'pickup' ? (
                    <span>{displayedFulfillment.label}</span>
                  ) : (
                    <>
                      <span title={displayedFulfillment.label}>
                        {displayedFulfillment.details
                          ? formatCompactAddress(displayedFulfillment.details)
                          : displayedFulfillment.label}
                      </span>
                      <button
                        type="button"
                        className={styles.changeAddress}
                        disabled={busy}
                        onClick={() => {
                          discardSavedCheckout()
                          onGoToAddresses()
                        }}
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
                  if (code !== appliedPromo) discardSavedCheckout()
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
                        discardSavedCheckout()
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
              {displayQuote && (
                <div
                  className={styles.priceBreakdown}
                  role="status"
                  aria-label="Расчёт заказа"
                  aria-busy={calculating}
                >
                  <div className={styles.priceRow}>
                    <span>Стоимость блюд</span>
                    <span>{formatCartPrice(displayQuote.subtotalKopecks / 100)}</span>
                  </div>
                  {displayQuote.adjustments?.map((adjustment) => (
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
                    <strong>{formatCartPrice(displayQuote.totalKopecks / 100)}</strong>
                  </div>
                  {!displayQuote.eligible && displayQuote.minimumOrderMessage && (
                    <p>{displayQuote.minimumOrderMessage}</p>
                  )}
                  {displayedFulfillment.mode === 'delivery' && displayQuote.deliveryTerms && (
                    <small>{displayQuote.deliveryTerms}</small>
                  )}
                </div>
              )}
              {notice && (
                <p className={styles.notice} role="status" ref={noticeRef}>
                  {notice}
                </p>
              )}
            </div>
            <footer className={styles.footer}>
              {displayQuote?.testMode && (
                <p>Тестовый заказ: деньги не списываются, заказ не передаётся в кафе.</p>
              )}
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
                {hasUnpricedExtras
                  ? 'Уберите добавки'
                  : quoteFailed && !currentQuote && !calculating
                    ? 'Повторить расчёт'
                    : displayQuote
                      ? displayQuote.totalKopecks === 0
                        ? 'Оформить заказ'
                        : paymentEnabled
                          ? (savedAttempt?.orderId ?? orderIdToPay)
                            ? 'Повторить переход к оплате'
                            : 'Перейти к оплате'
                          : 'Оформить заказ'
                      : 'Оформить заказ'}{' '}
                <span>{price(displayQuote ? displayQuote.totalKopecks / 100 : null)}</span>
              </button>
            </footer>
          </>
        )}
      </div>
    </Dialog>
  )
}

import { useEffect, useState } from 'react'
import type { Order } from './orders'
import styles from './AccountScreen.module.css'

const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })

function PaymentCountdown({ expiresAt }: { expiresAt: string }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [])
  const remaining = Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000))
  const time = `${Math.floor(remaining / 60)
    .toString()
    .padStart(2, '0')}:${(remaining % 60).toString().padStart(2, '0')}`
  return (
    <p className={styles.paymentCountdown}>
      {remaining > 0 ? (
        <>
          Осталось на оплату: <strong role="timer">{time}</strong>. Затем заказ будет отменён.
        </>
      ) : (
        'Время оплаты истекло. Обновляем статус заказа…'
      )}
    </p>
  )
}

export function OrderDetailsCard({
  order,
  onRepeat,
  paymentEnabled,
  onPay,
  onCancel,
  onCompleteFree,
}: {
  order: Order
  onRepeat: (order: Order) => void
  paymentEnabled?: boolean
  onPay?: (id: string) => void
  onCancel?: (id: string) => void
  onCompleteFree?: (id: string) => void
}) {
  const completed = order.status === 'completed'
  const noPaymentRequired = order.quote.totalKopecks === 0
  const pickup = order.input.fulfillment.mode === 'pickup'
  const paid = order.paymentStatus === 'succeeded'
  const canceled = Boolean(order.canceledAt) || order.paymentStatus === 'canceled'
  const waitingForPayment =
    canceled || (paymentEnabled && !noPaymentRequired && !paid && !completed)
  const stage = order.fulfillmentStatus ?? (order.status === 'completed' ? 'completed' : 'new')
  const stages = ['new', 'preparing', 'delivering', 'completed'] as const
  const labels = ['Обработка заявки', 'Приготовление', 'Доставка', 'Завершён']
  const current = stages.indexOf(stage)
  const steps: { label: string; detail: string; state: 'done' | 'current' | 'waiting' }[] =
    labels.map((label, index) => ({
      label,
      detail: waitingForPayment
        ? index === 0
          ? canceled
            ? order.canceledAt
              ? 'Истекло время оплаты'
              : 'Оплата отменена'
            : 'Ожидает оплаты'
          : 'Ожидается'
        : index < current
          ? 'Готово'
          : index === current
            ? index === 3
              ? timeOf(order.fulfilledAt ?? order.completedAt ?? order.createdAt)
              : 'Сейчас'
            : 'Ожидается',
      state: waitingForPayment
        ? 'waiting'
        : index < current || (index === 3 && current === 3)
          ? 'done'
          : index === current
            ? 'current'
            : 'waiting',
    }))
  const badge = canceled ? 'Заказ отменён' : waitingForPayment ? 'Ожидает оплаты' : labels[current]
  return (
    <article className={styles.orderCard}>
      <header className={styles.orderHeader}>
        <strong>Заказ №{order._id.slice(0, 6).toUpperCase()}</strong>
        <span className={styles.orderBadge}>{badge}</span>
      </header>
      {waitingForPayment && !canceled && order.paymentExpiresAt && (
        <PaymentCountdown expiresAt={order.paymentExpiresAt} />
      )}
      <ol className={styles.orderSteps} aria-label="Этапы заказа">
        {steps.map((step, index) => (
          <li
            key={step.label}
            className={`${styles.orderStep} ${step.state === 'done' ? styles.orderStepDone : ''} ${step.state === 'current' ? styles.orderStepCurrent : ''}`}
            aria-current={step.state === 'current' ? 'step' : undefined}
          >
            <span className={styles.orderDot} aria-hidden="true">
              {step.state === 'done' ? '✓' : index + 1}
            </span>
            <span className={styles.orderStepLabel}>{step.label}</span>
            <span className={styles.orderStepSub}>{step.detail}</span>
          </li>
        ))}
      </ol>
      <div className={styles.orderTiles}>
        <div className={styles.orderTile}>
          <span>Получение</span>
          <strong>
            {pickup
              ? `Самовывоз · ${order.input.fulfillment.label}`
              : order.input.fulfillment.label}
          </strong>
        </div>
        <div className={styles.orderTile}>
          <span>Оплата</span>
          <strong>
            {noPaymentRequired
              ? 'Не требуется — заказ на 0 ₽'
              : paid
                ? 'Оплачено онлайн'
                : order.paymentStatus === 'pending' || order.paymentStatus === 'creating'
                  ? 'Ожидаем подтверждения'
                  : canceled
                    ? 'Платёж отменён'
                    : paymentEnabled
                      ? 'Не оплачен'
                      : 'Не указана'}
          </strong>
        </div>
      </div>
      <ul className={styles.orderLines}>
        {order.quote.lines.map((line) => (
          <li key={`${order._id}-${line.name}`}>
            <span>
              {line.name} × {line.quantity}
            </span>
            <span>{(line.lineTotalKopecks / 100).toLocaleString('ru-RU')} ₽</span>
          </li>
        ))}
        {order.quote.adjustments?.map((adjustment) => (
          <li key={adjustment.label}>
            <span>{adjustment.label}</span>
            <span>
              {adjustment.amountKopecks < 0 ? '−' : adjustment.amountKopecks > 0 ? '+' : ''}
              {(Math.abs(adjustment.amountKopecks) / 100).toLocaleString('ru-RU')} ₽
            </span>
          </li>
        ))}
        {!order.quote.adjustments && order.quote.discountKopecks > 0 && (
          <li>
            <span>Скидка самовывоза</span>
            <span>−{(order.quote.discountKopecks / 100).toLocaleString('ru-RU')} ₽</span>
          </li>
        )}
        {!order.quote.adjustments && (order.quote.promoDiscountKopecks ?? 0) > 0 && (
          <li>
            <span>Бонус-код {order.quote.promoCode}</span>
            <span>
              −{((order.quote.promoDiscountKopecks ?? 0) / 100).toLocaleString('ru-RU')} ₽
            </span>
          </li>
        )}
        {!order.quote.adjustments && order.quote.deliveryKopecks > 0 && (
          <li>
            <span>Доставка</span>
            <span>{(order.quote.deliveryKopecks / 100).toLocaleString('ru-RU')} ₽</span>
          </li>
        )}
      </ul>
      <p className={styles.orderTotal}>
        <span>Итого</span>
        <strong>{(order.quote.totalKopecks / 100).toLocaleString('ru-RU')} ₽</strong>
      </p>
      <div className={styles.orderActions}>
        {noPaymentRequired && !completed && !canceled && onCompleteFree && (
          <button
            type="button"
            className={styles.repeatButton}
            onClick={() => onCompleteFree(order._id)}
          >
            Завершить оформление
          </button>
        )}
        {paymentEnabled &&
          !noPaymentRequired &&
          !canceled &&
          onPay &&
          (!order.paymentStatus ||
            ['unpaid', 'error', 'creating', 'pending'].includes(order.paymentStatus)) && (
            <button type="button" className={styles.repeatButton} onClick={() => onPay(order._id)}>
              {order.paymentStatus === 'pending'
                ? 'Вернуться к оплате'
                : order.paymentStatus === 'creating' || order.paymentStatus === 'error'
                  ? 'Повторить попытку оплаты'
                  : 'Оплатить заказ'}
            </button>
          )}
        {(order.quote.birthdayDiscountKopecks ?? 0) > 0 &&
          onCancel &&
          !completed &&
          !canceled &&
          !paid &&
          (!order.paymentStatus || ['unpaid', 'pending'].includes(order.paymentStatus)) && (
            <button
              type="button"
              className={styles.repeatButton}
              onClick={() => onCancel(order._id)}
            >
              {order.paymentStatus === 'pending'
                ? 'Проверить отмену оплаты'
                : 'Отменить заказ и освободить скидку'}
            </button>
          )}
        <button type="button" className={styles.repeatButton} onClick={() => onRepeat(order)}>
          Повторить заказ
        </button>
      </div>
    </article>
  )
}

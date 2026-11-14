import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { apiRequest } from '../../features/auth/api/authApi'
import { useCartStore } from '../../features/cart'
import { LoadingState } from '../../shared/ui/LoadingState/LoadingState'

type PaymentStatus = 'unpaid' | 'creating' | 'error' | 'pending' | 'succeeded' | 'canceled'

export function PaymentReturnScreen() {
  const [params] = useSearchParams()
  const orderId = params.get('orderId')
  const [orderCanceled, setOrderCanceled] = useState(false)
  const [status, setStatus] = useState<PaymentStatus | null>(null)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [resuming, setResuming] = useState(false)

  const [trackedPayment] = useState(() => useCartStore.getState().pendingPayment)
  const paymentAccountId =
    trackedPayment?.orderId === orderId ? trackedPayment.accountId : undefined
  function finishPayment(status: PaymentStatus) {
    if (status === 'succeeded' && orderId && paymentAccountId)
      useCartStore.getState().finishPayment(orderId, paymentAccountId)
  }

  async function resumePayment() {
    if (!orderId) return
    try {
      setResuming(true)
      setError('')
      const result = await apiRequest<{ status: PaymentStatus; confirmationUrl?: string }>(
        `/orders/${encodeURIComponent(orderId)}/pay`,
        {
          method: 'POST',
          ...(paymentAccountId && { headers: { 'X-Account-Id': paymentAccountId } }),
        },
      )
      if (result.confirmationUrl) window.location.assign(result.confirmationUrl)
      else {
        finishPayment(result.status)
        setStatus(result.status)
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Не удалось продолжить оплату')
    } finally {
      setResuming(false)
    }
  }

  useEffect(() => {
    if (!orderId) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    async function check() {
      try {
        const result = await apiRequest<{ status: PaymentStatus; orderCanceled?: boolean }>(
          `/orders/${encodeURIComponent(orderId!)}/payment`,
          { ...(paymentAccountId && { headers: { 'X-Account-Id': paymentAccountId } }) },
        )
        if (!active) return
        setOrderCanceled(Boolean(result.orderCanceled))
        if (
          result.orderCanceled &&
          paymentAccountId &&
          (result.status === 'succeeded' || result.status === 'canceled')
        )
          useCartStore.getState().forgetPayment(orderId!, paymentAccountId)
        if (result.status === 'succeeded' && !result.orderCanceled && paymentAccountId)
          useCartStore.getState().finishPayment(orderId!, paymentAccountId)
        setStatus(result.status)
        setError('')
        if (result.status === 'pending' || result.status === 'creating')
          timer = setTimeout(() => void check(), result.orderCanceled ? 10000 : 3000)
      } catch (failure) {
        if (active) {
          setError(failure instanceof Error ? failure.message : 'Не удалось проверить оплату')
          timer = setTimeout(() => void check(), 5000)
        }
      }
    }
    void check()
    return () => {
      active = false
      if (timer) clearTimeout(timer)
    }
  }, [orderId, revision, paymentAccountId])

  return (
    <main style={{ width: 'min(100% - 40px, 680px)', margin: '70px auto 100px' }}>
      <h1>Статус оплаты</h1>
      {!orderId && <p role="alert">Не найден номер заказа для проверки.</p>}
      {orderId && !status && !error && <LoadingState label="Проверяем оплату в ЮKassa…" />}
      {orderCanceled && (
        <p role="status">
          Время оплаты истекло. Заказ отменён.
          {status === 'succeeded' &&
            ' Оплата поступила после отмены. Обратитесь к нам для возврата.'}
        </p>
      )}
      {!orderCanceled && status === 'succeeded' && <p role="status">Оплата прошла успешно.</p>}
      {!orderCanceled && status === 'canceled' && (
        <p role="status">Платёж отменён. Вы можете оформить новый заказ.</p>
      )}
      {!orderCanceled && status === 'pending' && (
        <>
          <p role="status">Платёж пока не завершён. Вы можете вернуться к оплате.</p>
          <button type="button" disabled={resuming} onClick={() => void resumePayment()}>
            {resuming ? 'Открываем оплату…' : 'Вернуться к оплате'}
          </button>
          {resuming && <LoadingState compact label="Открываем страницу оплаты…" />}
        </>
      )}
      {status === 'creating' && <p role="status">Платёж ещё создаётся. Проверяем статус…</p>}
      {(status === 'error' || status === 'unpaid') && (
        <p role="status">Оплата для этого заказа не завершена.</p>
      )}
      {error && <p role="alert">{error} Повторяем проверку автоматически.</p>}
      {orderId && (error || status === 'error' || status === 'unpaid') && (
        <button type="button" onClick={() => setRevision((value) => value + 1)}>
          Проверить ещё раз
        </button>
      )}
      <p>
        <Link to="/account/orders">Перейти к заказам</Link>
      </p>
    </main>
  )
}

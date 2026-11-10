import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { apiRequest } from '../../features/auth/api/authApi'

type PaymentStatus = 'unpaid' | 'creating' | 'error' | 'pending' | 'succeeded' | 'canceled'

export function PaymentReturnScreen() {
  const [params] = useSearchParams()
  const orderId = params.get('orderId')
  const [status, setStatus] = useState<PaymentStatus | null>(null)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [resuming, setResuming] = useState(false)

  async function resumePayment() {
    if (!orderId) return
    try {
      setResuming(true)
      setError('')
      const result = await apiRequest<{ status: PaymentStatus; confirmationUrl?: string }>(
        `/orders/${encodeURIComponent(orderId)}/pay`,
        { method: 'POST' },
      )
      if (result.confirmationUrl) window.location.assign(result.confirmationUrl)
      else setStatus(result.status)
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
        const result = await apiRequest<{ status: PaymentStatus }>(
          `/orders/${encodeURIComponent(orderId!)}/payment`,
        )
        if (!active) return
        setStatus(result.status)
        setError('')
        if (result.status === 'pending' || result.status === 'creating')
          timer = setTimeout(() => void check(), 3000)
      } catch (failure) {
        if (active)
          setError(failure instanceof Error ? failure.message : 'Не удалось проверить оплату')
      }
    }
    void check()
    return () => {
      active = false
      if (timer) clearTimeout(timer)
    }
  }, [orderId, revision])

  return (
    <main style={{ width: 'min(100% - 40px, 680px)', margin: '70px auto 100px' }}>
      <h1>Статус оплаты</h1>
      {!orderId && <p role="alert">Не найден номер заказа для проверки.</p>}
      {orderId && !status && !error && <p role="status">Проверяем оплату в ЮKassa…</p>}
      {status === 'succeeded' && <p role="status">Оплата прошла успешно.</p>}
      {status === 'canceled' && (
        <p role="status">Платёж отменён. Вы можете оформить новый заказ.</p>
      )}
      {status === 'pending' && (
        <>
          <p role="status">Платёж пока не завершён. Вы можете вернуться к оплате.</p>
          <button type="button" disabled={resuming} onClick={() => void resumePayment()}>
            Вернуться к оплате
          </button>
        </>
      )}
      {status === 'creating' && <p role="status">Платёж ещё создаётся. Проверяем статус…</p>}
      {(status === 'error' || status === 'unpaid') && (
        <p role="status">Оплата для этого заказа не завершена.</p>
      )}
      {error && <p role="alert">{error}</p>}
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

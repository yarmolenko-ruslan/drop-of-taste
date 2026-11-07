import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { normalizeRussianMobilePhone } from '../../../../../shared/validation/phone'
import { otpCodeSchema } from '../../../../../shared/validation/auth'
import { Dialog } from '../../../../shared/ui/Dialog/Dialog'
import { ApiError, authApi, type AuthUser } from '../../api/authApi'
import styles from './AuthDialog.module.css'

type AuthDialogProps = { onClose: () => void; onAuthenticate: (user: AuthUser) => void }

function formatPhone(value: string, previous: string) {
  let digits = value.replace(/\D/g, '')
  const previousDigits = previous.replace(/\D/g, '')
  // Стирать разделитель (скобку, пробел, дефис) должно продолжать стирание номера:
  // удаление символа оформления убирает последнюю цифру, иначе скобка возвращалась бы обратно.
  if (digits && digits.length === previousDigits.length && value.length < previous.length) {
    digits = digits.slice(0, -1)
  }
  if (digits.startsWith('8')) digits = `7${digits.slice(1)}`
  if (digits && !digits.startsWith('7')) digits = `7${digits}`
  digits = digits.slice(0, 11)
  if (!digits) return '+7'
  const rest = digits.slice(1)
  let result = '+7'
  if (rest) result += ` (${rest.slice(0, 3)}`
  if (rest.length >= 3) result += ')'
  if (rest.length > 3) result += ` ${rest.slice(3, 6)}`
  if (rest.length > 6) result += `-${rest.slice(6, 8)}`
  if (rest.length > 8) result += `-${rest.slice(8, 10)}`
  return result
}

export function AuthDialog({ onClose, onAuthenticate }: AuthDialogProps) {
  const [phone, setPhone] = useState('+7')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'phone' | 'code'>('phone')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [retryAt, setRetryAt] = useState(0)
  const [remaining, setRemaining] = useState(0)
  const [error, setError] = useState('')
  const [retryNotice, setRetryNotice] = useState(false)
  const pendingRequest = useRef<AbortController | null>(null)

  useEffect(() => () => pendingRequest.current?.abort(), [])

  useEffect(() => {
    if (!retryAt) return
    const tick = () => setRemaining(Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)))
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [retryAt])

  async function requestCode() {
    const normalized = normalizeRussianMobilePhone(phone)
    if (!normalized) {
      setError('Введите российский мобильный номер полностью')
      return
    }
    setBusy(true)
    setError('')
    setRetryNotice(false)
    pendingRequest.current?.abort()
    const controller = new AbortController()
    pendingRequest.current = controller
    try {
      const result = await authApi.requestCode(normalized, controller.signal)
      if (controller.signal.aborted) return
      setPhone(normalized)
      setRetryAt(Date.now() + result.retryAfterSeconds * 1000)
      setStep('code')
    } catch (failure) {
      if (controller.signal.aborted) return
      if (failure instanceof ApiError && failure.retryAfterSeconds) {
        setRetryAt(Date.now() + failure.retryAfterSeconds * 1000)
        setRetryNotice(true)
      } else {
        setError(failure instanceof Error ? failure.message : 'Не удалось запросить код')
      }
    } finally {
      if (pendingRequest.current === controller) pendingRequest.current = null
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  async function verifyCode() {
    if (!otpCodeSchema.safeParse(code).success) {
      setError('Введите 6 цифр кода')
      return
    }
    setBusy(true)
    setError('')
    pendingRequest.current?.abort()
    const controller = new AbortController()
    pendingRequest.current = controller
    try {
      const result = await authApi.verifyCode(phone, code, consent, controller.signal)
      if (controller.signal.aborted) return
      onAuthenticate(result.user)
    } catch (failure) {
      if (controller.signal.aborted) return
      // Исчерпаны попытки кода (429 + Retry-After): показываем таймер повторной отправки.
      if (failure instanceof ApiError && failure.retryAfterSeconds)
        setRetryAt(Date.now() + failure.retryAfterSeconds * 1000)
      setError(failure instanceof Error ? failure.message : 'Не удалось проверить код')
    } finally {
      if (pendingRequest.current === controller) pendingRequest.current = null
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  return (
    <Dialog titleId="auth-title" onClose={onClose} className={styles.dialog}>
      <div className={styles.content}>
        <span className={styles.eyebrow}>ЛИЧНЫЙ КАБИНЕТ</span>
        <h2 id="auth-title">{step === 'phone' ? 'Подтвердите телефон' : 'Введите код'}</h2>
        <p className={styles.intro}>
          {step === 'phone'
            ? 'Войдите, чтобы видеть заказы и адреса доставки.'
            : `Код для ${phone}. Посмотрите код в терминале локального API. SMS не отправляется.`}
        </p>
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault()
            void (step === 'phone' ? requestCode() : verifyCode())
          }}
        >
          {step === 'phone' ? (
            <>
              <label className={styles.field}>
                <span>Номер телефона</span>
                <input
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={phone}
                  aria-invalid={Boolean(error)}
                  onFocus={(event) => {
                    if (phone === '+7') {
                      setPhone('+7 (')
                      const input = event.currentTarget
                      requestAnimationFrame(() => {
                        if (document.activeElement === input)
                          input.setSelectionRange(input.value.length, input.value.length)
                      })
                    }
                  }}
                  onClick={(event) => {
                    if (phone === '+7 (') {
                      const input = event.currentTarget
                      input.setSelectionRange(input.value.length, input.value.length)
                    }
                  }}
                  onChange={(event) => {
                    setPhone(formatPhone(event.target.value, phone))
                    setError('')
                  }}
                  placeholder="+7 (999) 123-45-67"
                />
              </label>
              <label className={styles.consent}>
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                  required
                />
                <span>
                  Соглашаюсь на{' '}
                  <Link to="/data-consent" onClick={onClose}>
                    обработку персональных данных
                  </Link>
                </span>
              </label>
              {retryNotice && remaining > 0 && (
                <p className={styles.error} role="alert">
                  Повторный запрос кода возможен через {remaining} с
                </p>
              )}
            </>
          ) : (
            <>
              <label className={styles.field}>
                <span>Одноразовый код</span>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(event) => {
                    setCode(event.target.value.replace(/\D/g, '').slice(0, 6))
                    setError('')
                  }}
                />
              </label>
              <button
                type="button"
                className={styles.linkButton}
                disabled={remaining > 0 || busy}
                onClick={() => void requestCode()}
              >
                {remaining > 0 ? `Повторить код через ${remaining} с` : 'Запросить код повторно'}
              </button>
            </>
          )}
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <button
            className={styles.submit}
            type="submit"
            disabled={busy || (step === 'phone' && !consent)}
          >
            {busy ? 'Подождите…' : step === 'phone' ? 'Продолжить' : 'Войти'}
          </button>
        </form>
        <p className={styles.legal}>Тестовый режим: реальные сообщения не отправляются.</p>
      </div>
    </Dialog>
  )
}

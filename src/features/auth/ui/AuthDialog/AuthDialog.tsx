import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { normalizeRussianMobilePhone } from '../../../../../shared/validation/phone'
import { otpCodeSchema } from '../../../../../shared/validation/auth'
import { Dialog } from '../../../../shared/ui/Dialog/Dialog'
import { ApiError, authApi, type AuthUser } from '../../api/authApi'
import styles from './AuthDialog.module.css'

type AuthDialogProps = { onClose: () => void; onAuthenticate: (user: AuthUser) => void }

function formatPhone(value: string) {
  let digits = value.replace(/\D/g, '')
  if (digits.startsWith('8')) digits = `7${digits.slice(1)}`
  if (digits && !digits.startsWith('7')) digits = `7${digits}`
  digits = digits.slice(0, 11)
  if (!digits) return ''
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
  const [phone, setPhone] = useState('+7 ')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'phone' | 'code'>('phone')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [retryAt, setRetryAt] = useState(0)
  const [remaining, setRemaining] = useState(0)
  const [error, setError] = useState('')

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
    try {
      const result = await authApi.requestCode(normalized)
      setPhone(normalized)
      setRetryAt(Date.now() + result.retryAfterSeconds * 1000)
      setStep('code')
    } catch (failure) {
      if (failure instanceof ApiError && failure.retryAfterSeconds) {
        setRetryAt(Date.now() + failure.retryAfterSeconds * 1000)
      }
      setError(failure instanceof Error ? failure.message : 'Не удалось запросить код')
    } finally {
      setBusy(false)
    }
  }

  async function verifyCode() {
    if (!otpCodeSchema.safeParse(code).success) {
      setError('Введите 6 цифр кода')
      return
    }
    setBusy(true)
    setError('')
    try {
      const result = await authApi.verifyCode(phone, code)
      onAuthenticate(result.user)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Не удалось проверить код')
    } finally {
      setBusy(false)
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
            : `Код для ${phone}. Локальный тестовый код: 123456. SMS не отправляется.`}
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
                  onChange={(event) => {
                    setPhone(formatPhone(event.target.value))
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
            </>
          ) : (
            <>
              <label className={styles.field}>
                <span>Код из SMS</span>
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
                onClick={() => {
                  setStep('phone')
                  setCode('')
                  setError('')
                }}
              >
                Изменить номер
              </button>
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

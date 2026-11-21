import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import {
  formatRussianPhoneInput,
  formatRussianPhone,
  normalizeRussianMobilePhone,
} from '../../../../../shared/validation/phone'
import { Dialog } from '../../../../shared/ui/Dialog/Dialog'
import { ApiError, authApi, type AuthUser, type CallAttempt } from '../../api/authApi'
import styles from './AuthDialog.module.css'

type AuthDialogProps = { onClose: () => void; onAuthenticate: (user: AuthUser) => void }
function waitText(seconds: number) {
  if (seconds >= 3600) return Math.ceil(seconds / 3600) + ' ч'
  if (seconds >= 120) return Math.ceil(seconds / 60) + ' мин'
  return seconds + ' с'
}

export function AuthDialog({ onClose, onAuthenticate }: AuthDialogProps) {
  const [phone, setPhone] = useState('+7')
  const [lockedPhone, setLockedPhone] = useState<string | null>(null)
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState<CallAttempt | null>(null)
  const [expiredByProvider, setExpiredByProvider] = useState(false)
  const [retryAt, setRetryAt] = useState(0)
  const [now, setNow] = useState(Date.now)
  const [error, setError] = useState('')
  const titleRef = useRef<HTMLHeadingElement>(null)
  const pendingStart = useRef<AbortController | null>(null)
  const authenticate = useRef(onAuthenticate)
  useEffect(() => {
    authenticate.current = onAuthenticate
  }, [onAuthenticate])
  useEffect(() => () => pendingStart.current?.abort(), [])
  useEffect(() => {
    if (lockedPhone) titleRef.current?.focus()
  }, [lockedPhone])
  useEffect(() => {
    if (!lockedPhone) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [lockedPhone])

  const retrySeconds = Math.max(0, Math.ceil((retryAt - now) / 1000))
  const expiresIn = attempt ? Math.max(0, Math.ceil((attempt.expiresAt - now) / 1000)) : 0
  const expired = Boolean(attempt && (expiredByProvider || expiresIn === 0))

  useEffect(() => {
    if (!attempt) return
    let stopped = false
    let timer: number | undefined
    let controller: AbortController | null = null
    const poll = async () => {
      if (stopped || controller) return
      if (Date.now() >= attempt.expiresAt) {
        setExpiredByProvider(true)
        return
      }
      if (document.visibilityState === 'hidden') return
      controller = new AbortController()
      let delay = 3000
      try {
        const result = await authApi.checkCall(attempt.attemptToken, true, controller.signal)
        if (stopped || controller.signal.aborted) return
        if (result.status === 'verified') {
          stopped = true
          authenticate.current(result.user)
          return
        }
        if (result.status === 'expired') {
          setExpiredByProvider(true)
          stopped = true
          return
        }
        setError(
          result.status === 'unavailable'
            ? 'Сервис временно недоступен. Проверим звонок повторно.'
            : '',
        )
        delay = Math.max(3, result.pollAfterSeconds) * 1000
      } catch (failure) {
        if (stopped || controller.signal.aborted) return
        setError(failure instanceof Error ? failure.message : 'Не удалось проверить звонок')
        delay = 5000
      } finally {
        controller = null
      }
      if (!stopped) timer = window.setTimeout(() => void poll(), delay)
    }
    const resume = () => {
      if (document.visibilityState !== 'hidden' && !controller && !stopped) {
        window.clearTimeout(timer)
        void poll()
      }
    }
    void poll()
    document.addEventListener('visibilitychange', resume)
    window.addEventListener('focus', resume)
    return () => {
      stopped = true
      controller?.abort()
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', resume)
      window.removeEventListener('focus', resume)
    }
  }, [attempt])

  async function startCall() {
    if (pendingStart.current || !consent || (lockedPhone && Date.now() < retryAt)) return
    const normalized = lockedPhone ?? normalizeRussianMobilePhone(phone)
    if (!normalized) {
      setError('Введите российский мобильный номер полностью')
      return
    }
    // The retry button disappears during loading; retain focus before removing it.
    if (lockedPhone) titleRef.current?.focus()
    setLockedPhone(normalized)
    setBusy(true)
    setError('')
    setAttempt(null)
    setExpiredByProvider(false)
    const controller = new AbortController()
    pendingStart.current = controller
    try {
      const result = await authApi.startCall(normalized, consent, controller.signal)
      if (controller.signal.aborted) return
      setNow(Date.now())
      setRetryAt(Date.now() + result.retryAfterSeconds * 1000)
      setAttempt(result)
    } catch (failure) {
      if (controller.signal.aborted) return
      const retry =
        failure instanceof ApiError && failure.retryAfterSeconds > 0
          ? failure.retryAfterSeconds
          : 60
      setNow(Date.now())
      setRetryAt(Date.now() + retry * 1000)
      setError(failure instanceof Error ? failure.message : 'Не удалось начать проверку телефона')
    } finally {
      if (pendingStart.current === controller) pendingStart.current = null
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  return (
    <Dialog titleId="auth-title" onClose={onClose} className={styles.dialog}>
      <div className={styles.content}>
        <span className={styles.eyebrow}>ЛИЧНЫЙ КАБИНЕТ</span>
        <h2 id="auth-title" ref={titleRef} tabIndex={-1}>
          {lockedPhone ? 'Подтвердите телефон звонком' : 'Вход в личный кабинет'}
        </h2>
        {!lockedPhone ? (
          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault()
              void startCall()
            }}
          >
            <p className={styles.intro}>
              Введите номер телефона, чтобы видеть заказы и адреса доставки. Для входа потребуется
              позвонить на номер, который мы покажем.
            </p>
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
                onChange={(event) => {
                  setPhone(formatRussianPhoneInput(event.target.value, phone))
                  setError('')
                }}
                placeholder="+7 (999) 123-45-67"
              />
            </label>
            <label className={styles.consent}>
              <input
                type="checkbox"
                required
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
              />
              <span>
                Соглашаюсь на{' '}
                <Link to="/data-consent" onClick={onClose}>
                  обработку персональных данных
                </Link>
              </span>
            </label>
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            <button className={styles.submit} type="submit" disabled={!consent}>
              Продолжить
            </button>
          </form>
        ) : (
          <div className={styles.form}>
            {busy ? (
              <p role="status">Получаем номер для звонка…</p>
            ) : attempt && !expired ? (
              <>
                <p className={styles.intro}>
                  Позвоните со своего номера {formatRussianPhone(lockedPhone)} на указанный ниже
                  номер. Звонок будет сброшен автоматически, после подтверждения вы войдёте на сайт.
                </p>
                <strong className={styles.callPhone}>
                  {formatRussianPhone(attempt.callPhone)}
                </strong>
                <a className={styles.submit} href={'tel:' + attempt.callPhone}>
                  Позвонить
                </a>
                <p role="status">
                  Ожидаем ваш звонок. Осталось {Math.floor(expiresIn / 60)}:
                  {String(expiresIn % 60).padStart(2, '0')}.
                </p>
              </>
            ) : (
              <>
                {expired && <p role="status">Время ожидания истекло. Начните проверку заново.</p>}
                <button
                  type="button"
                  className={styles.submit}
                  disabled={busy || retrySeconds > 0}
                  onClick={() => void startCall()}
                >
                  {retrySeconds > 0
                    ? 'Повторить проверку через ' + waitText(retrySeconds)
                    : 'Повторить проверку'}
                </button>
              </>
            )}
            {error && !expired && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
          </div>
        )}
      </div>
    </Dialog>
  )
}

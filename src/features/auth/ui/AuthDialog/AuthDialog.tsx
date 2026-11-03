import { useState } from 'react'
import { Link } from 'react-router'
import { Dialog } from '../../../../shared/ui/Dialog/Dialog'
import styles from './AuthDialog.module.css'

type AuthDialogProps = {
  onClose: () => void
  onAuthenticate: (phone: string) => void
}

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
  const [consent, setConsent] = useState(true)
  const [error, setError] = useState('')

  return (
    <Dialog titleId="auth-title" onClose={onClose} className={styles.dialog}>
      <div className={styles.content}>
        <span className={styles.eyebrow}>ЛИЧНЫЙ КАБИНЕТ</span>
        <h2 id="auth-title">Подтвердите телефон</h2>
        <p className={styles.intro}>
          Войдите, чтобы видеть заказы, адреса доставки и баланс программы лояльности.
        </p>
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault()
            const digits = phone.replace(/\D/g, '')
            if (digits.length !== 11) {
              setError('Введите номер телефона полностью')
              return
            }
            onAuthenticate(phone.trim())
          }}
        >
          <label className={styles.field}>
            <span>Номер телефона</span>
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              aria-describedby={error ? 'auth-phone-error' : undefined}
              aria-invalid={Boolean(error)}
              onChange={(event) => {
                setPhone(formatPhone(event.target.value))
                setError('')
              }}
              placeholder="+7 (999) 123-45-67"
              required
            />
          </label>
          {error && (
            <p className={styles.error} id="auth-phone-error" role="alert">
              {error}
            </p>
          )}
          <button className={styles.submit} type="submit" disabled={!consent}>
            Продолжить
          </button>
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
        </form>
        <p className={styles.legal}>
          Продолжая регистрацию, вы принимаете условия политики конфиденциальности и
          пользовательского соглашения.
        </p>
      </div>
    </Dialog>
  )
}

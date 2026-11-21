import { useState, type FormEvent } from 'react'
import { apiRequest } from '../../features/auth/api/authApi'
import { errorMessage } from './adminUtils'
import styles from './AdminScreen.module.css'
export function PasswordEditor({
  required,
  onChanged,
  onCancel,
}: {
  required: boolean
  onChanged: () => void
  onCancel: () => void
}) {
  const [currentPassword, setCurrent] = useState('')
  const [newPassword, setNew] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function save(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    if (newPassword !== confirmation) {
      setError('Новые пароли не совпадают')
      return
    }
    setBusy(true)
    setError('')
    try {
      await apiRequest('/admin/password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      onChanged()
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className={styles.editor} onSubmit={(event) => void save(event)}>
      <h2>{required ? 'Замените временный пароль' : 'Смена пароля'}</h2>
      <p>
        Новый пароль должен содержать от 12 до 128 символов и отличаться от текущего. После
        сохранения войдите заново. Все прежние сессии будут отозваны.
      </p>
      <label className={styles.field}>
        Текущий пароль
        <input
          type="password"
          autoComplete="current-password"
          required
          value={currentPassword}
          onChange={(event) => setCurrent(event.target.value)}
        />
      </label>
      <label className={styles.field}>
        Новый пароль
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          maxLength={128}
          value={newPassword}
          onChange={(event) => setNew(event.target.value)}
        />
      </label>
      <label className={styles.field}>
        Повторите новый пароль
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          maxLength={128}
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
        />
      </label>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <div className={styles.row}>
        <button disabled={busy} type="submit">
          {busy ? 'Сохраняем…' : 'Сохранить новый пароль'}
        </button>
        {!required && (
          <button type="button" disabled={busy} onClick={onCancel}>
            Отмена
          </button>
        )}
      </div>
    </form>
  )
}

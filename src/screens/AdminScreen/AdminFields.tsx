import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { apiRequest } from '../../features/auth/api/authApi'
import { formatRussianPhone, formatRussianPhoneInput } from '../../../shared/validation/phone'
import { errorMessage } from './adminUtils'
import styles from './AdminScreen.module.css'

export function ImageField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  const id = useId()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const request = useRef<AbortController | null>(null)
  const onChangeRef = useRef(onChange)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    inputRef.current?.setCustomValidity(busy ? 'Дождитесь завершения загрузки изображения' : '')
  }, [busy])
  useLayoutEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])
  useEffect(() => () => request.current?.abort(), [])
  async function upload(file: File) {
    request.current?.abort()
    if (
      file.size > 5_000_000 ||
      !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)
    ) {
      setError('Выберите PNG, JPEG, WebP или GIF размером до 5 МБ')
      setBusy(false)
      return
    }
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setError('')
    try {
      const result = await apiRequest<{ url: string }>('/admin/upload', {
        method: 'POST',
        headers: { 'Content-Type': file.type },
        body: file,
        signal: controller.signal,
      })
      if (!controller.signal.aborted) onChangeRef.current(result.url)
    } catch (failure) {
      if (!controller.signal.aborted) setError(errorMessage(failure))
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      <span className={styles.imageRow}>
        <input
          ref={inputRef}
          id={id}
          value={value}
          onChange={(event) => {
            request.current?.abort()
            setBusy(false)
            setError('')
            onChange(event.target.value)
          }}
          placeholder="/uploads/… или https://…"
        />
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          disabled={busy}
          aria-label={`Загрузить ${label.toLowerCase()}`}
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void upload(file)
          }}
        />
      </span>
      {busy && <small role="status">Загрузка…</small>}
      {error && (
        <small className={styles.error} role="alert">
          {error}
        </small>
      )}
      {value && <img className={styles.preview} src={value} alt="Предпросмотр" />}
    </div>
  )
}

export function TextField({
  label,
  value,
  onChange,
  multiline = false,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (value: string) => void
  multiline?: boolean
  type?: string
}) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      {multiline ? (
        <textarea rows={3} value={value} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input
          type={type}
          value={value}
          onInput={
            type === 'datetime-local' ? (event) => onChange(event.currentTarget.value) : undefined
          }
          onChange={type === 'datetime-local' ? undefined : (event) => onChange(event.target.value)}
        />
      )}
    </label>
  )
}

export function PhoneField({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className={styles.field}>
      <span>Телефон</span>
      <input
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        value={formatRussianPhone(value)}
        placeholder="+7 (999) 888-77-66"
        pattern="\+7 \(\d{3}\) \d{3}-\d{2}-\d{2}"
        title="Введите номер в формате +7 (999) 888-77-66"
        onChange={(event) =>
          onChange(
            event.target.value.trim()
              ? formatRussianPhoneInput(event.target.value, formatRussianPhone(value))
              : '',
          )
        }
      />
    </label>
  )
}

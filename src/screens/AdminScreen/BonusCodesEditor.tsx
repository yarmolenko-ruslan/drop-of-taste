import { Select } from '../../shared/ui/Select/Select'
import { useEffect, useState, type FormEvent } from 'react'
import { apiRequest } from '../../features/auth/api/authApi'
import styles from './AdminScreen.module.css'
import type { BonusCode } from '../../../shared/bonus-code'
import { errorMessage, localDate, isoDate } from './adminUtils'
import { TextField } from './AdminFields'
import { LoadingState } from '../../shared/ui/LoadingState/LoadingState'

export function BonusCodesEditor({ canManage = true }: { canManage?: boolean }) {
  const [codes, setCodes] = useState<BonusCode[]>([])
  const [loadingCodes, setLoadingCodes] = useState(true)
  const [draft, setDraft] = useState<BonusCode>({
    _id: '',
    kind: 'percent',
    value: 10,
    startsAt: '',
    endsAt: '',
    active: true,
  })
  const [existing, setExisting] = useState(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  async function refresh() {
    setLoadingCodes(true)
    try {
      const response = await apiRequest<{ codes: BonusCode[] }>('/admin/bonus-codes')
      setCodes(response.codes)
    } finally {
      setLoadingCodes(false)
    }
  }
  useEffect(() => {
    apiRequest<{ codes: BonusCode[] }>('/admin/bonus-codes')
      .then((response) => setCodes(response.codes))
      .catch((error) => setMessage(errorMessage(error)))
      .finally(() => setLoadingCodes(false))
  }, [])
  async function save(event: FormEvent) {
    event.preventDefault()
    if (!canManage || busy) return
    setBusy(true)
    setMessage('')
    try {
      if (
        !draft.startsAt ||
        !draft.endsAt ||
        Date.parse(draft.startsAt) >= Date.parse(draft.endsAt)
      )
        throw new Error('Укажите правильное время начала и окончания')
      const payload = {
        code: draft._id,
        kind: draft.kind,
        value: draft.value,
        startsAt: draft.startsAt,
        endsAt: draft.endsAt,
        active: draft.active,
      }
      const response = await apiRequest<{ code: BonusCode }>(
        existing ? `/admin/bonus-codes/${encodeURIComponent(draft._id)}` : '/admin/bonus-codes',
        { method: existing ? 'PUT' : 'POST', body: JSON.stringify(payload) },
      )
      setDraft(response.code)
      setExisting(true)
      await refresh()
      setMessage('Бонус-код сохранён')
    } catch (error) {
      setMessage(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  async function remove() {
    if (!canManage || busy || !existing || !window.confirm(`Удалить бонус-код ${draft._id}?`))
      return
    setBusy(true)
    try {
      await apiRequest(`/admin/bonus-codes/${encodeURIComponent(draft._id)}`, { method: 'DELETE' })
      setDraft({ _id: '', kind: 'percent', value: 10, startsAt: '', endsAt: '', active: true })
      setExisting(false)
      await refresh()
      setMessage('Бонус-код удалён')
    } catch (error) {
      setMessage(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className={styles.productsLayout}>
      <aside className={styles.productList}>
        <button
          type="button"
          disabled={!canManage || busy}
          onClick={() => {
            setDraft({
              _id: '',
              kind: 'percent',
              value: 10,
              startsAt: '',
              endsAt: '',
              active: true,
            })
            setExisting(false)
            setMessage('')
          }}
        >
          + Новый код
        </button>
        {loadingCodes && codes.length === 0 && <LoadingState label="Загружаем бонус-коды…" />}
        {codes.map((code) => (
          <button
            type="button"
            key={code._id}
            className={existing && draft._id === code._id ? styles.selected : ''}
            onClick={() => {
              setDraft(code)
              setExisting(true)
              setMessage('')
            }}
          >
            {code._id}
          </button>
        ))}
      </aside>
      <form className={styles.editor} onSubmit={(event) => void save(event)}>
        <fieldset className={styles.accessFieldset} disabled={!canManage || busy}>
          <div className={styles.actions}>
            <button type="submit" disabled={busy}>
              {busy ? 'Сохраняем…' : 'Сохранить бонус-код'}
            </button>
            <span role="status">{message}</span>
          </div>
          <h2>{existing ? `Бонус-код ${draft._id}` : 'Новый бонус-код'}</h2>
          <label className={styles.field}>
            <span>Код для клиента</span>
            <input
              value={draft._id}
              readOnly={existing}
              required
              onChange={(event) => setDraft({ ...draft, _id: event.target.value.toUpperCase() })}
            />
          </label>
          <div className={styles.grid}>
            <label className={styles.field}>
              <span>Вид скидки</span>
              <Select
                value={draft.kind}
                onValueChange={(value) =>
                  setDraft({ ...draft, kind: value as BonusCode['kind'], value: 10 })
                }
              >
                <option value="percent">Проценты</option>
                <option value="rubles">Рубли</option>
              </Select>
            </label>
            <label className={styles.field}>
              <span>{draft.kind === 'percent' ? 'Скидка, %' : 'Скидка, ₽'}</span>
              <input
                type="number"
                min="0.01"
                max={draft.kind === 'percent' ? 100 : 1000000}
                step="0.01"
                required
                value={draft.value}
                onChange={(event) => setDraft({ ...draft, value: Number(event.target.value) })}
              />
            </label>
            <TextField
              label="Действует с"
              type="datetime-local"
              value={localDate(draft.startsAt)}
              onChange={(v) => setDraft({ ...draft, startsAt: isoDate(v) ?? '' })}
            />
            <TextField
              label="Действует до"
              type="datetime-local"
              value={localDate(draft.endsAt)}
              onChange={(v) => setDraft({ ...draft, endsAt: isoDate(v) ?? '' })}
            />
          </div>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={draft.active}
              onChange={(event) => setDraft({ ...draft, active: event.target.checked })}
            />
            Код включён
          </label>
          <p>
            Время указывается по вашему часовому поясу. Код не действует на комбо и наборы.
            Бонус-код, скидка за самовывоз и выбранная скидка ко дню рождения не суммируются —
            применяется наибольшая из них. Стоимость доставки не уменьшается.
          </p>
          {existing && (
            <button
              type="button"
              className={styles.danger}
              disabled={busy}
              onClick={() => void remove()}
            >
              Удалить код
            </button>
          )}
        </fieldset>
      </form>
    </div>
  )
}

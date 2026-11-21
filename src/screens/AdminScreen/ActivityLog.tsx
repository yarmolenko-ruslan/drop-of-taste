import { Select } from '../../shared/ui/Select/Select'
import { useEffect, useId, useMemo, useState } from 'react'
import { apiRequest } from '../../features/auth/api/authApi'
import {
  activityLabels,
  activitySectionLabels,
  type ActivityPage,
  type AdminActivity,
} from '../../../shared/admin-activity'
import { errorMessage } from './adminUtils'
import styles from './AdminScreen.module.css'
import { LogGroups } from './LogGroups.tsx'
import { formatLogTime } from './groupLogEntries'
import { ADMIN_LOG_RETENTION_DAYS } from '../../../shared/admin-log-policy'
const outcomes = {
  pending: 'Результат ещё не подтверждён',
  success: 'Успешно',
  denied: 'Отказано в доступе',
  error: 'Ошибка',
}
type Filters = { role: string; kind: string; outcome: string; q: string }
export function ActivityLog() {
  const filterFormId = useId()
  const [filters, setFilters] = useState<Filters>({
    role: 'all',
    kind: 'all',
    outcome: 'all',
    q: '',
  })
  const [queryName, setQueryName] = useState('')
  const [entries, setEntries] = useState<AdminActivity[]>([])
  const [before, setBefore] = useState<string | null>(null)
  const [next, setNext] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const url = useMemo(() => {
    const query = new URLSearchParams({ ...filters, limit: '50' })
    if (before) query.set('before', before)
    return `/admin/activity?${query}`
  }, [filters, before])
  useEffect(() => {
    let active = true
    const controller = new AbortController()
    apiRequest<ActivityPage>(url, { signal: controller.signal })
      .then((result) => {
        if (!active) return
        setEntries((current) => (before ? [...current, ...result.activities] : result.activities))
        setNext(result.nextBefore)
      })
      .catch((failure) => {
        if (active) setError(errorMessage(failure))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [url, before, refresh])
  function filter(values: Partial<Filters>) {
    setFilters((current) => ({ ...current, ...values }))
    setRefresh((current) => current + 1)
    setBefore(null)
    setLoading(true)
    setError('')
  }
  return (
    <section aria-label="Журнал действий" className={styles.activityLog} aria-busy={loading}>
      <h2>Журнал действий</h2>
      <p>
        Конкретные действия владельца и сотрудников: создание и изменение данных, этапы заказов,
        вход и управление доступом. Записи хранятся {ADMIN_LOG_RETENTION_DAYS} дней. Навигация и
        ввод в поля не записываются.
      </p>
      <form
        id={filterFormId}
        className={`${styles.grid} ${styles.activityFilters}`}
        onSubmit={(event) => {
          event.preventDefault()
          filter({ q: queryName })
        }}
      >
        <label className={styles.field}>
          Кто совершил действие
          <Select value={filters.role} onValueChange={(value) => filter({ role: value })}>
            <option value="all">Все</option>
            <option value="owner">Владелец</option>
            <option value="employee">Сотрудники</option>
            <option value="anonymous">Без входа</option>
          </Select>
        </label>
        <label className={styles.field}>
          Тип действия
          <Select value={filters.kind} onValueChange={(value) => filter({ kind: value })}>
            <option value="all">Все действия</option>
            <option value="access">Вход и пароли</option>
            <option value="change">Изменения</option>
          </Select>
        </label>
        <label className={styles.field}>
          Результат действия
          <Select value={filters.outcome} onValueChange={(value) => filter({ outcome: value })}>
            <option value="all">Любой результат</option>
            <option value="success">Успешно</option>
            <option value="denied">Отказано в доступе</option>
            <option value="error">Ошибка</option>
            <option value="pending">Результат не подтверждён</option>
          </Select>
        </label>
        <label className={styles.field}>
          Имя автора действия
          <input
            type="search"
            maxLength={100}
            value={queryName}
            onChange={(event) => setQueryName(event.target.value)}
          />
        </label>
      </form>
      <div className={`${styles.actions} ${styles.activityActions}`}>
        <button type="submit" form={filterFormId} className={styles.secondary}>
          Найти автора
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={() => {
            setBefore(null)
            setLoading(true)
            setError('')
            setRefresh((current) => current + 1)
          }}
        >
          Обновить действия
        </button>
        {loading && <span role="status">Загружаем действия…</span>}
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {!loading && !error && !entries.length && <p>Действий по выбранным фильтрам пока нет.</p>}
      <LogGroups
        entries={entries}
        renderEntry={(entry) => (
          <article className={`${styles.panel} ${styles.activityCard}`} key={entry._id}>
            <div className={styles.activityText}>
              <strong>
                {activityLabels[entry.action] ?? 'Административный запрос'}
                {entry.section ? ` · ${activitySectionLabels[entry.section]}` : ''}
              </strong>

              <p>
                <time dateTime={entry.at}>{formatLogTime(entry.at)}</time> ·{' '}
                {entry.actor
                  ? `${entry.actor.name} (${entry.actor.role === 'owner' ? 'владелец' : 'сотрудник'})`
                  : 'Неавторизованный запрос'}
              </p>
              {entry.action === 'admin.request' && (
                <p>
                  Запрос:{' '}
                  <code>
                    {entry.method} {entry.route}
                  </code>
                </p>
              )}
              {entry.resourceId && (
                <p>
                  Объект: <code>{entry.resourceId}</code>
                </p>
              )}
              {entry.errorCode && (
                <p>
                  Код результата: <code>{entry.errorCode}</code>
                  {entry.statusCode ? ` · ${entry.statusCode}` : ''}
                </p>
              )}
            </div>
            <span
              className={
                entry.outcome === 'success' ? styles.activitySuccess : styles.activityFailure
              }
            >
              {outcomes[entry.outcome]}
            </span>
          </article>
        )}
      />
      {next && (
        <button
          type="button"
          disabled={loading}
          className={styles.secondary}
          onClick={() => {
            setBefore(next)
            setRefresh((current) => current + 1)
            setLoading(true)
            setError('')
          }}
        >
          Показать ещё действия
        </button>
      )}
    </section>
  )
}

import { useEffect, useState } from 'react'
import { apiRequest } from '../../features/auth/api/authApi'
import { errorMessage } from './adminUtils'
import { ActivityLog } from './ActivityLog'
import { LogGroups } from './LogGroups.tsx'
import { formatLogTime } from './groupLogEntries'
import { LoadingState } from '../../shared/ui/LoadingState/LoadingState'
import styles from './AdminScreen.module.css'

type AuditEntry = {
  _id: string
  action: string
  id?: string
  at: string
  actor?: { name: string; role: string }
  changes?: { field: string; before: unknown; after: unknown }[]
}
type PaymentEntry = {
  _id: string
  orderId: string
  from: string
  status: string
  paymentId?: string
  amountKopecks: number
  at: string
}
const paymentStatusLabels: Record<string, string> = {
  unpaid: 'Без оплаты',
  creating: 'Создание платежа',
  pending: 'Ожидает оплаты',
  succeeded: 'Оплачено',
  canceled: 'Отменено',
  order_canceled: 'Заказ отменён: истекло время оплаты',
  error: 'Ошибка',
}
const auditActionLabels: Record<string, string> = {
  'employee.create': 'Создан сотрудник',
  'employee.update': 'Изменён сотрудник',
  'employee.password_reset': 'Сброшен пароль сотрудника',
  'employee.password_changed': 'Сотрудник сменил пароль',
  'order.stage': 'Изменён этап заказа',
  'content.update': 'Изменён сайт',
  'category.create': 'Создан раздел',
  'category.update': 'Изменён раздел',
  'category.delete': 'Удалён раздел',
  'product.create': 'Создан товар',
  'product.update': 'Изменён товар',
  'product.delete': 'Удалён товар',
  'bonus_code.create': 'Создан бонус-код',
  'bonus_code.update': 'Изменён бонус-код',
  'bonus_code.delete': 'Удалён бонус-код',
  'image.upload': 'Загружено изображение',
  'iiko.sync': 'Импортировано меню iiko',
  'product.iiko_create': 'Товар добавлен из iiko',
  'product.iiko_update': 'Товар обновлён из iiko',
}
const logValue = (value: unknown) =>
  typeof value === 'string' ? value : (JSON.stringify(value) ?? '—')
export function LogsEditor() {
  const [logs, setLogs] = useState<{ changes: AuditEntry[]; payments: PaymentEntry[] } | null>(null)
  const [loadingLogs, setLoadingLogs] = useState(true)
  const [message, setMessage] = useState('')
  async function refresh() {
    setLoadingLogs(true)
    try {
      setLogs(await apiRequest('/admin/logs'))
      setMessage('')
    } catch (error) {
      setMessage(errorMessage(error))
    } finally {
      setLoadingLogs(false)
    }
  }
  useEffect(() => {
    apiRequest<{ changes: AuditEntry[]; payments: PaymentEntry[] }>('/admin/logs')
      .then((response) => setLogs(response))
      .catch((error) => setMessage(errorMessage(error)))
      .finally(() => setLoadingLogs(false))
  }, [])
  return (
    <div className={styles.editor} aria-busy={loadingLogs}>
      <ActivityLog />
      <div className={styles.actions}>
        <button type="button" onClick={() => void refresh()}>
          Обновить журнал
        </button>
        <span role="status">{message}</span>
      </div>
      <h2>Оплаты</h2>
      {loadingLogs && !logs && <LoadingState label="Загружаем журнал…" />}
      {!logs ? (
        !loadingLogs && <p>Журнал пока недоступен.</p>
      ) : logs.payments.length === 0 ? (
        <p>Платежей пока нет.</p>
      ) : (
        <LogGroups
          entries={logs.payments}
          renderEntry={(item) => (
            <div className={styles.panel} key={item._id}>
              <strong>
                {formatLogTime(item.at)} · заказ {item.orderId.slice(0, 8)}
              </strong>
              <p>
                {paymentStatusLabels[item.from] ?? item.from} →{' '}
                {paymentStatusLabels[item.status] ?? item.status} ·{' '}
                {(item.amountKopecks / 100).toLocaleString('ru-RU')} ₽
                {item.paymentId ? ` · платёж ${item.paymentId}` : ''}
              </p>
            </div>
          )}
        />
      )}
      <h2>Изменения на сайте</h2>
      {logs?.changes.length === 0 && <p>Изменений пока нет.</p>}
      <LogGroups
        entries={logs?.changes ?? []}
        renderEntry={(item) => (
          <div className={styles.panel} key={item._id}>
            <strong>
              {formatLogTime(item.at)} · {auditActionLabels[item.action] ?? item.action}
              {item.id ? ` · ${item.id}` : ''}
              {item.actor
                ? ` · ${item.actor.name} (${item.actor.role === 'owner' ? 'владелец' : 'сотрудник'})`
                : ''}
            </strong>
            {item.changes?.map((change, index) => (
              <p key={index}>
                <b>{change.field}</b>: {logValue(change.before)} → {logValue(change.after)}
              </p>
            ))}
          </div>
        )}
      />
    </div>
  )
}

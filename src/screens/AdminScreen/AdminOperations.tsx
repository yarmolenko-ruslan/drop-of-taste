import { useCallback, useEffect, useRef, useState } from 'react'
import { apiRequest } from '../../features/auth/api/authApi'
import styles from './AdminOperations.module.css'

type Stage = 'new' | 'preparing' | 'delivering' | 'completed'
type Client = {
  _id: string
  name?: string
  phone: string
  email?: string
  birthday?: string
  consentAcceptedAt?: string
}
type Order = {
  _id: string
  accountId: string
  createdAt: string
  completedAt?: string
  fulfillmentStatus: Stage
  customer?: Client | null
  payment?: { status: string }
  input: { fulfillment: { mode: string; label: string; details?: Record<string, unknown> } }
  quote: {
    lines: { name: string; quantity: number; lineTotalKopecks: number }[]
    totalKopecks: number
    deliveryKopecks: number
    discountKopecks: number
    promoCode?: string
    promoDiscountKopecks?: number
  }
}
const stages: { id: Stage; label: string; action?: string }[] = [
  { id: 'new', label: 'Новые заказы', action: 'Принять заказ' },
  { id: 'preparing', label: 'В работе', action: 'Передать в доставку' },
  { id: 'delivering', label: 'В доставке', action: 'Завершить заказ' },
  { id: 'completed', label: 'Завершённые' },
]
const money = (kopecks: number) => `${(kopecks / 100).toLocaleString('ru-RU')} ₽`
const date = (value: string) =>
  new Date(value).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' })

function OrderCard({
  order,
  onAdvance,
  busy,
}: {
  order: Order
  onAdvance?: () => void
  busy?: boolean
}) {
  const current = stages.findIndex((stage) => stage.id === order.fulfillmentStatus)
  return (
    <article className={styles.card}>
      <div className={styles.cardTop}>
        <div>
          <strong>№{order._id.slice(0, 8).toUpperCase()}</strong>
          <span>{date(order.createdAt)}</span>
        </div>
        <b>{money(order.quote.totalKopecks)}</b>
      </div>
      <p className={styles.customer}>
        {order.customer?.name || order.customer?.phone || 'Клиент'}{' '}
        {order.customer?.name && order.customer.phone}{' '}
      </p>
      <p>
        <b>{order.input.fulfillment.mode === 'pickup' ? 'Самовывоз' : 'Доставка'}:</b>{' '}
        {order.input.fulfillment.label}
      </p>
      <p>
        <b>Этап:</b> {stages[current]?.label}
      </p>
      <p>
        <b>Оплата:</b>{' '}
        {order.payment?.status === 'succeeded'
          ? 'Оплачено'
          : order.payment?.status === 'pending'
            ? 'Ожидает подтверждения'
            : order.payment?.status === 'canceled'
              ? 'Отменена'
              : 'Не оплачено'}
      </p>
      <details>
        <summary>Состав заказа</summary>
        <ul>
          {order.quote.lines.map((line, index) => (
            <li key={index}>
              {line.name} × {line.quantity} <b>{money(line.lineTotalKopecks)}</b>
            </li>
          ))}
        </ul>
        {order.quote.discountKopecks > 0 && <p>Скидка: −{money(order.quote.discountKopecks)}</p>}
        {(order.quote.promoDiscountKopecks ?? 0) > 0 && (
          <p>
            Бонус-код {order.quote.promoCode}: −{money(order.quote.promoDiscountKopecks ?? 0)}
          </p>
        )}
        {order.quote.deliveryKopecks > 0 && <p>Доставка: {money(order.quote.deliveryKopecks)}</p>}
      </details>
      {onAdvance && (
        <button type="button" className={styles.primary} disabled={busy} onClick={onAdvance}>
          {busy ? 'Сохраняем…' : stages[current]?.action} →
        </button>
      )}
    </article>
  )
}

export function OrdersEditor() {
  const [stage, setStage] = useState<Stage>('new')
  const [orders, setOrders] = useState<Order[]>([])
  const [nextBefore, setNextBefore] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const requestSeq = useRef(0)
  const loadedCount = useRef(50)
  const activeStage = useRef<Stage>('new')
  const load = useCallback(async (current: Stage, before?: string) => {
    const seq = ++requestSeq.current
    try {
      const query = new URLSearchParams({ stage: current })
      if (before) query.set('before', before)
      else query.set('limit', String(loadedCount.current))
      const result = await apiRequest<{ orders: Order[]; nextBefore: string | null }>(
        `/admin/orders?${query}`,
      )
      if (seq !== requestSeq.current) return
      loadedCount.current = before
        ? loadedCount.current + result.orders.length
        : Math.max(50, result.orders.length)
      setOrders((old) => (before ? [...old, ...result.orders] : result.orders))
      setNextBefore(result.nextBefore)
      setError('')
    } catch (failure) {
      if (seq !== requestSeq.current) return
      setError(failure instanceof Error ? failure.message : 'Не удалось загрузить заказы')
    }
  }, [])
  useEffect(() => {
    const initial = window.setTimeout(() => {
      void load(stage)
    }, 0)
    const timer = window.setInterval(() => {
      void load(stage)
    }, 20000)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(timer)
    }
  }, [stage, load])
  async function advance(order: Order) {
    const next = stages[stages.findIndex((item) => item.id === order.fulfillmentStatus) + 1]
    if (!next) return
    setBusy(order._id)
    try {
      await apiRequest(`/admin/orders/${order._id}/stage`, {
        method: 'PATCH',
        body: JSON.stringify({ stage: next.id }),
      })
      if (activeStage.current === stage) {
        setOrders((old) => old.filter((item) => item._id !== order._id))
        setError('')
      }
    } catch (failure) {
      if (activeStage.current === stage) {
        setError(failure instanceof Error ? failure.message : 'Не удалось изменить этап')
        void load(stage)
      }
    } finally {
      setBusy(null)
    }
  }
  return (
    <section className={styles.workspace}>
      <div className={styles.heading}>
        <div>
          <h2>Заказы</h2>
          <p>Новые заказы проверяются автоматически каждые 20 секунд.</p>
        </div>
        <button type="button" onClick={() => void load(stage)}>
          Обновить
        </button>
      </div>
      <div className={styles.filters} role="tablist" aria-label="Этап заказа">
        {stages.map((item) => (
          <button
            type="button"
            role="tab"
            aria-selected={stage === item.id}
            className={stage === item.id ? styles.active : ''}
            key={item.id}
            onClick={() => {
              requestSeq.current++
              loadedCount.current = 50
              activeStage.current = item.id
              setOrders([])
              setNextBefore(null)
              setStage(item.id)
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <div className={styles.cards}>
        {orders.map((order) => (
          <OrderCard
            key={order._id}
            order={order}
            busy={busy === order._id}
            onAdvance={stage === 'completed' ? undefined : () => void advance(order)}
          />
        ))}
      </div>
      {!orders.length && !error && <p className={styles.empty}>Заказов в этом разделе пока нет.</p>}
      {nextBefore && (
        <button type="button" className={styles.more} onClick={() => void load(stage, nextBefore)}>
          Показать ещё
        </button>
      )}
    </section>
  )
}

export function ClientsEditor() {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [clients, setClients] = useState<Client[]>([])
  const [nextBefore, setNextBefore] = useState<string | null>(null)
  const [selected, setSelected] = useState<{
    client: Client
    addresses: string[]
    orders: Order[]
  } | null>(null)
  const [error, setError] = useState('')
  const requestSeq = useRef(0)
  const selectionSeq = useRef(0)
  const load = useCallback(
    async (before?: string) => {
      const seq = ++requestSeq.current
      try {
        const params = new URLSearchParams({ q: query, filter })
        if (before) params.set('before', before)
        const result = await apiRequest<{ clients: Client[]; nextBefore: string | null }>(
          `/admin/clients?${params}`,
        )
        if (seq !== requestSeq.current) return
        setClients((old) => (before ? [...old, ...result.clients] : result.clients))
        setNextBefore(result.nextBefore)
        setError('')
      } catch (failure) {
        if (seq !== requestSeq.current) return
        setError(failure instanceof Error ? failure.message : 'Не удалось загрузить клиентов')
      }
    },
    [query, filter],
  )
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load()
    }, 250)
    return () => window.clearTimeout(timer)
  }, [load])
  async function open(id: string) {
    const seq = ++selectionSeq.current
    try {
      const result = await apiRequest<{ client: Client; addresses: string[]; orders: Order[] }>(
        `/admin/clients/${id}`,
      )
      if (seq !== selectionSeq.current) return
      setSelected(result)
      setError('')
    } catch (failure) {
      if (seq !== selectionSeq.current) return
      setError(failure instanceof Error ? failure.message : 'Не удалось открыть клиента')
    }
  }
  return (
    <section className={styles.workspace}>
      <div className={styles.heading}>
        <div>
          <h2>Клиенты</h2>
          <p>Профили зарегистрированных клиентов и история их заказов.</p>
        </div>
      </div>
      <div className={styles.search}>
        <input
          aria-label="Поиск клиентов"
          placeholder="Имя, телефон или почта"
          value={query}
          onChange={(event) => {
            requestSeq.current++
            selectionSeq.current++
            setSelected(null)
            setClients([])
            setNextBefore(null)
            setQuery(event.target.value)
          }}
        />
        <select
          aria-label="Фильтр клиентов"
          value={filter}
          onChange={(event) => {
            requestSeq.current++
            selectionSeq.current++
            setSelected(null)
            setClients([])
            setNextBefore(null)
            setFilter(event.target.value)
          }}
        >
          <option value="all">Все клиенты</option>
          <option value="ordered">С заказами</option>
          <option value="without-orders">Без заказов</option>
        </select>
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <div className={styles.clientLayout}>
        <div className={styles.clientList}>
          {clients.map((client) => (
            <button
              type="button"
              key={client._id}
              className={selected?.client._id === client._id ? styles.selectedClient : ''}
              onClick={() => void open(client._id)}
            >
              <strong>{client.name || 'Без имени'}</strong>
              <span>{client.phone}</span>
              {client.email && <small>{client.email}</small>}
            </button>
          ))}
          {!clients.length && !error && <p className={styles.empty}>Клиенты не найдены.</p>}
          {nextBefore && (
            <button type="button" onClick={() => void load(nextBefore)}>
              Показать ещё
            </button>
          )}
        </div>
        <div className={styles.profile}>
          {selected ? (
            <>
              <h3>{selected.client.name || 'Клиент без имени'}</h3>
              <p>
                <b>Телефон:</b> {selected.client.phone}
              </p>
              <p>
                <b>Почта:</b> {selected.client.email || 'Не указана'}
              </p>
              <p>
                <b>Дата рождения:</b> {selected.client.birthday || 'Не указана'}
              </p>
              <p>
                <b>Адреса:</b>{' '}
                {selected.addresses.length ? selected.addresses.join('; ') : 'Не добавлены'}
              </p>
              <h3>История заказов · {selected.orders.length}</h3>
              {selected.orders.length ? (
                selected.orders.map((order) => <OrderCard key={order._id} order={order} />)
              ) : (
                <p>Заказов пока нет.</p>
              )}
            </>
          ) : (
            <p className={styles.empty}>
              Выберите клиента, чтобы посмотреть профиль и все его заказы.
            </p>
          )}
        </div>
      </div>
    </section>
  )
}

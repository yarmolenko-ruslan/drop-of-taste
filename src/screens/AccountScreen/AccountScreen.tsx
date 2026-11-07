import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router'
import {
  FulfillmentDialog,
  type FulfillmentSelection,
} from '../../features/fulfillment/ui/FulfillmentDialog/FulfillmentDialog'
import { birthDateSchema, profileSchema } from '../../../shared/validation/profile'
import { issuesByField } from '../../../shared/validation/issues'
import styles from './AccountScreen.module.css'
import { ApiError, apiRequest } from '../../features/auth/api/authApi'
import { Spinner } from '../../shared/ui/Spinner/Spinner'
import { Dialog } from '../../shared/ui/Dialog/Dialog'
import { useCartStore } from '../../features/cart'
import { useCatalog } from '../../features/catalog/api/CatalogProvider'
import { formatCompactAddress } from '../../shared/lib/formatCompactAddress'

export type AccountUser = {
  id: string
  name: string
  phone: string
}

type AccountScreenProps = {
  user: AccountUser
  ordersRevision?: number
  onLogout: () => void
  onUpdateUser: (user: AccountUser) => void
  /** Вызывается после успешного сохранения выбранного адреса (сценарий «выбор адреса из корзины»). */
  onAddressPicked?: () => void
}

type Address = FulfillmentSelection & { id: string }

function displayAddress(address: Address): string {
  return address.details ? formatCompactAddress(address.details) : address.label
}

type Order = {
  _id: string
  createdAt: string
  status?: 'test' | 'completed'
  completedAt?: string | null
  input: { fulfillment: { mode: 'pickup' | 'delivery'; label: string } }
  quote: {
    lines: {
      productId: string
      name: string
      quantity: number
      unitPriceKopecks: number
      lineTotalKopecks: number
    }[]
    discountKopecks: number
    deliveryKopecks: number
    totalKopecks: number
  }
}

const sections = [
  { id: 'orders', label: 'Заказы' },
  { id: 'addresses', label: 'Адреса доставки' },
  { id: 'loyalty', label: 'Программа лояльности' },
  { id: 'profile', label: 'Данные' },
] as const

const months = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
] as const

/** Названия месяцев в родительном падеже для дат: «4 ноября». */
const monthsGenitive = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
] as const

const pluralOrders = (count: number) =>
  count % 10 === 1 && count % 100 !== 11
    ? 'заказ'
    : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14)
      ? 'заказа'
      : 'заказов'

const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })

function orderSummary(order: Order) {
  const names = order.quote.lines.slice(0, 2).map((line) => `${line.name} × ${line.quantity}`)
  const rest = order.quote.lines.length - names.length
  return rest > 0 ? `${names.join(', ')} · ещё ${rest}` : names.join(', ')
}

function OrderDetailsCard({
  order,
  onRepeat,
  onComplete,
}: {
  order: Order
  onRepeat: (order: Order) => void
  onComplete?: (id: string) => void
}) {
  const completed = order.status === 'completed'
  const pickup = order.input.fulfillment.mode === 'pickup'
  const steps = [
    ['Создан', timeOf(order.createdAt)],
    ['Завершён тест', completed ? timeOf(order.completedAt ?? order.createdAt) : '—'],
  ]
  return (
    <article className={styles.orderCard}>
      <header className={styles.orderHeader}>
        <strong>Тестовый заказ №{order._id.slice(0, 6).toUpperCase()}</strong>
        <span className={styles.orderBadge}>
          {completed ? 'Выполнен (тест)' : 'Не передан в кафе'}
        </span>
      </header>
      <ol className={styles.orderSteps}>
        {steps.map(([stepLabel, stepSub], index) => (
          <li
            key={stepLabel}
            className={`${styles.orderStep} ${completed || index === 0 ? styles.orderStepActive : ''}`}
          >
            <span className={styles.orderDot} aria-hidden="true">
              {completed || index === 0 ? '✓' : index + 1}
            </span>
            <span className={styles.orderStepLabel}>{stepLabel}</span>
            <span className={styles.orderStepSub}>{stepSub}</span>
          </li>
        ))}
      </ol>
      <div className={styles.orderTiles}>
        <div className={styles.orderTile}>
          <span>Получение</span>
          <strong>
            {pickup
              ? `Самовывоз · ${order.input.fulfillment.label}`
              : order.input.fulfillment.label}
          </strong>
        </div>
        <div className={styles.orderTile}>
          <span>Оплата</span>
          <strong>Не требуется — тестовый режим</strong>
        </div>
        <div className={styles.orderTile}>
          <span>Бонусы</span>
          <strong>Не начисляются в тестовом режиме</strong>
        </div>
      </div>
      <ul className={styles.orderLines}>
        {order.quote.lines.map((line) => (
          <li key={`${order._id}-${line.name}`}>
            <span>
              {line.name} × {line.quantity}
            </span>
            <span>{(line.lineTotalKopecks / 100).toLocaleString('ru-RU')} ₽</span>
          </li>
        ))}
        {order.quote.discountKopecks > 0 && (
          <li>
            <span>Скидка самовывоза</span>
            <span>−{(order.quote.discountKopecks / 100).toLocaleString('ru-RU')} ₽</span>
          </li>
        )}
        {order.quote.deliveryKopecks > 0 && (
          <li>
            <span>Доставка</span>
            <span>{(order.quote.deliveryKopecks / 100).toLocaleString('ru-RU')} ₽</span>
          </li>
        )}
      </ul>
      <p className={styles.orderTotal}>
        <span>Итого</span>
        <strong>{(order.quote.totalKopecks / 100).toLocaleString('ru-RU')} ₽</strong>
      </p>
      <div className={styles.orderActions}>
        <button type="button" className={styles.repeatButton} onClick={() => onRepeat(order)}>
          Повторить заказ
        </button>
        {onComplete && (
          <button
            type="button"
            className={styles.completeButton}
            onClick={() => onComplete(order._id)}
          >
            Отметить выполненным (тест)
          </button>
        )}
      </div>
    </article>
  )
}

export function AccountScreen({
  user,
  ordersRevision = 0,
  onLogout,
  onUpdateUser,
  onAddressPicked,
}: AccountScreenProps) {
  const { section = 'orders' } = useParams()
  const [name, setName] = useState(user.name)
  const [email, setEmail] = useState('')
  const [savedEmail, setSavedEmail] = useState('')
  const [day, setDay] = useState('')
  const [month, setMonth] = useState('')
  const [year, setYear] = useState('')
  const [notifications, setNotifications] = useState({ push: false, email: false, sms: false })
  const [settingsBusy, setSettingsBusy] = useState(false)
  const settingsBusyRef = useRef(false)
  const [notice, setNotice] = useState('')
  const [orders, setOrders] = useState<Order[]>([])
  const [ordersError, setOrdersError] = useState('')
  const [ordersNextCursor, setOrdersNextCursor] = useState<string | null>(null)
  const [ordersLoadingMore, setOrdersLoadingMore] = useState(false)
  const ordersLoadMoreRef = useRef<HTMLDivElement | null>(null)
  const ordersRequestSeq = useRef(0)
  const ordersRevisionRef = useRef(ordersRevision)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [addresses, setAddresses] = useState<Address[]>([])
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null)
  const [selectionBusy, setSelectionBusy] = useState(false)
  const [addressDialog, setAddressDialog] = useState<
    { mode: 'add' } | { mode: 'edit'; address: Address } | null
  >(null)
  const [addressToDelete, setAddressToDelete] = useState<Address | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [logoutConfirmationOpen, setLogoutConfirmationOpen] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [expandedOrders, setExpandedOrders] = useState<ReadonlySet<string>>(new Set())
  const catalog = useCatalog()
  const accountRequest = useCallback(
    <T,>(path: string, init?: RequestInit): Promise<T> => {
      const headers = new Headers(init?.headers)
      headers.set('X-Account-Id', user.id)
      return apiRequest<T>(path, { ...init, headers })
    },
    [user.id],
  )

  useEffect(() => {
    ordersRevisionRef.current = ordersRevision
  }, [ordersRevision])

  const activeOrders = orders.filter((order) => order.status !== 'completed')
  const historyOrders = orders.filter((order) => order.status === 'completed')
  const historyGroups = (() => {
    const groups = new Map<string, { year: number; month: number; orders: Order[] }>()
    for (const order of historyOrders) {
      const date = new Date(order.completedAt ?? order.createdAt)
      const key = `${date.getFullYear()}-${date.getMonth()}`
      const group = groups.get(key) ?? {
        year: date.getFullYear(),
        month: date.getMonth(),
        orders: [],
      }
      group.orders.push(order)
      groups.set(key, group)
    }
    return [...groups.values()].map((group) => ({
      key: `${group.year}-${group.month}`,
      label: `${months[group.month]!} ${group.year}`,
      countLabel: `${group.orders.length} ${pluralOrders(group.orders.length)}`,
      orders: group.orders,
    }))
  })()

  function clearError(field: string) {
    setErrors((current) => {
      if (!(field in current)) return current
      const next = { ...current }
      delete next[field]
      return next
    })
  }

  useEffect(() => {
    let active = true
    const initialRevision = ordersRevisionRef.current
    Promise.allSettled([
      accountRequest<{
        profile: {
          name: string
          email: string
          birthday: string
          notifications: { push: boolean; email: boolean; sms: boolean }
          selectedAddressId: string | null
        }
      }>('/profile'),
      accountRequest<{ addresses: Address[] }>('/addresses'),
      accountRequest<{ orders: Order[]; nextCursor: string | null }>('/orders'),
    ])
      .then(([profileResult, addressResult, orderResult]) => {
        if (!active) return
        const rejected = [profileResult, addressResult, orderResult].filter(
          (result) => result.status === 'rejected',
        )
        if (
          rejected.some(
            (result) =>
              result.reason instanceof ApiError && result.reason.code === 'UNAUTHENTICATED',
          )
        ) {
          onLogout()
          return
        }
        if (
          rejected.some(
            (result) =>
              result.reason instanceof ApiError && result.reason.code === 'ACCOUNT_CHANGED',
          )
        )
          return
        if (profileResult.status === 'fulfilled') {
          const profile = profileResult.value.profile
          setName(profile.name)
          setEmail(profile.email)
          setSavedEmail(profile.email)
          const [y = '', m = '', d = ''] = profile.birthday.split('-')
          setYear(y)
          setMonth(m ? String(Number(m)) : '')
          setDay(d ? String(Number(d)) : '')
          setNotifications(profile.notifications)
        }
        if (addressResult.status === 'fulfilled') {
          const loadedAddresses = addressResult.value.addresses
          setAddresses(loadedAddresses)
          if (profileResult.status === 'fulfilled') {
            const savedSelection = profileResult.value.profile.selectedAddressId ?? null
            setSelectedAddressId(
              loadedAddresses.some((address) => address.id === savedSelection)
                ? savedSelection
                : null,
            )
          }
        }
        if (ordersRevisionRef.current === initialRevision) {
          if (orderResult.status === 'fulfilled') {
            setOrders(orderResult.value.orders)
            setOrdersNextCursor(orderResult.value.nextCursor)
            setOrdersError('')
          } else {
            setOrdersError('Не удалось загрузить заказы. Попробуйте ещё раз.')
          }
        }
        const otherFailure = [profileResult, addressResult].find(
          (result) => result.status === 'rejected',
        )
        if (otherFailure?.status === 'rejected') {
          // Профиль/адреса без повтора: экран остался бы пустым до перезагрузки.
          setLoadError(
            otherFailure.reason instanceof Error
              ? otherFailure.reason.message
              : 'Не удалось загрузить данные',
          )
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [accountRequest, onLogout, loadAttempt])

  const reloadOrders = useCallback(async () => {
    const seq = ++ordersRequestSeq.current
    setOrdersLoadingMore(false)
    setOrdersNextCursor(null)
    try {
      const result = await accountRequest<{ orders: Order[]; nextCursor: string | null }>('/orders')
      if (seq !== ordersRequestSeq.current) return
      setOrders(result.orders)
      setOrdersNextCursor(result.nextCursor)
      setOrdersError('')
    } catch (failure) {
      if (seq !== ordersRequestSeq.current) return
      setOrdersError(failure instanceof Error ? failure.message : 'Не удалось обновить заказы')
    }
  }, [accountRequest])

  useEffect(() => {
    if (ordersRevision === 0) return
    let active = true
    queueMicrotask(() => {
      if (active) void reloadOrders()
    })
    return () => {
      active = false
    }
  }, [ordersRevision, reloadOrders])

  async function loadMoreOrders() {
    if (!ordersNextCursor || ordersLoadingMore) return
    const seq = ++ordersRequestSeq.current
    setOrdersLoadingMore(true)
    try {
      const result = await accountRequest<{ orders: Order[]; nextCursor: string | null }>(
        `/orders?cursor=${encodeURIComponent(ordersNextCursor)}`,
      )
      if (seq !== ordersRequestSeq.current) return
      setOrders((current) => {
        // На случай, если за время запроса список сдвинулся (новый заказ, обновление),
        // дубли по _id отсекаем.
        const known = new Set(current.map((order) => order._id))
        return [...current, ...result.orders.filter((order) => !known.has(order._id))]
      })
      setOrdersNextCursor(result.nextCursor)
    } catch (failure) {
      if (seq === ordersRequestSeq.current)
        setNotice(failure instanceof Error ? failure.message : 'Не удалось загрузить заказы')
    } finally {
      if (seq === ordersRequestSeq.current) setOrdersLoadingMore(false)
    }
  }

  // Автодозагрузка следующей страницы при прокрутке к концу истории заказов.
  useEffect(() => {
    if (!ordersNextCursor || ordersLoadingMore) return
    if (typeof IntersectionObserver === 'undefined') return
    const node = ordersLoadMoreRef.current
    if (!node) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMoreOrders()
      },
      { rootMargin: '800px 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  })

  async function deleteAddress(id: string) {
    try {
      await accountRequest<void>(`/addresses/${encodeURIComponent(id)}`, { method: 'DELETE' })
      setAddresses((current) => current.filter((address) => address.id !== id))
      if (selectedAddressId === id) setSelectedAddressId(null)
    } catch (failure) {
      setNotice(failure instanceof Error ? failure.message : 'Не удалось удалить адрес')
    }
  }

  async function confirmDeleteAddress() {
    if (!addressToDelete) return
    setDeleteBusy(true)
    await deleteAddress(addressToDelete.id)
    setDeleteBusy(false)
    setAddressToDelete(null)
  }

  async function completeOrder(id: string) {
    try {
      const result = await accountRequest<{ order: Order }>(
        `/orders/${encodeURIComponent(id)}/complete`,
        { method: 'POST' },
      )
      setOrders((current) => current.map((order) => (order._id === id ? result.order : order)))
    } catch (failure) {
      setNotice(failure instanceof Error ? failure.message : 'Не удалось обновить заказ')
    }
  }

  function repeatOrder(order: Order) {
    if (!catalog?.data) {
      // Отделяем «меню не загрузилось» от «блюдо снято с меню» — иначе сообщение вводило в заблуждение.
      setNotice(
        catalog?.error
          ? 'Не удалось повторить заказ: меню не загрузилось. Обновите страницу и попробуйте снова.'
          : 'Меню ещё загружается. Подождите несколько секунд и повторите.',
      )
      return
    }
    const products = catalog.data.categories.flatMap((category) => category.products)
    const missing = order.quote.lines.find(
      (line) => !products.some((product) => product._id === line.productId && product.available),
    )
    if (missing) {
      setNotice(`Не удалось повторить заказ: «${missing.name}» сейчас недоступен.`)
      return
    }
    for (const line of order.quote.lines) {
      const live = products.find((product) => product._id === line.productId)!
      useCartStore.getState().add(
        {
          id: line.productId,
          name: live.name,
          image: live.image,
          priceRub: live.priceKopecks / 100,
        },
        { variant: '', removedIngredients: [], extras: {}, quantity: line.quantity },
      )
    }
    useCartStore.getState().open()
    setNotice('Состав заказа добавлен в корзину')
  }

  function toggleOrderExpanded(id: string) {
    setExpandedOrders((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function saveSelection(addressId: string) {
    if (selectionBusy) return
    const previous = selectedAddressId
    setSelectionBusy(true)
    setSelectedAddressId(addressId)
    void accountRequest('/profile/delivery-selection', {
      method: 'PUT',
      body: JSON.stringify({ addressId }),
    })
      .then(() => onAddressPicked?.())
      .catch((failure) => {
        setSelectedAddressId(previous)
        setNotice(failure instanceof Error ? failure.message : 'Не удалось сохранить выбор адреса')
      })
      .finally(() => setSelectionBusy(false))
  }

  async function saveProfile(nextNotifications = notifications) {
    if (settingsBusyRef.current) return
    const profile = profileSchema.safeParse({ name, email })
    const birthDate = birthDateSchema.safeParse({ day, month, year })
    if (!profile.success || !birthDate.success) {
      setErrors(
        issuesByField([
          ...(profile.success ? [] : profile.error.issues),
          ...(birthDate.success ? [] : birthDate.error.issues),
        ]),
      )
      return
    }
    const birthday =
      day && month && year ? `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}` : ''
    settingsBusyRef.current = true
    setSettingsBusy(true)
    try {
      await accountRequest('/profile', {
        method: 'PUT',
        body: JSON.stringify({
          name: profile.data.name,
          email: profile.data.email,
          birthday,
          notifications: nextNotifications,
        }),
      })
      onUpdateUser({ ...user, name: profile.data.name })
      setSavedEmail(profile.data.email)
      setNotice('Личные данные сохранены')
      setErrors({})
    } catch (failure) {
      setNotice(failure instanceof Error ? failure.message : 'Не удалось сохранить профиль')
    } finally {
      settingsBusyRef.current = false
      setSettingsBusy(false)
    }
  }

  async function saveNotification(key: 'push' | 'email' | 'sms', checked: boolean) {
    if (settingsBusyRef.current) return
    settingsBusyRef.current = true
    setSettingsBusy(true)
    const previous = notifications
    setNotifications({ ...previous, [key]: checked })
    try {
      const result = await accountRequest<{ notifications: typeof notifications }>(
        '/profile/notifications',
        {
          method: 'PUT',
          body: JSON.stringify({ ...previous, [key]: checked }),
        },
      )
      setNotifications(result.notifications)
    } catch (failure) {
      setNotifications(previous)
      setNotice(failure instanceof Error ? failure.message : 'Не удалось сохранить настройки')
    } finally {
      settingsBusyRef.current = false
      setSettingsBusy(false)
    }
  }

  if (!sections.some(({ id }) => id === section)) return <Navigate to="/account/orders" replace />
  if (loading)
    return (
      <main className={`${styles.root} ${styles.loading}`}>
        <Spinner label="Загружаем личный кабинет…" />
      </main>
    )

  return (
    <main className={styles.root}>
      <nav className={styles.breadcrumbs} aria-label="Навигационная цепочка">
        <Link to="/">Главная</Link>
        <span aria-hidden="true">/</span>
        <span>Личный кабинет</span>
      </nav>
      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <div className={styles.identity}>
            <span className={styles.avatar} aria-hidden="true">
              {user.name.trim().charAt(0).toUpperCase() || 'Г'}
            </span>
            <div>
              <strong>{user.name}</strong>
              <span>{user.phone}</span>
            </div>
          </div>
          <nav className={styles.navigation} aria-label="Разделы личного кабинета">
            {sections.map((item) => (
              <Link
                key={item.id}
                to={`/account/${item.id}`}
                className={section === item.id ? styles.active : ''}
                aria-current={section === item.id ? 'page' : undefined}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <button
            className={styles.logout}
            type="button"
            onClick={() => setLogoutConfirmationOpen(true)}
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M10 5H5v14h5M14 8l4 4-4 4M8 12h10" />
            </svg>
            Выйти
          </button>
        </aside>

        <div className={styles.content}>
          {loadError && (
            <div className={styles.loadError} role="alert">
              <p>{loadError}</p>
              <button
                type="button"
                onClick={() => {
                  setLoadError('')
                  setLoading(true)
                  setLoadAttempt((attempt) => attempt + 1)
                }}
              >
                Повторить загрузку
              </button>
            </div>
          )}
          {notice && (
            <p className={styles.notice} role="status">
              {notice}
            </p>
          )}
          {section === 'orders' && (
            <section className={styles.card} aria-labelledby="orders-title">
              <span className={styles.eyebrow}>ВАШИ ЗАКАЗЫ</span>
              <h1 id="orders-title">Активные заказы</h1>
              <p>Тестовый режим — заказы не передаются в кафе.</p>
              {ordersError && (
                <div role="alert">
                  <p>{ordersError}</p>
                  <button type="button" onClick={() => void reloadOrders()}>
                    Повторить загрузку заказов
                  </button>
                </div>
              )}
              {!ordersError && orders.length === 0 ? (
                <div className={styles.emptyOrders}>
                  <svg
                    className={styles.emptyIcon}
                    viewBox="0 0 64 64"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M10 47h44" strokeLinecap="round" />
                    <path d="M17 47a15 15 0 0 1 30 0" strokeLinecap="round" />
                    <path d="M32 32v-5" strokeLinecap="round" />
                    <circle cx="32" cy="24" r="2.5" />
                    <path d="M24 15c0-2 2-2.5 2-4.5M32 15c0-2 2-2.5 2-4.5" strokeLinecap="round" />
                    <path
                      d="m49 14 1.4 2.8 2.8 1.4-2.8 1.4L49 22.4l-1.4-2.8-2.8-1.4 2.8-1.4Z"
                      fill="var(--color-gold)"
                      stroke="none"
                    />
                  </svg>
                  <p>Тестовых заказов пока нет.</p>
                  <p className={styles.emptyHint}>
                    Оформите тестовый заказ в корзине — он появится здесь.
                  </p>
                </div>
              ) : (
                activeOrders.map((order) => (
                  <OrderDetailsCard
                    key={order._id}
                    order={order}
                    onRepeat={repeatOrder}
                    onComplete={(id) => void completeOrder(id)}
                  />
                ))
              )}
              {historyGroups.length > 0 && (
                <div className={styles.history}>
                  <h2>История заказов</h2>
                  {historyGroups.map((group) => (
                    <div className={styles.historyGroup} key={group.key}>
                      <p className={styles.historyGroupTitle}>
                        <span>{group.label}</span>
                        <span>{group.countLabel}</span>
                      </p>
                      {group.orders.map((order) => {
                        const done = new Date(order.completedAt ?? order.createdAt)
                        const expanded = expandedOrders.has(order._id)
                        return (
                          <div key={order._id}>
                            <button
                              type="button"
                              className={styles.historyRow}
                              aria-expanded={expanded}
                              onClick={() => toggleOrderExpanded(order._id)}
                            >
                              <span className={styles.historyRowMain}>
                                <span className={styles.historyDate}>
                                  {done.getDate()} {monthsGenitive[done.getMonth()]}
                                </span>
                                <span className={styles.historySummary}>{orderSummary(order)}</span>
                              </span>
                              <span className={styles.historyTotal}>
                                {(order.quote.totalKopecks / 100).toLocaleString('ru-RU')} ₽
                              </span>
                            </button>
                            {expanded && <OrderDetailsCard order={order} onRepeat={repeatOrder} />}
                          </div>
                        )
                      })}
                    </div>
                  ))}
                </div>
              )}
              {ordersNextCursor && (
                <>
                  {/* Сторожок: следующая страница заказов подгружается сама при прокрутке */}
                  <div ref={ordersLoadMoreRef} aria-hidden="true" />
                  <button
                    type="button"
                    className={styles.loadMore}
                    disabled={ordersLoadingMore}
                    onClick={() => void loadMoreOrders()}
                  >
                    {ordersLoadingMore ? 'Загружаем…' : 'Загрузить ещё заказы'}
                  </button>
                </>
              )}
            </section>
          )}

          {section === 'addresses' && (
            <section className={styles.addresses} aria-labelledby="addresses-title">
              <h1 className={styles.visuallyHidden} id="addresses-title">
                Адреса доставки
              </h1>
              {addresses.map((address) => (
                <div
                  className={`${styles.card} ${styles.addressCard} ${selectedAddressId === address.id ? styles.selectedAddress : ''}`}
                  key={address.id}
                >
                  <label className={styles.addressMain}>
                    <input
                      className={styles.addressRadio}
                      type="radio"
                      name="delivery-address"
                      value={address.id}
                      checked={selectedAddressId === address.id}
                      disabled={selectionBusy}
                      onChange={() => saveSelection(address.id)}
                    />
                    <span className={styles.radioMark} aria-hidden="true" />
                    <span className={styles.addressIcon} aria-hidden="true">
                      ⌂
                    </span>
                    <span className={styles.addressInfo}>
                      <strong title={address.label}>{displayAddress(address)}</strong>
                      <span>Доставка</span>
                    </span>
                    <span className={styles.addressStatus}>
                      {selectedAddressId === address.id ? 'Выбран' : 'Выбрать'}
                    </span>
                  </label>
                  <span className={styles.addressActions}>
                    <button
                      className={styles.actionButton}
                      type="button"
                      aria-label={`Изменить адрес: ${address.label}`}
                      title="Изменить адрес"
                      onClick={() => setAddressDialog({ mode: 'edit', address })}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                        <path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
                        <path d="m13.5 6.5 3 3" />
                      </svg>
                    </button>
                    <button
                      className={styles.actionButton}
                      type="button"
                      aria-label={`Удалить адрес: ${address.label}`}
                      title="Удалить адрес"
                      disabled={selectionBusy}
                      onClick={() => setAddressToDelete(address)}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                        <path d="M5 7h14M10 7V5h4v2m-6 0 1 12h6l1-12" />
                      </svg>
                    </button>
                  </span>
                </div>
              ))}
              <button
                className={styles.addAddress}
                type="button"
                onClick={() => setAddressDialog({ mode: 'add' })}
              >
                <span aria-hidden="true">+</span>
                Добавить новый адрес
              </button>
            </section>
          )}

          {section === 'loyalty' && (
            <section className={styles.card} aria-labelledby="loyalty-title">
              <span className={styles.eyebrow}>ПРОГРАММА ЛОЯЛЬНОСТИ</span>
              <h1 id="loyalty-title">
                Ваш кешбэк <span className={styles.points}>★ 0 баллов</span>
              </h1>
              <h2>Как потратить баллы</h2>
              <ul className={styles.loyaltyList}>
                <li>Накапливайте баллы с каждого заказа.</li>
                <li>Чем больше сумма заказов, тем выше процент кешбэка.</li>
                <li>
                  По правилам сайта можно списать до 30% следующего заказа. В тестовом режиме
                  списание не работает.
                </li>
              </ul>
            </section>
          )}

          {section === 'profile' && (
            <div className={styles.profileSections}>
              <section className={styles.card} aria-labelledby="profile-title">
                <span className={styles.eyebrow}>ПРОФИЛЬ</span>
                <h1 id="profile-title">Личные данные</h1>
                <form
                  className={styles.profileForm}
                  onSubmit={(event) => {
                    event.preventDefault()
                    void saveProfile()
                  }}
                >
                  <div className={styles.fieldGroup}>
                    <label className={styles.field}>
                      Имя
                      <input
                        value={name}
                        aria-invalid={Boolean(errors.name)}
                        aria-describedby={errors.name ? 'profile-name-error' : undefined}
                        onChange={(event) => {
                          setName(event.target.value)
                          clearError('name')
                        }}
                      />
                    </label>
                    {errors.name && (
                      <p className={styles.error} id="profile-name-error" role="alert">
                        {errors.name}
                      </p>
                    )}
                  </div>
                  <div className={styles.fieldGroup}>
                    <label className={styles.field}>
                      Телефон
                      <input value={user.phone} readOnly aria-readonly="true" />
                    </label>
                  </div>
                  <div className={`${styles.fieldGroup} ${styles.fullRow}`}>
                    <label className={styles.field}>
                      Эл. почта
                      <input
                        type="email"
                        autoComplete="email"
                        value={email}
                        aria-invalid={Boolean(errors.email)}
                        aria-describedby={errors.email ? 'profile-email-error' : undefined}
                        onChange={(event) => {
                          setEmail(event.target.value)
                          clearError('email')
                        }}
                        placeholder="name@example.ru"
                      />
                    </label>
                    {errors.email && (
                      <p className={styles.error} id="profile-email-error" role="alert">
                        {errors.email}
                      </p>
                    )}
                  </div>
                  <div className={`${styles.fieldGroup} ${styles.fullRow}`}>
                    <fieldset
                      className={styles.birthDate}
                      aria-describedby={errors.day ? 'profile-birthdate-error' : undefined}
                    >
                      <legend>Дата рождения</legend>
                      <label>
                        <span className={styles.visuallyHidden}>День</span>
                        <select
                          value={day}
                          onChange={(event) => {
                            setDay(event.target.value)
                            clearError('day')
                          }}
                        >
                          <option value="">День</option>
                          {Array.from({ length: 31 }, (_, index) => (
                            <option key={index + 1} value={index + 1}>
                              {index + 1}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span className={styles.visuallyHidden}>Месяц</span>
                        <select
                          value={month}
                          onChange={(event) => {
                            setMonth(event.target.value)
                            clearError('day')
                          }}
                        >
                          <option value="">Месяц</option>
                          {months.map((item, index) => (
                            <option key={item} value={index + 1}>
                              {item}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span className={styles.visuallyHidden}>Год</span>
                        <select
                          value={year}
                          onChange={(event) => {
                            setYear(event.target.value)
                            clearError('day')
                          }}
                        >
                          <option value="">Год</option>
                          {Array.from({ length: 91 }, (_, index) => 2010 - index).map((item) => (
                            <option key={item} value={item}>
                              {item}
                            </option>
                          ))}
                        </select>
                      </label>
                    </fieldset>
                    {errors.day && (
                      <p className={styles.error} id="profile-birthdate-error" role="alert">
                        {errors.day}
                      </p>
                    )}
                  </div>
                  <button className={styles.save} type="submit" disabled={settingsBusy}>
                    Сохранить
                  </button>
                </form>
              </section>

              <section className={styles.card} aria-labelledby="notifications-title">
                <h2 id="notifications-title">Уведомления и рассылки</h2>
                <p>Персональные предложения, новости, акции и скидки.</p>
                <div className={styles.notifications}>
                  {(
                    [
                      ['push', 'Push-уведомления'],
                      ['email', 'Email-рассылки'],
                      ['sms', 'SMS-уведомления'],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key} className={!savedEmail && key === 'email' ? styles.muted : ''}>
                      <input
                        type="checkbox"
                        checked={notifications[key]}
                        disabled={settingsBusy || (key === 'email' && !savedEmail)}
                        onChange={(event) => void saveNotification(key, event.target.checked)}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
      {addressToDelete && (
        <Dialog
          titleId="delete-address-title"
          onClose={() => {
            if (!deleteBusy) setAddressToDelete(null)
          }}
          className={styles.confirmDialog}
        >
          <div className={styles.confirmContent}>
            <h2 id="delete-address-title">Удалить адрес?</h2>
            <p>«{displayAddress(addressToDelete)}» будет удалён без возможности восстановления.</p>
            <div className={styles.confirmActions}>
              <button
                type="button"
                className={styles.confirmCancel}
                onClick={() => setAddressToDelete(null)}
                disabled={deleteBusy}
              >
                Отмена
              </button>
              <button
                type="button"
                className={styles.confirmDelete}
                onClick={() => void confirmDeleteAddress()}
                disabled={deleteBusy}
              >
                {deleteBusy ? 'Удаляем…' : 'Удалить'}
              </button>
            </div>
          </div>
        </Dialog>
      )}
      {logoutConfirmationOpen && (
        <Dialog
          titleId="logout-confirm-title"
          onClose={() => setLogoutConfirmationOpen(false)}
          className={styles.confirmDialog}
        >
          <div className={styles.confirmContent}>
            <h2 id="logout-confirm-title">Выйти из аккаунта?</h2>
            <p>Для следующего входа потребуется снова подтвердить номер телефона.</p>
            <div className={styles.confirmActions}>
              <button
                type="button"
                className={styles.confirmCancel}
                onClick={() => setLogoutConfirmationOpen(false)}
              >
                Остаться
              </button>
              <button
                type="button"
                className={styles.confirmDelete}
                onClick={() => {
                  setLogoutConfirmationOpen(false)
                  onLogout()
                }}
              >
                Да, выйти
              </button>
            </div>
          </div>
        </Dialog>
      )}
      {addressDialog && (
        <FulfillmentDialog
          current={addressDialog.mode === 'edit' ? addressDialog.address : undefined}
          onClose={() => setAddressDialog(null)}
          onSave={(selection) => {
            const editing = addressDialog.mode === 'edit' ? addressDialog.address : null
            void accountRequest<{ address: Address }>(
              editing ? `/addresses/${encodeURIComponent(editing.id)}` : '/addresses',
              {
                method: editing ? 'PUT' : 'POST',
                body: JSON.stringify({ label: selection.label, details: selection.details }),
              },
            )
              .then(({ address }) => {
                if (editing)
                  setAddresses((current) =>
                    current.map((item) => (item.id === editing.id ? address : item)),
                  )
                else {
                  setAddresses((current) => [...current, address])
                  saveSelection(address.id)
                }
                setAddressDialog(null)
              })
              .catch((failure) =>
                setNotice(
                  failure instanceof Error ? failure.message : 'Не удалось сохранить адрес',
                ),
              )
          }}
        />
      )}
    </main>
  )
}

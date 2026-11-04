import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router'
import {
  FulfillmentDialog,
  type FulfillmentSelection,
} from '../../features/fulfillment/ui/FulfillmentDialog/FulfillmentDialog'
import { birthDateSchema, profileSchema } from '../../../shared/validation/profile'
import { issuesByField } from '../../../shared/validation/issues'
import styles from './AccountScreen.module.css'
import { ApiError, apiRequest } from '../../features/auth/api/authApi'

export type AccountUser = {
  name: string
  phone: string
}

type AccountScreenProps = {
  user: AccountUser
  onLogout: () => void
  onUpdateUser: (user: AccountUser) => void
}

type Address = FulfillmentSelection & { id: string }
type Order = {
  _id: string
  quote: { totalKopecks: number; lines: { name: string; quantity: number }[] }
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
]

export function AccountScreen({ user, onLogout, onUpdateUser }: AccountScreenProps) {
  const { section = 'orders' } = useParams()
  const [name, setName] = useState(user.name)
  const [email, setEmail] = useState('')
  const [savedEmail, setSavedEmail] = useState('')
  const [day, setDay] = useState('')
  const [month, setMonth] = useState('')
  const [year, setYear] = useState('')
  const [notifications, setNotifications] = useState({ push: false, email: false, sms: false })
  const [notice, setNotice] = useState('')
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [addresses, setAddresses] = useState<Address[]>([])
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null)
  const [addressDialog, setAddressDialog] = useState<
    { mode: 'add' } | { mode: 'edit'; address: Address } | null
  >(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

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
    Promise.all([
      apiRequest<{
        profile: {
          name: string
          email: string
          birthday: string
          notifications: { push: boolean; email: boolean; sms: boolean }
        }
      }>('/profile'),
      apiRequest<{ addresses: Address[] }>('/addresses'),
      apiRequest<{ orders: Order[] }>('/orders'),
    ])
      .then(([profileResult, addressResult, orderResult]) => {
        if (!active) return
        setName(profileResult.profile.name)
        setEmail(profileResult.profile.email)
        setSavedEmail(profileResult.profile.email)
        const [y = '', m = '', d = ''] = profileResult.profile.birthday.split('-')
        setYear(y)
        setMonth(m ? String(Number(m)) : '')
        setDay(d ? String(Number(d)) : '')
        setNotifications(profileResult.profile.notifications)
        setAddresses(addressResult.addresses)
        setOrders(orderResult.orders)
      })
      .catch((failure) => {
        if (!active) return
        if (failure instanceof ApiError && failure.code === 'UNAUTHENTICATED') {
          onLogout()
          return
        }
        setNotice(failure instanceof Error ? failure.message : 'Не удалось загрузить данные')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [onLogout])

  async function deleteAddress(id: string) {
    try {
      await apiRequest<void>(`/addresses/${encodeURIComponent(id)}`, { method: 'DELETE' })
      setAddresses((current) => current.filter((address) => address.id !== id))
      setSelectedAddressId((current) => (current === id ? null : current))
    } catch (failure) {
      setNotice(failure instanceof Error ? failure.message : 'Не удалось удалить адрес')
    }
  }

  async function saveProfile(nextNotifications = notifications) {
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
    try {
      await apiRequest('/profile', {
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
    }
  }

  if (!sections.some(({ id }) => id === section)) return <Navigate to="/account/orders" replace />
  if (loading)
    return (
      <main className={styles.root} role="status">
        Загружаем личный кабинет…
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
          <button className={styles.logout} type="button" onClick={onLogout}>
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M10 5H5v14h5M14 8l4 4-4 4M8 12h10" />
            </svg>
            Выйти
          </button>
        </aside>

        <div className={styles.content}>
          {section === 'orders' && (
            <section className={styles.card} aria-labelledby="orders-title">
              <span className={styles.eyebrow}>ВАШИ ЗАКАЗЫ</span>
              <h1 id="orders-title">Активные заказы</h1>
              <p>Тестовый режим — заказы не передаются в кафе.</p>
              {loading ? (
                <p role="status">Загружаем заказы…</p>
              ) : orders.length === 0 ? (
                <p>Тестовых заказов пока нет.</p>
              ) : (
                orders.map((order) => (
                  <article key={order._id}>
                    <strong>Тестовый заказ {order._id.slice(0, 8)}</strong>
                    <p>
                      {order.quote.lines
                        .map((line) => `${line.name} × ${line.quantity}`)
                        .join(', ')}
                    </p>
                    <p>{(order.quote.totalKopecks / 100).toLocaleString('ru-RU')} ₽</p>
                  </article>
                ))
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
                      onChange={() => setSelectedAddressId(address.id)}
                    />
                    <span className={styles.radioMark} aria-hidden="true" />
                    <span className={styles.addressIcon} aria-hidden="true">
                      ⌂
                    </span>
                    <span className={styles.addressInfo}>
                      <strong>{address.label}</strong>
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
                      onClick={() => void deleteAddress(address.id)}
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
                  <button className={styles.save} type="submit">
                    Сохранить
                  </button>
                </form>
                {notice && (
                  <p className={styles.notice} role="status">
                    {notice}
                  </p>
                )}
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
                        disabled={key === 'email' && !savedEmail}
                        onChange={(event) => {
                          const next = { ...notifications, [key]: event.target.checked }
                          setNotifications(next)
                          void apiRequest('/profile/notifications', {
                            method: 'PUT',
                            body: JSON.stringify(next),
                          }).catch((failure) => {
                            setNotifications(notifications)
                            setNotice(
                              failure instanceof Error
                                ? failure.message
                                : 'Не удалось сохранить настройки',
                            )
                          })
                        }}
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
      {addressDialog && (
        <FulfillmentDialog
          allowPickup={false}
          current={addressDialog.mode === 'edit' ? addressDialog.address : undefined}
          onClose={() => setAddressDialog(null)}
          onSave={(selection) => {
            const editing = addressDialog.mode === 'edit' ? addressDialog.address : null
            void apiRequest<{ address: Address }>(
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
                  setSelectedAddressId(address.id)
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

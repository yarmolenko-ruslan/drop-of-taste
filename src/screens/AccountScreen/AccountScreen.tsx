import { useState } from 'react'
import { Link, Navigate, useParams } from 'react-router'
import {
  FulfillmentDialog,
  type FulfillmentSelection,
} from '../../features/fulfillment/ui/FulfillmentDialog/FulfillmentDialog'
import styles from './AccountScreen.module.css'

export type AccountUser = {
  name: string
  phone: string
}

type AccountScreenProps = {
  user: AccountUser
  onLogout: () => void
  onUpdateUser: (user: AccountUser) => void
}

type Address = FulfillmentSelection & { id: number }

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
  const [day, setDay] = useState('')
  const [month, setMonth] = useState('')
  const [year, setYear] = useState('')
  const [notifications, setNotifications] = useState({ push: true, email: false, sms: true })
  const [notice, setNotice] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [addresses, setAddresses] = useState<Address[]>([])
  const [selectedAddressId, setSelectedAddressId] = useState<number | null>(null)
  const [addressDialog, setAddressDialog] = useState<
    { mode: 'add' } | { mode: 'edit'; address: Address } | null
  >(null)

  function deleteAddress(id: number) {
    setAddresses((current) => current.filter((address) => address.id !== id))
    setSelectedAddressId((current) => (current === id ? null : current))
  }

  if (!sections.some(({ id }) => id === section)) return <Navigate to="/account/orders" replace />

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
                      onClick={() => deleteAddress(address.id)}
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
                <li>Списывайте до 10% от суммы следующего заказа.</li>
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
                    onUpdateUser({ ...user, name: name.trim() })
                    setNotice('Личные данные сохранены')
                    setConfirmDelete(false)
                  }}
                >
                  <label className={styles.field}>
                    Имя
                    <input
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      required
                    />
                  </label>
                  <label className={styles.field}>
                    Телефон
                    <input value={user.phone} readOnly aria-readonly="true" />
                  </label>
                  <label className={styles.field}>
                    Эл. почта
                    <input
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="name@example.ru"
                    />
                  </label>
                  <fieldset className={styles.birthDate}>
                    <legend>Дата рождения</legend>
                    <label>
                      <span className={styles.visuallyHidden}>День</span>
                      <select value={day} onChange={(event) => setDay(event.target.value)}>
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
                      <select value={month} onChange={(event) => setMonth(event.target.value)}>
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
                      <select value={year} onChange={(event) => setYear(event.target.value)}>
                        <option value="">Год</option>
                        {Array.from({ length: 91 }, (_, index) => 2010 - index).map((item) => (
                          <option key={item} value={item}>
                            {item}
                          </option>
                        ))}
                      </select>
                    </label>
                  </fieldset>
                  <button className={styles.save} type="submit">
                    Сохранить
                  </button>
                </form>
                {notice && (
                  <p className={styles.notice} role="status">
                    {notice}
                  </p>
                )}
                {confirmDelete ? (
                  <div className={styles.deleteConfirmation}>
                    <span>Удалить демонстрационный профиль?</span>
                    <button type="button" onClick={onLogout}>
                      Да, удалить
                    </button>
                    <button type="button" onClick={() => setConfirmDelete(false)}>
                      Отмена
                    </button>
                  </div>
                ) : (
                  <button
                    className={styles.delete}
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                  >
                    Удалить профиль
                  </button>
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
                    <label key={key} className={!email && key === 'email' ? styles.muted : ''}>
                      <input
                        type="checkbox"
                        checked={notifications[key]}
                        disabled={key === 'email' && !email}
                        onChange={(event) =>
                          setNotifications((current) => ({
                            ...current,
                            [key]: event.target.checked,
                          }))
                        }
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
            if (addressDialog.mode === 'edit') {
              const id = addressDialog.address.id
              setAddresses((current) => current.map((item) => (item.id === id ? { ...selection, id } : item)))
            } else {
              const id = Date.now()
              setAddresses((current) => [...current, { ...selection, id }])
              setSelectedAddressId(id)
            }
            setAddressDialog(null)
          }}
        />
      )}
    </main>
  )
}

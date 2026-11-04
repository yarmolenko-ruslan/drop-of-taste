import { useState } from 'react'
import { Link } from 'react-router'
import styles from './PromotionsScreen.module.css'

type Filter = 'all' | 'delivery' | 'pickup' | 'cafe'

type Promotion = {
  id: string
  category: Exclude<Filter, 'all'>
  badge: string
  title: string
  subtitle: string
  description: string
  conditions: string
  action: string
  href?: string
  theme: 'red' | 'cream' | 'burgundy' | 'gold' | 'green' | 'white'
}

const promotions: Promotion[] = [
  {
    id: 'birthday',
    category: 'delivery',
    badge: 'ДЕНЬ РОЖДЕНИЯ',
    title: '−10%',
    subtitle: 'Скидка 10% в день рождения',
    description: 'Поздравляем вкусно: скидка на весь заказ в ваш праздник.',
    conditions:
      'Действует по паспорту при получении. В день рождения и три дня после. Скидки и бонусы не суммируются.',
    action: 'В меню',
    href: '/menu/combo',
    theme: 'red',
  },
  {
    id: 'pickup',
    category: 'pickup',
    badge: 'САМОВЫВОЗ',
    title: '−10%',
    subtitle: 'Скидка на самовывоз',
    description: 'Заберите заказ в нашем кафе — скидка применится при оформлении.',
    conditions:
      'Скидка действует при выборе самовывоза. Не суммируется с другими специальными предложениями.',
    action: 'Выбрать блюда',
    href: '/menu/combo',
    theme: 'cream',
  },
  {
    id: 'lunch',
    category: 'cafe',
    badge: 'КОМБО',
    title: 'Обед как дома',
    subtitle: 'Комбо-обед по выгодной цене',
    description: 'Суп, горячее и морс по будням с 12:00 до 16:00.',
    conditions:
      'Предложение действует в кафе по будням с 12:00 до 16:00. Состав зависит от наличия блюд.',
    action: 'Выбрать',
    href: '/menu/combo',
    theme: 'burgundy',
  },
  {
    id: 'bonus',
    category: 'delivery',
    badge: 'БОНУСЫ',
    title: '5% бонусами',
    subtitle: 'Возвращаем бонусы с каждого заказа',
    description: 'Войдите по номеру телефона и оплачивайте бонусами до 30% заказа.',
    conditions:
      'Бонусы начисляются после выполнения заказа. Для участия необходимо войти в личный кабинет.',
    action: 'Войти',
    theme: 'white',
  },
  {
    id: 'first-order',
    category: 'delivery',
    badge: 'ПЕРВЫЙ ЗАКАЗ',
    title: 'Пирожки в подарок',
    subtitle: 'Подарок к первому заказу',
    description: 'Положим пирожки к первому заказу на сайте от 1000 ₽.',
    conditions:
      'Предложение действует один раз для нового пользователя при заказе от 1000 ₽. Подарок не заменяется денежной компенсацией.',
    action: 'В меню',
    href: '/menu/bakery',
    theme: 'gold',
  },
  {
    id: 'breakfast',
    category: 'cafe',
    badge: 'В КАФЕ',
    title: 'Завтраки до 12:00',
    subtitle: 'Утро в «Капеле вкуса»',
    description: 'Каши, сырники или омлет с кофе — по специальной цене в кафе.',
    conditions:
      'Завтраки доступны ежедневно до 12:00 в кафе. Актуальный состав уточняйте у сотрудников.',
    action: 'Адрес кафе',
    href: '/about',
    theme: 'green',
  },
]

const filters: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'delivery', label: 'Доставка' },
  { id: 'pickup', label: 'Самовывоз' },
  { id: 'cafe', label: 'В кафе' },
]

export function PromotionsScreen({ onLogin }: { onLogin?: () => void }) {
  const [filter, setFilter] = useState<Filter>('all')
  const visible = promotions.filter((item) => filter === 'all' || item.category === filter)

  return (
    <main className={styles.root}>
      <nav className={styles.breadcrumbs} aria-label="Навигационная цепочка">
        <Link to="/">Главная</Link>
        <span aria-hidden="true">/</span>
        <span>Акции</span>
      </nav>
      <div className={styles.headingRow}>
        <h1>Акции</h1>
        <div className={styles.filters} role="group" aria-label="Фильтр акций">
          {filters.map((item) => (
            <button
              type="button"
              key={item.id}
              className={filter === item.id ? styles.active : ''}
              aria-pressed={filter === item.id}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <p>
        В локальном тестовом режиме действуют только показанные в расчёте условия самовывоза и
        доставки. Остальные акции опубликованы как шаблон и пока не применяются к заказу.
      </p>
      <div className={styles.grid}>
        {visible.map((promotion) => (
          <article className={styles.card} key={promotion.id}>
            <div className={`${styles.banner} ${styles[promotion.theme]}`}>
              <span>{promotion.badge}</span>
              <h2>{promotion.title}</h2>
            </div>
            <div className={styles.body}>
              <h3>{promotion.subtitle}</h3>
              <p>{promotion.description}</p>
              <details className={styles.conditions}>
                <summary>Условия акции</summary>
                <p>{promotion.conditions}</p>
              </details>
              {promotion.href ? (
                <Link className={styles.action} to={promotion.href}>
                  {promotion.action}
                </Link>
              ) : (
                <button className={styles.action} type="button" onClick={onLogin}>
                  {promotion.action}
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </main>
  )
}

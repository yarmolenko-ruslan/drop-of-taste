import { Link, useLocation } from 'react-router'
import styles from './SiteHeader.module.css'

const categories = [
  ['Акции', 'promotions'],
  ['Новинки', 'new'],
  ['Комбо', 'combo'],
  ['Завтраки', 'breakfast'],
  ['Салаты', 'salads'],
  ['Супы', 'soups'],
  ['Горячее', 'hot'],
  ['На сковороде', 'pan'],
  ['Выпечка', 'bakery'],
  ['Десерты', 'desserts'],
  ['Напитки', 'drinks'],
  ['Соусы', 'sauces'],
] as const

type SiteHeaderProps = {
  phoneNumber?: string
}

export function SiteHeader({ phoneNumber }: SiteHeaderProps) {
  const dialNumber = phoneNumber?.replace(/[^+\d]/g, '')
  const isHome = useLocation().pathname === '/'

  return (
    <header className={styles.header}>
      <div className={styles.utilityBar}>
        <div className={styles.container}>
          <span>Ежедневно 08:00–22:00</span>
          <nav className={styles.utilityLinks} aria-label="Информация">
            <a href={`${isHome ? '' : '/'}#promotions`}>Акции</a>
            <a href={`${isHome ? '' : '/'}#delivery`}>Доставка и оплата</a>
            <a href={`${isHome ? '' : '/'}#contacts`}>Контакты</a>
            <a href={`${isHome ? '' : '/'}#about`}>О нас</a>
            <a href={`${isHome ? '' : '/'}#vacancies`}>Вакансии</a>
          </nav>
        </div>
      </div>

      <div className={styles.mainBar}>
        <div className={`${styles.container} ${styles.mainContent}`}>
          <Link className={styles.brand} to="/" aria-label="Капела вкуса — главная">
            <img src="/brand-emblem.png" alt="" width="64" height="64" />
            <span className={styles.brandText}>
              <span className={styles.brandName}>КАПЕЛА ВКУСА</span>
              <span className={styles.brandTagline}>
                <span className={styles.taglineRule} aria-hidden="true" />
                <span>ДОМАШНЯЯ КУХНЯ</span>
                <span className={styles.taglineDot} aria-hidden="true">
                  •
                </span>
                <span>КАФЕ</span>
                <span className={styles.taglineRule} aria-hidden="true" />
              </span>
            </span>
          </Link>

          <button className={styles.address} type="button" aria-label="Указать адрес доставки">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 21s7-5.3 7-11a7 7 0 1 0-14 0c0 5.7 7 11 7 11Z" />
              <circle cx="12" cy="10" r="2.5" />
            </svg>
            <span>
              <span className={styles.addressLabel}>Адрес доставки</span>
              <strong>Укажите адрес</strong>
            </span>
          </button>

          <div className={styles.search} role="search">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="10.8" cy="10.8" r="6.4" />
              <path d="m16 16 5 5" />
            </svg>
            <input type="search" aria-label="Искать блюда" placeholder="Искать блюда" />
          </div>

          {dialNumber ? (
            <a className={styles.phone} href={`tel:${dialNumber}`}>
              {phoneNumber}
            </a>
          ) : (
            <span className={styles.phone}>+7 (000) 000-00-00</span>
          )}

          <button className={styles.login} type="button">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="8" r="3.2" />
              <path d="M5.5 20c.5-4 2.7-6 6.5-6s6 2 6.5 6" />
            </svg>
            Войти
          </button>
          <button className={styles.cart} type="button">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M4 8h16l-1.5 12h-13L4 8ZM9 8V6a3 3 0 0 1 6 0v2" />
            </svg>
            Корзина <span className={styles.cartCount}>0</span>
          </button>
        </div>
      </div>

      <nav className={styles.categoryBar} aria-label="Категории меню">
        <div className={`${styles.container} ${styles.categoryList}`}>
          {categories.map(([label, anchor]) => (
            <a
              className={`${styles.category} ${anchor === 'promotions' ? styles.promotion : ''} ${anchor === 'new' ? styles.current : ''}`}
              href={`${isHome ? '' : '/'}#${anchor}`}
              key={anchor}
            >
              {label}
            </a>
          ))}
        </div>
      </nav>
    </header>
  )
}

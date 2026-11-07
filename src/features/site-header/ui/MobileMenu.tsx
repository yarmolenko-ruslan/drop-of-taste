import { Link } from 'react-router'
import { Dialog } from '../../../shared/ui/Dialog/Dialog'
import { categories } from './navigation'
import styles from './SiteHeader.module.css'

type MobileMenuProps = {
  phoneNumber?: string
  onAddressClick?: () => void
  onClose: () => void
}

export function MobileMenu({ phoneNumber, onAddressClick, onClose }: MobileMenuProps) {
  const dialNumber = phoneNumber?.replace(/[^+\d]/g, '')

  return (
    <Dialog titleId="mobile-menu-title" onClose={onClose} className={styles.menuDialog}>
      <div className={styles.menuHeader}>
        <Link className={styles.menuBrand} to="/" onClick={onClose}>
          <img src="/brand-emblem.png" alt="" width="40" height="40" />
          <span id="mobile-menu-title">КАПЕЛА ВКУСА</span>
        </Link>
      </div>

      <div className={styles.menuBody}>
        <div className={styles.menuContact}>
          <button
            type="button"
            className={styles.menuMap}
            onClick={() => {
              onClose()
              onAddressClick?.()
            }}
          >
            <span>
              <strong>Кафе на карте</strong>
              <small>Красноярск, ул. Петра Подзолкова, 3и</small>
            </span>
            <span aria-hidden="true">›</span>
          </button>
          {dialNumber && (
            <a className={styles.menuPhone} href={`tel:${dialNumber}`}>
              {phoneNumber}
              <small>Ежедневно 08:00–20:00</small>
            </a>
          )}
        </div>

        <nav className={styles.menuNavigation} aria-label="Мобильное меню">
          <span className={styles.menuSectionTitle}>КАПЕЛА ВКУСА</span>
          <Link to="/promotions" onClick={onClose}>
            Акции
          </Link>
          <Link to="/about" onClick={onClose}>
            О нас
          </Link>
          <a href="/#delivery" onClick={onClose}>
            Доставка и оплата
          </a>
          <a href="/#bonuses" onClick={onClose}>
            Бонусная программа
          </a>

          <span className={styles.menuSectionTitle}>МЕНЮ</span>
          {categories
            .filter(([, anchor]) => anchor !== 'promotions')
            .map(([label, anchor]) => (
              <a href={`/#${anchor}`} key={anchor} onClick={onClose}>
                {label}
              </a>
            ))}

          <span className={styles.menuSectionTitle}>ИНФОРМАЦИЯ</span>
          <Link to="/privacy" onClick={onClose}>
            Политика конфиденциальности
          </Link>
          <Link to="/data-consent" onClick={onClose}>
            Согласие на обработку данных
          </Link>
        </nav>
      </div>
    </Dialog>
  )
}

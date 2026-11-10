import { Link } from 'react-router'
import { Dialog } from '../../../shared/ui/Dialog/Dialog'
import { categories } from './navigation'
import { formatRussianPhone } from '../../../../shared/validation/phone'
import styles from './SiteHeader.module.css'

type MobileMenuProps = {
  phoneNumber?: string
  categories?: readonly (readonly [string, string])[]
  address?: string
  hours?: string
  brandName?: string
  brandLogo?: string
  onAddressClick?: () => void
  onClose: () => void
}

export function MobileMenu({
  phoneNumber,
  categories: liveCategories = categories,
  address = 'Красноярск, ул. Петра Подзолкова, 3и',
  hours = 'Ежедневно 08:00–20:00',
  brandName = 'КАПЕЛА ВКУСА',
  brandLogo = '/brand-emblem.png',
  onAddressClick,
  onClose,
}: MobileMenuProps) {
  const dialNumber = phoneNumber?.replace(/[^+\d]/g, '')

  return (
    <Dialog titleId="mobile-menu-title" onClose={onClose} className={styles.menuDialog}>
      <div className={styles.menuHeader}>
        <Link className={styles.menuBrand} to="/" onClick={onClose}>
          <img src={brandLogo} alt="" width="40" height="40" />
          <span id="mobile-menu-title">{brandName}</span>
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
              <small>{address}</small>
            </span>
            <span aria-hidden="true">›</span>
          </button>
          {dialNumber && (
            <a className={styles.menuPhone} href={`tel:${dialNumber}`}>
              {formatRussianPhone(phoneNumber ?? '')}
              <small>{hours}</small>
            </a>
          )}
        </div>

        <nav className={styles.menuNavigation} aria-label="Мобильное меню">
          <span className={styles.menuSectionTitle}>{brandName}</span>
          <Link to="/promotions" onClick={onClose}>
            Акции
          </Link>
          <Link to="/about" onClick={onClose}>
            О нас
          </Link>
          <a href="/#delivery" onClick={onClose}>
            Доставка и оплата
          </a>
          <a href="/#account-benefits" onClick={onClose}>
            Личный кабинет
          </a>

          <span className={styles.menuSectionTitle}>МЕНЮ</span>
          {liveCategories
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

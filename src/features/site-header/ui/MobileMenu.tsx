import { Link } from 'react-router'
import { useSiteContent } from '../../site-content/SiteContentProvider'
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
  const content = useSiteContent()
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
              <strong>{content.settings.labels.map}</strong>
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
            {content.settings.labels.promotions}
          </Link>
          <Link to="/about" onClick={onClose}>
            {content.settings.labels.about}
          </Link>
          {content.settings.sections.benefits && (
            <a href="/#delivery" onClick={onClose}>
              {content.settings.labels.delivery}
            </a>
          )}
          <Link
            to={content.settings.sections.account ? '/#account-benefits' : '/account/orders'}
            onClick={onClose}
          >
            {content.settings.labels.account}
          </Link>

          <span className={styles.menuSectionTitle}>{content.settings.labels.menu}</span>
          {liveCategories
            .filter(([, anchor]) => anchor !== 'promotions')
            .map(([label, anchor]) => (
              <a
                href={
                  (anchor === 'combo' && !content.settings.sections.combo) ||
                  (anchor === 'sauces' && !content.settings.sections.sauces)
                    ? `/menu/${anchor}`
                    : `/#${anchor}`
                }
                key={anchor}
                onClick={onClose}
              >
                {label}
              </a>
            ))}

          <span className={styles.menuSectionTitle}>{content.settings.labels.information}</span>
          <Link to="/privacy" onClick={onClose}>
            {content.legal.privacy.title}
          </Link>
          <Link to="/data-consent" onClick={onClose}>
            {content.legal.consent.title}
          </Link>
        </nav>
      </div>
    </Dialog>
  )
}

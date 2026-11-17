import { Link, useLocation } from 'react-router'
import styles from './SiteFooter.module.css'
import { useSiteContent } from '../../site-content/SiteContentProvider'
import { useCatalog } from '../../catalog/api/CatalogProvider'
import { formatRussianPhone } from '../../../../shared/validation/phone'

const menuLinks = [
  ['Завтраки', 'breakfast'],
  ['Салаты', 'salads'],
  ['Супы', 'soups'],
  ['Горячие блюда', 'hot'],
  ['На сковороде', 'pan'],
  ['Выпечка', 'bakery'],
  ['Десерты', 'desserts'],
  ['Напитки', 'drinks'],
  ['Соусы', 'sauces'],
] as const

export function SiteFooter() {
  const { pathname } = useLocation()
  const isAccountPage = pathname === '/account' || pathname.startsWith('/account/')
  const content = useSiteContent()
  const menuLinksLive =
    useCatalog()
      ?.data?.categories.filter((category) => !['combo'].includes(category.id))
      .map((category) => [category.title, category.id] as const) ?? menuLinks
  const dialNumber = content.phone.replace(/[^+\d]/g, '')
  return (
    <footer
      className={`${styles.footer} ${isAccountPage ? styles.accountFooter : ''}`}
      id="contacts"
    >
      <div className={styles.container}>
        <div className={styles.columns}>
          <div className={styles.brandColumn}>
            <Link className={styles.brand} to="/" aria-label={`${content.siteTitle} — главная`}>
              <img src={content.brandLogo} alt="" width="47" height="47" />
              <span>{content.brandName}</span>
            </Link>
            <p>{content.footerDescription}</p>
            <div className={styles.socials} aria-label="Социальные сети">
              {content.vkUrl && (
                <a href={content.vkUrl} target="_blank" rel="noreferrer">
                  VK
                </a>
              )}
              {content.telegramUrl && (
                <a href={content.telegramUrl} target="_blank" rel="noreferrer">
                  TG
                </a>
              )}
            </div>
          </div>
          <nav aria-label="Меню в подвале">
            <h2>{content.settings.labels.menu}</h2>
            <ul>
              {menuLinksLive.map(([label, id]) => (
                <li key={id}>
                  <a
                    href={
                      id === 'sauces' && !content.settings.sections.sauces
                        ? `/menu/${id}`
                        : `/#${id}`
                    }
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <nav aria-label="Покупателям">
            <h2>{content.settings.labels.customers}</h2>
            <ul>
              <li>
                <Link to="/promotions">{content.settings.labels.promotions}</Link>
              </li>
              <li>
                <Link
                  to={content.settings.sections.account ? '/#account-benefits' : '/account/orders'}
                >
                  {content.settings.labels.account}
                </Link>
              </li>
              <li>
                {content.settings.sections.benefits && (
                  <a href="/#delivery">{content.settings.labels.delivery}</a>
                )}
              </li>
              <li>
                <Link to="/about">{content.settings.labels.about}</Link>
              </li>
              <li>
                <Link to="/privacy">{content.legal.privacy.title}</Link>
              </li>
              <li>
                <Link to="/data-consent">{content.legal.consent.title}</Link>
              </li>
            </ul>
          </nav>
          <div className={styles.contactColumn}>
            <h2>{content.settings.labels.contacts}</h2>
            {dialNumber && (
              <a className={styles.phone} href={`tel:${dialNumber}`}>
                {formatRussianPhone(content.phone)}
              </a>
            )}
            <p>{content.hours}</p>
            {content.email && <span>{content.email}</span>}
          </div>
        </div>
        <div className={styles.bottom}>
          {!content.legalDetails.includes('[ИП / ООО') && <span>{content.legalDetails}</span>}
          <span>
            © {new Date().getFullYear()} «{content.siteTitle}»
          </span>
        </div>
      </div>
    </footer>
  )
}

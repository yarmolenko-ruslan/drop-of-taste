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
              <a href={content.vkUrl} target="_blank" rel="noreferrer">
                VK
              </a>
              <a href={content.telegramUrl} target="_blank" rel="noreferrer">
                TG
              </a>
            </div>
          </div>
          <nav aria-label="Меню в подвале">
            <h2>МЕНЮ</h2>
            <ul>
              {menuLinksLive.map(([label, id]) => (
                <li key={id}>
                  <a href={`/#${id}`}>{label}</a>
                </li>
              ))}
            </ul>
          </nav>
          <nav aria-label="Покупателям">
            <h2>ПОКУПАТЕЛЯМ</h2>
            <ul>
              <li>
                <Link to="/promotions">Акции</Link>
              </li>
              <li>
                <a href="/#account-benefits">Личный кабинет</a>
              </li>
              <li>
                <a href="/#delivery">Доставка и оплата</a>
              </li>
              <li>
                <Link to="/about">О нас</Link>
              </li>
              <li>
                <Link to="/privacy">Политика конфиденциальности</Link>
              </li>
              <li>
                <Link to="/data-consent">Согласие на обработку данных</Link>
              </li>
            </ul>
          </nav>
          <div className={styles.contactColumn}>
            <h2>КОНТАКТЫ</h2>
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

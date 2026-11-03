import { Link } from 'react-router'
import styles from './SiteFooter.module.css'

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
  return (
    <footer className={styles.footer} id="contacts">
      <div className={styles.container}>
        <div className={styles.columns}>
          <div className={styles.brandColumn}>
            <Link className={styles.brand} to="/" aria-label="Капела вкуса — главная">
              <img src="/brand-emblem.png" alt="" width="47" height="47" />
              <span>КАПЕЛА ВКУСА</span>
            </Link>
            <p>Домашняя кухня, выпечка и кофе с доставкой.</p>
            <div className={styles.socials} aria-label="Социальные сети">
              <a href="https://vk.com/" target="_blank" rel="noreferrer">
                VK
              </a>
              <a href="https://t.me/" target="_blank" rel="noreferrer">
                TG
              </a>
            </div>
          </div>
          <nav aria-label="Меню в подвале">
            <h2>МЕНЮ</h2>
            <ul>
              {menuLinks.map(([label, id]) => (
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
                <a href="/#bonuses">Бонусная программа</a>
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
            <a className={styles.phone} href="tel:+71234567890">
              +7 123 456-78-90
            </a>
            <p>Ежедневно 08:00–20:00</p>
            <span>[почта]</span>
          </div>
        </div>
        <div className={styles.bottom}>
          <span>[ИП / ООО «Название»], ИНН [–], ОГРН [–]</span>
          <span>© 2026 «Капела вкуса»</span>
        </div>
      </div>
    </footer>
  )
}

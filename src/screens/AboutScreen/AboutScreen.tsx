import { Link } from 'react-router'
import styles from './AboutScreen.module.css'

const cafeAddress = 'г. Красноярск, улица Петра Подзолкова, 3и'
const mapUrl =
  'https://yandex.ru/map-widget/v1/?ll=92.884165%2C56.049189&mode=search&oid=172905214895&ol=biz&z=16.73'

export function AboutScreen() {
  return (
    <main className={styles.root}>
      <section className={`${styles.container} ${styles.intro}`} aria-labelledby="about-title">
        <nav className={styles.breadcrumbs} aria-label="Навигационная цепочка">
          <Link to="/">Главная</Link>
          <span aria-hidden="true">/</span>
          <span>О кафе</span>
        </nav>

        <div className={styles.hero}>
          <div className={styles.copy}>
            <span className={styles.eyebrow}>ДОМАШНЯЯ КУХНЯ · КАФЕ</span>
            <h1 id="about-title">О кафе</h1>
            <p className={styles.lead}>Больше, чем еда — это наш край</p>
            <p>
              «Капела вкуса» — кафе домашней кухни в Красноярске. Здесь можно позавтракать,
              пообедать знакомыми блюдами, выбрать свежую выпечку или заказать любимые вкусы с
              доставкой.
            </p>
            <p>
              Готовим завтраки, супы, горячие блюда, десерты и выпечку. Утро начинаем с домашнего
              завтрака, а в течение дня предлагаем сытные блюда и кофе.
            </p>
          </div>
          <img
            className={styles.photo}
            src="/banners/cafe-interior.jpg"
            alt="Интерьер кафе «Капела вкуса»"
            width="1400"
            height="788"
          />
        </div>

        <div className={styles.details}>
          <section aria-labelledby="visit-title">
            <h2 id="visit-title">Приходите в гости</h2>
            <address>{cafeAddress}</address>
            <p>Ежедневно с 08:00 до 22:00</p>
          </section>
          <section aria-labelledby="menu-title">
            <h2 id="menu-title">Что вас ждёт</h2>
            <ul>
              <li>Домашние блюда и свежая выпечка</li>
              <li>Завтраки каждое утро до 12:00</li>
              <li>Доставка и самовывоз</li>
            </ul>
          </section>
        </div>
      </section>

      <section className={styles.mapSection} aria-labelledby="map-title">
        <div className={`${styles.container} ${styles.mapHeading}`}>
          <div>
            <span className={styles.eyebrow}>МЫ НА КАРТЕ</span>
            <h2 id="map-title">Как нас найти</h2>
          </div>
          <address>{cafeAddress}</address>
        </div>
        <iframe
          className={styles.map}
          src={mapUrl}
          title={`Кафе «Место вкуса» на Яндекс Карте: ${cafeAddress}`}
          loading="lazy"
          allowFullScreen
        />
      </section>
    </main>
  )
}

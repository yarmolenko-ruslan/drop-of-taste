import { Link } from 'react-router'
import styles from './HomeClosingSections.module.css'

const sauces = ['Сметана', 'Чесночный', 'Горчица', 'Хрен со свёклой', 'Аджика']

const benefits = [
  { icon: 'clock', title: 'От 60 минут', detail: 'Привезём горячим' },
  { icon: 'truck', title: 'Бесплатно от 0000 ₽', detail: 'Условия по зонам' },
  { icon: 'card', title: 'Онлайн, картой, наличными', detail: 'Как вам удобно' },
  { icon: 'pin', title: 'Самовывоз −10%', detail: '3 кафе в городе' },
] as const

function BenefitIcon({ name }: { name: (typeof benefits)[number]['icon'] }) {
  const path = {
    clock: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 7v5l3 2M9 2h6" />
      </>
    ),
    truck: (
      <>
        <path d="M3 6h11v10H3zM14 9h4l3 3v4h-7z" />
        <circle cx="7" cy="17" r="2" />
        <circle cx="17" cy="17" r="2" />
      </>
    ),
    card: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M3 10h18M7 15h4" />
      </>
    ),
    pin: (
      <>
        <path d="M12 21s7-5.3 7-11a7 7 0 1 0-14 0c0 5.7 7 11 7 11Z" />
        <circle cx="12" cy="10" r="2.5" />
      </>
    ),
  }[name]

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {path}
    </svg>
  )
}

export function SauceGrid({ onSauceAction }: { onSauceAction?: (name: string) => void }) {
  return (
    <div className={styles.sauceGrid}>
      {sauces.map((name) => (
        <article className={styles.sauceCard} key={name}>
          <span className={styles.saucePicture} aria-hidden="true">
            <span />
          </span>
          <div className={styles.sauceText}>
            <h3>{name}</h3>
            <p>
              000 г · 000 ккал · <strong>000 ₽</strong>
            </p>
          </div>
          <button
            type="button"
            aria-label={`Выбрать соус «${name}»`}
            className={styles.sauceAdd}
            onClick={() => onSauceAction?.(name)}
          >
            +
          </button>
          {onSauceAction && (
            <button
              className={styles.sauceHitArea}
              type="button"
              aria-label={`Подробнее о соусе «${name}»`}
              onClick={() => onSauceAction(name)}
            />
          )}
        </article>
      ))}
    </div>
  )
}

function Sauces({ onSauceAction }: { onSauceAction?: (name: string) => void }) {
  return (
    <section className={styles.sauces} id="sauces" aria-labelledby="sauces-title">
      <div className={styles.sectionHeading}>
        <div>
          <h2 id="sauces-title">Соусы</h2>
          <p>Добавьте вкуса любимому блюду</p>
        </div>
        <Link to="/menu/sauces">
          Весь раздел <span aria-hidden="true">→</span>
        </Link>
      </div>
      <SauceGrid onSauceAction={onSauceAction} />
    </section>
  )
}

export function HomeClosingSections({ onSauceAction }: { onSauceAction?: (name: string) => void }) {
  return (
    <>
      <Sauces onSauceAction={onSauceAction} />
      <section className={styles.benefits} id="delivery" aria-label="Условия доставки и оплаты">
        {benefits.map(({ icon, title, detail }) => (
          <div className={styles.benefitCard} key={title}>
            <span className={`${styles.benefitIcon} ${icon === 'pin' ? styles.greenIcon : ''}`}>
              <BenefitIcon name={icon} />
            </span>
            <div>
              <strong>{title}</strong>
              <span>{detail}</span>
            </div>
          </div>
        ))}
      </section>
      <section className={styles.bonus} id="bonuses" aria-labelledby="bonus-title">
        <div className={styles.bonusCopy}>
          <span className={styles.eyebrow}>БОНУСНАЯ ПРОГРАММА</span>
          <h2 id="bonus-title">Копите бонусы с каждого заказа</h2>
          <p>
            Возвращаем 5% бонусами. Оплачивайте ими до 30% следующих заказов, а в день рождения —
            подарок от шефа.
          </p>
          <div className={styles.bonusActions}>
            <button type="button" className={styles.goldButton}>
              Войти по номеру
            </button>
            <a href="#bonus-steps" className={styles.outlineButton}>
              Как это работает
            </a>
          </div>
        </div>
        <ol className={styles.bonusSteps} id="bonus-steps">
          <li>
            <strong>1</strong>
            <span>Войдите по номеру телефона</span>
          </li>
          <li>
            <strong>2</strong>
            <span>Получайте 5% бонусами</span>
          </li>
          <li>
            <strong>3</strong>
            <span>Оплачивайте до 30% заказа</span>
          </li>
        </ol>
      </section>
      <section className={styles.about} id="about" aria-labelledby="about-title">
        <img src="/banners/cafe-interior.jpg" alt="Интерьер кафе «Капела вкуса»" loading="lazy" />
        <div className={styles.aboutCopy}>
          <span className={styles.eyebrow}>О НАС</span>
          <h2 id="about-title">Больше, чем еда — это наш край</h2>
          <p>
            Домашняя кухня, выпечка из печи каждое утро и кофе, ради которого хочется вернуться.
            Пара предложений об истории кафе и шеф-поваре.
          </p>
          <a href="#contacts" className={styles.aboutButton}>
            Адреса кафе
          </a>
        </div>
      </section>
    </>
  )
}

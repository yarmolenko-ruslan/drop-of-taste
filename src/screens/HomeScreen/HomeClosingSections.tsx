import { Link } from 'react-router'
import { useEffect, useState } from 'react'
import { addOneToCart } from '../../features/cart'
import { apiRequest } from '../../features/auth/api/authApi'
import { dialogItemFromSauce } from '../../features/catalog/model/dialogContent'
import styles from './HomeClosingSections.module.css'
import { useCatalog, useCatalogItem } from '../../features/catalog/api/CatalogProvider'
import { useSiteContent } from '../../features/site-content/SiteContentProvider'
import { pickupDiscountPercent } from '../../../shared/promotion'

const sauces = ['Сметана', 'Чесночный', 'Горчица', 'Хрен со свёклой', 'Аджика']

function BenefitIcon({ name }: { name: 'clock' | 'truck' | 'card' | 'pin' }) {
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

function SauceCard({
  name,
  id,
  onSauceAction,
}: {
  name: string
  id: string
  onSauceAction?: (name: string) => void
}) {
  const live = useCatalogItem(id)
  const priceRub = live ? live.priceKopecks / 100 : null
  return (
    <article className={styles.sauceCard}>
      {live?.image ? (
        <img className={styles.saucePictureImage} src={live.image} alt="" loading="lazy" />
      ) : (
        <span className={styles.saucePicture} aria-hidden="true">
          <span />
        </span>
      )}
      <div className={styles.sauceText}>
        <h3>{name}</h3>
        <p>
          Вес и калорийность уточняются ·{' '}
          <strong>{priceRub === null ? 'Цена уточняется' : `${priceRub} ₽`}</strong>
        </p>
      </div>
      <span className={styles.sauceActionWrap}>
        <button
          type="button"
          aria-label={`Добавить соус «${name}» в корзину`}
          className={styles.sauceAdd}
          disabled={live?.available === false}
          onClick={() => addOneToCart({ ...(live ?? dialogItemFromSauce(name)), id, priceRub })}
        >
          +
        </button>
      </span>
      {onSauceAction && (
        <button
          className={styles.sauceHitArea}
          type="button"
          aria-label={`Подробнее о соусе «${name}»`}
          onClick={() => onSauceAction(name)}
        />
      )}
    </article>
  )
}

export function SauceGrid({ onSauceAction }: { onSauceAction?: (name: string) => void }) {
  const catalog = useCatalog()?.data
  const sauceItems = catalog
    ? (catalog.categories.find((category) => category.id === 'sauces')?.products ?? []).map(
        (item) => ({ name: item.name, id: item._id }),
      )
    : sauces.map((name) => ({ name, id: `sauce-${name}` }))
  return (
    <div className={styles.sauceGrid}>
      {sauceItems.map(({ name, id }) => (
        <SauceCard name={name} id={id} onSauceAction={onSauceAction} key={id} />
      ))}
    </div>
  )
}

function Sauces({ onSauceAction }: { onSauceAction?: (name: string) => void }) {
  const content = useSiteContent()
  const catalog = useCatalog()?.data
  const sauceCategory = catalog?.categories.find((category) => category.id === 'sauces')
  if (catalog && !sauceCategory) return null
  const saucesTitle = sauceCategory?.title ?? 'Соусы'
  return (
    <section className={styles.sauces} id="sauces" aria-labelledby="sauces-title">
      <div className={styles.sectionHeading}>
        <div>
          <h2 id="sauces-title">{saucesTitle}</h2>
          <p>{content.saucesSubtitle}</p>
        </div>
        <Link to="/menu/sauces">
          Весь раздел <span aria-hidden="true">→</span>
        </Link>
      </div>
      <SauceGrid onSauceAction={onSauceAction} />
    </section>
  )
}

export function HomeClosingSections({
  onSauceAction,
  onLogin,
}: {
  onSauceAction?: (name: string) => void
  onLogin?: () => void
}) {
  const content = useSiteContent()
  const pickupPercent = pickupDiscountPercent(content.promotions)
  const [testPaymentEnabled, setTestPaymentEnabled] = useState(false)
  useEffect(() => {
    void apiRequest<{ testPaymentEnabled: boolean }>('/checkout/config')
      .then((config) => setTestPaymentEnabled(config.testPaymentEnabled))
      .catch(() => undefined)
  }, [])
  return (
    <>
      <Sauces onSauceAction={onSauceAction} />
      <section className={styles.benefits} id="delivery" aria-label="Условия доставки и оплаты">
        {content.benefits.map(({ icon, title, detail }) => (
          <div className={styles.benefitCard} key={`${icon}-${title}`}>
            <span className={`${styles.benefitIcon} ${icon === 'pin' ? styles.greenIcon : ''}`}>
              <BenefitIcon name={icon} />
            </span>
            <div>
              <strong>
                {icon === 'card' && (title === 'Тестовый заказ' || title === 'Оформление заказа')
                  ? testPaymentEnabled
                    ? 'Онлайн-оплата'
                    : 'Оформление заказа'
                  : icon === 'pin' && title === 'Самовывоз −10%'
                    ? pickupPercent > 0
                      ? `Самовывоз −${pickupPercent}%`
                      : 'Самовывоз'
                    : title}
              </strong>
              <span>
                {icon === 'card' &&
                (detail === 'Оплата пока не принимается' || detail === 'За пару минут')
                  ? testPaymentEnabled
                    ? 'Банковской картой'
                    : 'За пару минут'
                  : icon === 'pin' && title === 'Самовывоз −10%' && pickupPercent === 0
                    ? 'Заберите заказ в кафе'
                    : detail === 'Тестовые условия'
                      ? 'Условия в корзине'
                      : detail}
              </span>
            </div>
          </div>
        ))}
      </section>
      <section className={styles.bonus} id="account-benefits" aria-labelledby="bonus-title">
        <div className={styles.bonusCopy}>
          <span className={styles.eyebrow}>ЛИЧНЫЙ КАБИНЕТ</span>
          <h2 id="bonus-title">{content.bonusTitle}</h2>
          <p>{content.bonusText}</p>
          <div className={styles.bonusActions}>
            <button type="button" className={styles.goldButton} onClick={onLogin}>
              Войти по номеру
            </button>
            <a href="#bonus-steps" className={styles.outlineButton}>
              Как это работает
            </a>
          </div>
        </div>
        <ol className={styles.bonusSteps} id="bonus-steps">
          {content.bonusSteps.map((step, index) => (
            <li key={index}>
              <strong>{index + 1}</strong>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </section>
      <section className={styles.about} id="about" aria-labelledby="about-title">
        <img src={content.aboutImage} alt={content.aboutImageAlt} loading="lazy" />
        <div className={styles.aboutCopy}>
          <span className={styles.eyebrow}>О НАС</span>
          <h2 id="about-title">{content.aboutLead}</h2>
          <p>{content.homeAboutText}</p>
          <Link to="/about" className={styles.aboutButton}>
            О кафе
          </Link>
        </div>
      </section>
    </>
  )
}

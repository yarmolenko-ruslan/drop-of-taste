import { useState } from 'react'
import { Link, useParams } from 'react-router'
import styles from './PromotionsScreen.module.css'
import { useSiteContent } from '../../features/site-content/SiteContentProvider'
import { isPromotionActive } from '../../../shared/promotion'

type Filter = 'all' | 'delivery' | 'pickup' | 'cafe'

const filters: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'delivery', label: 'Доставка' },
  { id: 'pickup', label: 'Самовывоз' },
  { id: 'cafe', label: 'В кафе' },
]

export function PromotionsScreen({ onLogin }: { onLogin?: () => void }) {
  const { promotionId } = useParams()
  const [filter, setFilter] = useState<Filter>('all')
  const { promotions, heroSlides } = useSiteContent()
  const activePromotions = promotions.filter((item) => isPromotionActive(item))
  const visible = activePromotions.filter((item) => filter === 'all' || item.category === filter)

  if (promotionId) {
    const promotion = activePromotions.find((item) => item.id === promotionId)
    const slide = heroSlides.find(
      (item) =>
        item.href === `/promotions/${promotionId}` || (!item.href && item.id === promotionId),
    )
    return (
      <main className={styles.root}>
        <nav className={styles.breadcrumbs} aria-label="Навигационная цепочка">
          <Link to="/">Главная</Link>
          <span aria-hidden="true">/</span>
          <Link to="/promotions">Акции</Link>
          <span aria-hidden="true">/</span>
          <span>{promotion?.subtitle ?? 'Акция'}</span>
        </nav>
        {promotion ? (
          <article className={`${styles.card} ${styles.detailCard}`}>
            {slide && <img className={styles.detailImage} src={slide.image} alt={slide.imageAlt} />}
            <div className={`${styles.banner} ${styles[promotion.theme]}`}>
              <span>{promotion.badge}</span>
              <h1>{promotion.subtitle}</h1>
            </div>
            <div className={styles.body}>
              <p>{promotion.description}</p>
              <section
                className={styles.detailConditions}
                aria-labelledby="promotion-conditions-title"
              >
                <h2 id="promotion-conditions-title">Условия акции</h2>
                <p>{promotion.conditions}</p>
              </section>
              {promotion.href ? (
                <Link className={styles.action} to={promotion.href}>
                  {promotion.action}
                </Link>
              ) : (
                <button className={styles.action} type="button" onClick={onLogin}>
                  {promotion.action}
                </button>
              )}
            </div>
          </article>
        ) : (
          <p>Акция не найдена или срок её действия закончился.</p>
        )}
      </main>
    )
  }

  return (
    <main className={styles.root}>
      <nav className={styles.breadcrumbs} aria-label="Навигационная цепочка">
        <Link to="/">Главная</Link>
        <span aria-hidden="true">/</span>
        <span>Акции</span>
      </nav>
      <div className={styles.headingRow}>
        <h1>Акции</h1>
        <div className={styles.filters} role="group" aria-label="Фильтр акций">
          {filters.map((item) => (
            <button
              type="button"
              key={item.id}
              className={filter === item.id ? styles.active : ''}
              aria-pressed={filter === item.id}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.grid}>
        {visible.map((promotion) => (
          <article className={styles.card} key={promotion.id}>
            <div className={`${styles.banner} ${styles[promotion.theme]}`}>
              <span>{promotion.badge}</span>
              <h2>{promotion.title}</h2>
            </div>
            <div className={styles.body}>
              <h3>{promotion.subtitle}</h3>
              <p>{promotion.description}</p>
              <details className={styles.conditions}>
                <summary>Условия акции</summary>
                <p>{promotion.conditions}</p>
              </details>
              {promotion.href ? (
                <Link className={styles.action} to={promotion.href}>
                  {promotion.action}
                </Link>
              ) : (
                <button className={styles.action} type="button" onClick={onLogin}>
                  {promotion.action}
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </main>
  )
}

import type { CatalogProduct, ProductBadge } from '../../model/product'
import { CatalogActionButton } from '../CatalogActionButton/CatalogActionButton'
import styles from './ProductCard.module.css'
import { useCatalogItem } from '../../api/CatalogProvider'

const badgeLabels: Record<ProductBadge, string> = {
  new: 'НОВИНКА',
  lenten: 'ПОСТНОЕ',
  hit: 'ХИТ',
  spicy: 'ОСТРОЕ',
  discount: 'СКИДКА',
}

type ProductCardProps = {
  product: CatalogProduct
  onAction?: (product: CatalogProduct) => void
}

export function ProductCard({ product, onAction }: ProductCardProps) {
  const live = useCatalogItem(product.id)
  const shown = live
    ? { ...product, ...live, id: live._id, priceRub: live.priceKopecks / 100 }
    : product
  return (
    <article className={styles.card}>
      <div className={styles.photoWrap}>
        <img className={styles.photo} src={shown.image} alt={shown.imageAlt} loading="lazy" />
        <div className={styles.badges}>
          {shown.badges.map((badge) => (
            <span className={`${styles.badge} ${styles[badge]}`} key={badge}>
              {badgeLabels[badge]}
            </span>
          ))}
        </div>
      </div>
      <div className={styles.body}>
        <h3 className={styles.name}>{shown.name}</h3>
        <p className={styles.meta}>
          {shown.amount ? `${shown.amount} ${shown.measure}` : 'Вес уточняется'} ·{' '}
          {shown.calories ? `${shown.calories} ккал` : 'Калорийность уточняется'}
        </p>
        <p className={styles.details}>{shown.details}</p>
        <div className={styles.footer}>
          <strong className={styles.price}>
            {shown.priceRub === null
              ? 'Цена уточняется'
              : `${shown.priceRub.toLocaleString('ru-RU')} ₽`}
          </strong>
          <span className={styles.actionWrap}>
            <CatalogActionButton item={shown} />
          </span>
        </div>
      </div>
      {onAction && (
        <button
          className={styles.cardHitArea}
          type="button"
          aria-label={`Подробнее о блюде «${shown.name}»`}
          onClick={() => onAction(shown)}
        />
      )}
    </article>
  )
}

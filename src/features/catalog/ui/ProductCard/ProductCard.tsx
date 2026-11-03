import type { CatalogProduct, ProductBadge } from '../../model/product'
import { CatalogActionButton } from '../CatalogActionButton/CatalogActionButton'
import styles from './ProductCard.module.css'

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
  return (
    <article className={styles.card}>
      <div className={styles.photoWrap}>
        <img className={styles.photo} src={product.image} alt={product.imageAlt} loading="lazy" />
        <div className={styles.badges}>
          {product.badges.map((badge) => (
            <span className={`${styles.badge} ${styles[badge]}`} key={badge}>
              {badgeLabels[badge]}
            </span>
          ))}
        </div>
      </div>
      <div className={styles.body}>
        <h3 className={styles.name}>{product.name}</h3>
        <p className={styles.meta}>
          {product.amount ?? '000'} {product.measure} · {product.calories ?? '000'} ккал
        </p>
        <p className={styles.details}>{product.details}</p>
        <div className={styles.footer}>
          <strong className={styles.price}>
            {product.priceRub === null ? '000' : product.priceRub.toLocaleString('ru-RU')} ₽
          </strong>
          <span className={styles.actionWrap}>
            <CatalogActionButton item={product} />
          </span>
        </div>
      </div>
      {onAction && (
        <button
          className={styles.cardHitArea}
          type="button"
          aria-label={`Подробнее о блюде «${product.name}»`}
          onClick={() => onAction(product)}
        />
      )}
    </article>
  )
}

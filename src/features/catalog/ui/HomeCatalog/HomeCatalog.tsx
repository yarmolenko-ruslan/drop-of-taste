import { Link } from 'react-router'
import {
  homeCategories,
  homeCombos,
  type HomeCategory,
  type HomeCombo,
} from '../../model/homeCatalog'
import { CatalogActionButton } from '../CatalogActionButton/CatalogActionButton'
import type { CatalogProduct } from '../../model/product'
import { ProductCard } from '../ProductCard/ProductCard'
import styles from './HomeCatalog.module.css'
import { useCatalog, useCatalogItem } from '../../api/CatalogProvider'
import { useSiteContent } from '../../../site-content/SiteContentProvider'

function ComboCard({
  combo,
  onAction,
}: {
  combo: HomeCombo
  onAction?: (combo: HomeCombo) => void
}) {
  const content = useSiteContent()
  const live = useCatalogItem(combo.id)
  const priceRub = live ? live.priceKopecks / 100 : null
  return (
    <article className={styles.comboCard}>
      <div className={styles.comboImageWrap}>
        {combo.image ? (
          <img className={styles.comboImage} src={combo.image} alt={combo.name} loading="lazy" />
        ) : (
          <span className={styles.comboNoImage} aria-label="Фото пока нет">
            ◉
          </span>
        )}
        <span className={styles.comboBadge}>{content.comboBadge}</span>
      </div>
      <div className={styles.comboBody}>
        <h3 className={styles.comboName}>{combo.name}</h3>
        <p className={styles.comboMeta}>{combo.portions}</p>
        <p className={styles.comboDetails}>{combo.details}</p>
        <p className={styles.comboNote}>{content.comboNote}</p>
        <div className={styles.comboFooter}>
          <strong className={styles.comboPrice}>
            {priceRub === null ? 'Цена уточняется' : `${priceRub.toLocaleString('ru-RU')} ₽`}
          </strong>
          <span className={styles.comboActionWrap}>
            <CatalogActionButton
              item={{
                id: combo.id,
                name: combo.name,
                image: combo.image,
                priceRub,
                available: live?.available,
              }}
            />
          </span>
        </div>
      </div>
      {onAction && (
        <button
          className={styles.comboHitArea}
          type="button"
          aria-label={`Подробнее о наборе «${combo.name}»`}
          onClick={() => onAction(combo)}
        />
      )}
    </article>
  )
}

function CategorySection({
  category,
  onProductAction,
}: {
  category: HomeCategory
  onProductAction?: (product: CatalogProduct) => void
}) {
  return (
    <section className={styles.category} id={category.id} aria-labelledby={`${category.id}-title`}>
      <div className={styles.categoryHeadingRow}>
        <div>
          <h2 className={styles.heading} id={`${category.id}-title`}>
            {category.title}
          </h2>
          <p className={styles.subtitle}>{category.subtitle}</p>
        </div>
        <Link className={styles.allLink} to={`/menu/${category.id}`}>
          Весь раздел <span aria-hidden="true">→</span>
        </Link>
      </div>
      <div className={styles.productGrid}>
        {category.products.map((item) => (
          <ProductCard key={item.id} product={item} onAction={onProductAction} />
        ))}
      </div>
    </section>
  )
}

export function HomeCatalog({
  onProductAction,
  onComboAction,
}: {
  onProductAction?: (product: CatalogProduct) => void
  onComboAction?: (combo: HomeCombo) => void
}) {
  const content = useSiteContent()
  const catalog = useCatalog()?.data
  const combos = catalog
    ? (catalog.categories.find((category) => category.id === 'combo')?.products ?? []).map(
        (item) => ({
          id: item._id,
          name: item.name,
          image: item.image ?? '',
          portions: item.portions ?? '',
          details: item.details,
        }),
      )
    : homeCombos
  const categories = catalog
    ? catalog.categories.filter((category) => !['combo', 'sauces'].includes(category.id))
    : homeCategories
  return (
    <div className={styles.catalog}>
      {combos.length > 0 && (
        <section id="combo" aria-labelledby="combos-title">
          <h2 className={styles.heading} id="combos-title">
            {content.comboTitle}
          </h2>
          <p className={styles.subtitle}>{content.comboSubtitle}</p>
          <div className={styles.comboGrid}>
            {combos.map((combo) => (
              <ComboCard combo={combo} onAction={onComboAction} key={combo.id} />
            ))}
          </div>
        </section>
      )}
      {categories.map((category) => (
        <CategorySection category={category} onProductAction={onProductAction} key={category.id} />
      ))}
    </div>
  )
}

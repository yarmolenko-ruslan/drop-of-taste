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

function ComboCard({
  combo,
  onAction,
}: {
  combo: HomeCombo
  onAction?: (combo: HomeCombo) => void
}) {
  return (
    <article className={styles.comboCard}>
      <div className={styles.comboImageWrap}>
        <img className={styles.comboImage} src={combo.image} alt={combo.name} loading="lazy" />
        <span className={styles.comboBadge}>ВЫГОДА 000 ₽</span>
      </div>
      <div className={styles.comboBody}>
        <h3 className={styles.comboName}>{combo.name}</h3>
        <p className={styles.comboMeta}>000 г · {combo.portions}</p>
        <p className={styles.comboDetails}>{combo.details}</p>
        <p className={styles.comboNote}>На комбо не распространяются другие акции и промокоды</p>
        <div className={styles.comboFooter}>
          <strong className={styles.comboPrice}>000 ₽</strong>
          <span className={styles.comboActionWrap}>
            <CatalogActionButton
              item={{ id: combo.id, name: combo.name, image: combo.image, priceRub: null }}
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
  return (
    <div className={styles.catalog}>
      <section id="combo" aria-labelledby="combos-title">
        <h2 className={styles.heading} id="combos-title">
          Комбо и наборы
        </h2>
        <p className={styles.subtitle}>
          Собрали готовые обеды и наборы на компанию — выгоднее, чем по отдельности.
        </p>
        <div className={styles.comboGrid}>
          {homeCombos.map((combo) => (
            <ComboCard combo={combo} onAction={onComboAction} key={combo.id} />
          ))}
        </div>
      </section>
      {homeCategories.map((category) => (
        <CategorySection category={category} onProductAction={onProductAction} key={category.id} />
      ))}
    </div>
  )
}

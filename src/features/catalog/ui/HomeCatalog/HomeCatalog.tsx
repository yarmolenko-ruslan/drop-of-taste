import { Link } from 'react-router'
import {
  homeCategories,
  homeCombos,
  type HomeCategory,
  type HomeCombo,
} from '../../model/homeCatalog'
import { CatalogActionButton } from '../CatalogActionButton/CatalogActionButton'
import { ProductCard } from '../ProductCard/ProductCard'
import styles from './HomeCatalog.module.css'

function ComboCard({ combo }: { combo: HomeCombo }) {
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
          <CatalogActionButton />
        </div>
      </div>
    </article>
  )
}

function CategorySection({ category }: { category: HomeCategory }) {
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
          <ProductCard key={item.id} product={item} />
        ))}
      </div>
    </section>
  )
}

export function HomeCatalog() {
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
            <ComboCard combo={combo} key={combo.id} />
          ))}
        </div>
      </section>
      {homeCategories.map((category) => (
        <CategorySection category={category} key={category.id} />
      ))}
    </div>
  )
}

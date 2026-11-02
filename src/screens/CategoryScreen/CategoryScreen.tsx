import { Link, useParams } from 'react-router'
import { homeCategories } from '../../features/catalog/model/homeCatalog'
import { ProductCard } from '../../features/catalog/ui/ProductCard/ProductCard'
import styles from './CategoryScreen.module.css'

export function CategoryScreen() {
  const { categoryId } = useParams()
  const category = homeCategories.find(({ id }) => id === categoryId)

  if (!category) {
    return (
      <main className={styles.root}>
        <h1 className={styles.heading}>Раздел не найден</h1>
        <Link className={styles.back} to="/">
          Вернуться на главную
        </Link>
      </main>
    )
  }

  return (
    <main className={styles.root}>
      <nav className={styles.breadcrumbs} aria-label="Навигационная цепочка">
        <Link to="/">Главная</Link>
        <span aria-hidden="true">/</span>
        <span>{category.title}</span>
      </nav>
      <h1 className={styles.heading}>{category.title}</h1>
      <p className={styles.subtitle}>{category.subtitle}</p>
      <div className={styles.grid}>
        {category.products.map((item) => (
          <ProductCard key={item.id} product={item} />
        ))}
      </div>
    </main>
  )
}

import { useState } from 'react'
import { Link, useParams } from 'react-router'
import {
  dialogItemFromProduct,
  dialogItemFromSauce,
  type DialogItem,
} from '../../features/catalog/model/dialogContent'
import { ProductDialog } from '../../features/catalog/ui/ProductDialog/ProductDialog'
import { homeCategories, homeCombos } from '../../features/catalog/model/homeCatalog'
import { ProductCard } from '../../features/catalog/ui/ProductCard/ProductCard'
import { SauceGrid } from '../HomeScreen/HomeClosingSections'
import styles from './CategoryScreen.module.css'
import { CatalogStatus, useCatalog } from '../../features/catalog/api/CatalogProvider'

export function CategoryScreen() {
  const [selectedItem, setSelectedItem] = useState<DialogItem | null>(null)
  const { categoryId } = useParams()
  const catalog = useCatalog()
  const category = catalog?.data
    ? catalog.data.categories.find(({ id }) => id === categoryId)
    : categoryId === 'combo'
      ? {
          id: 'combo',
          title: 'Комбо',
          subtitle: 'Готовые наборы для любого случая',
          products: homeCombos.map((combo) => ({
            ...combo,
            imageAlt: combo.name,
            badges: [] as const,
            action: 'add' as const,
            measure: 'г' as const,
            amount: null,
            calories: null,
            priceRub: null,
          })),
        }
      : homeCategories.find(({ id }) => id === categoryId)
  if (catalog && (!catalog.data || catalog.error))
    return (
      <main className={styles.root}>
        <CatalogStatus />
      </main>
    )

  if (categoryId === 'sauces') {
    return (
      <>
        <main className={styles.root}>
          <nav className={styles.breadcrumbs} aria-label="Навигационная цепочка">
            <Link to="/">Главная</Link>
            <span aria-hidden="true">/</span>
            <span>Соусы</span>
          </nav>
          <h1 className={styles.heading}>Соусы</h1>
          <p>Цены примерные для демонстрации.</p>
          <p className={styles.subtitle}>Добавьте вкуса любимому блюду</p>
          <SauceGrid onSauceAction={(name) => setSelectedItem(dialogItemFromSauce(name))} />
        </main>
        {selectedItem && (
          <ProductDialog
            key={selectedItem.id}
            item={selectedItem}
            onClose={() => setSelectedItem(null)}
          />
        )}
      </>
    )
  }

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
    <>
      <main className={styles.root}>
        <nav className={styles.breadcrumbs} aria-label="Навигационная цепочка">
          <Link to="/">Главная</Link>
          <span aria-hidden="true">/</span>
          <span>{category.title}</span>
        </nav>
        <h1 className={styles.heading}>{category.title}</h1>
        <p>Цены примерные для демонстрации.</p>
        <p className={styles.subtitle}>{category.subtitle}</p>
        <div className={styles.grid}>
          {category.products.map((item) => (
            <ProductCard
              key={item.id}
              product={item}
              onAction={(product) => setSelectedItem(dialogItemFromProduct(product))}
            />
          ))}
        </div>
      </main>
      {selectedItem && (
        <ProductDialog
          key={selectedItem.id}
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
        />
      )}
    </>
  )
}

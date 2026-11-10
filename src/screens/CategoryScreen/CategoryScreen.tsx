import { useState, type ComponentProps } from 'react'
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
import { useInfiniteItems } from '../../shared/lib/useInfiniteItems'
import { ErrorPage } from '../../shared/ui/ErrorPage/ErrorPage'
import errorStyles from '../../shared/ui/ErrorPage/ErrorPage.module.css'
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
  const shownCategory =
    category ??
    (catalog
      ? undefined
      : categoryId === 'sauces'
        ? { id: 'sauces', title: 'Соусы', subtitle: 'Добавьте вкуса любимому блюду', products: [] }
        : undefined)
  if (catalog && (!catalog.data || catalog.error))
    return (
      <main className={styles.root}>
        <CatalogStatus />
      </main>
    )

  if (categoryId === 'sauces' && shownCategory) {
    return (
      <>
        <main className={styles.root}>
          <nav className={styles.breadcrumbs} aria-label="Навигационная цепочка">
            <Link to="/">Главная</Link>
            <span aria-hidden="true">/</span>
            <span>{shownCategory.title}</span>
          </nav>
          <h1 className={styles.heading}>{shownCategory.title}</h1>
          <p className={styles.subtitle}>{shownCategory.subtitle}</p>
          <SauceGrid
            onSauceAction={(name) => {
              const live = catalog?.data?.categories
                .find((item) => item.id === 'sauces')
                ?.products.find((item) => item.name === name)
              setSelectedItem(live ?? dialogItemFromSauce(name))
            }}
          />
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
      <ErrorPage
        code="404"
        title="Раздел меню не найден"
        message="Такого раздела нет в нашем меню — возможно, его уже сняли с подачи. Загляните на главную: там всё самое вкусное."
        actions={
          <Link className={`${errorStyles.action} ${errorStyles.primary}`} to="/">
            На главную
          </Link>
        }
      />
    )
  }

  return (
    <>
      <CategoryProducts
        categoryTitle={category.title}
        categorySubtitle={category.subtitle}
        products={category.products}
        onAction={(product) => setSelectedItem(dialogItemFromProduct(product))}
      />
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

type CategoryProduct = ComponentProps<typeof ProductCard>['product']

function CategoryProducts({
  categoryTitle,
  categorySubtitle,
  products,
  onAction,
}: {
  categoryTitle: string
  categorySubtitle: string
  products: readonly CategoryProduct[]
  onAction: (product: CategoryProduct) => void
}) {
  const { visibleItems, hasMore, sentinelRef, showMore } = useInfiniteItems(products, 6)
  return (
    <main className={styles.root}>
      <nav className={styles.breadcrumbs} aria-label="Навигационная цепочка">
        <Link to="/">Главная</Link>
        <span aria-hidden="true">/</span>
        <span>{categoryTitle}</span>
      </nav>
      <h1 className={styles.heading}>{categoryTitle}</h1>
      <p className={styles.subtitle}>{categorySubtitle}</p>
      <div className={styles.grid}>
        {visibleItems.map((item) => (
          <ProductCard key={item.id} product={item} onAction={onAction} />
        ))}
      </div>
      {/* Сторожок дозагрузки: карточки подгружаются сами при прокрутке к концу */}
      <div ref={sentinelRef} aria-hidden="true" />
      {hasMore && (
        <button type="button" className={styles.showMore} onClick={showMore}>
          Показать ещё
        </button>
      )}
    </main>
  )
}

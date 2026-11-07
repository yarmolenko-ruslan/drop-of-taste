import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { CatalogStatus, useCatalog } from '../../features/catalog/api/CatalogProvider'
import { dialogItemFromProduct, type DialogItem } from '../../features/catalog/model/dialogContent'
import { searchCatalog } from '../../features/catalog/model/searchCatalog'
import { ProductDialog } from '../../features/catalog/ui/ProductDialog/ProductDialog'
import styles from './SearchScreen.module.css'

export function SearchScreen() {
  const [searchParams] = useSearchParams()
  const query = searchParams.get('q')?.trim() ?? ''
  const catalog = useCatalog()
  const results = catalog?.data ? searchCatalog(catalog.data.categories, query) : []
  const [selectedItem, setSelectedItem] = useState<DialogItem | null>(null)

  return (
    <>
      <main className={styles.root}>
        <nav className={styles.breadcrumbs} aria-label="Навигационная цепочка">
          <Link to="/">Главная</Link>
          <span aria-hidden="true">/</span>
          <span>Поиск</span>
        </nav>
        <h1 className={styles.heading}>Поиск по меню</h1>
        {!query ? (
          <p className={styles.message}>Введите название блюда в строке поиска.</p>
        ) : (
          <>
            {catalog?.data && !catalog.error && (
              <p className={styles.summary}>
                По запросу «{query}» найдено: {results.length}
              </p>
            )}
            <CatalogStatus />
            {catalog?.data &&
              !catalog.error &&
              (results.length ? (
                <div className={styles.grid}>
                  {results.map(({ product, categoryId, categoryTitle }) => (
                    <button
                      className={styles.result}
                      type="button"
                      key={`${categoryId}-${product._id}`}
                      onClick={() => setSelectedItem(dialogItemFromProduct(product))}
                    >
                      {product.image ? (
                        <img src={product.image} alt="" loading="lazy" />
                      ) : (
                        <span className={styles.noImage} aria-hidden="true">
                          ◉
                        </span>
                      )}
                      <span className={styles.resultBody}>
                        <span className={styles.category}>{categoryTitle}</span>
                        <strong>{product.name}</strong>
                        <span className={styles.details}>{product.details}</span>
                        <span className={styles.price}>
                          {product.available
                            ? `${(product.priceKopecks / 100).toLocaleString('ru-RU')} ₽`
                            : 'Нет в наличии'}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className={styles.message} role="status">
                  Ничего не нашли. Попробуйте другое название или ингредиент.
                </p>
              ))}
          </>
        )}
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

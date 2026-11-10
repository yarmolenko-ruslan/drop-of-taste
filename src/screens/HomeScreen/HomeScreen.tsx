import { useState } from 'react'
import {
  dialogItemFromCombo,
  dialogItemFromProduct,
  dialogItemFromSauce,
  type DialogItem,
} from '../../features/catalog/model/dialogContent'
import { ProductDialog } from '../../features/catalog/ui/ProductDialog/ProductDialog'
import { HomeCatalog } from '../../features/catalog/ui/HomeCatalog/HomeCatalog'
import { NewArrivals } from '../../features/catalog/ui/NewArrivals/NewArrivals'
import { HomeClosingSections } from './HomeClosingSections'
import { HeroSlider } from './HeroSlider'
import styles from './HomeScreen.module.css'
import { CatalogStatus, useCatalog } from '../../features/catalog/api/CatalogProvider'
import { useSiteContent } from '../../features/site-content/SiteContentProvider'

export function HomeScreen({ onLogin }: { onLogin?: () => void }) {
  const content = useSiteContent()
  const [selectedItem, setSelectedItem] = useState<DialogItem | null>(null)
  const catalog = useCatalog()
  return (
    <>
      <main className={styles.root}>
        <h1 className={styles.title}>{content.siteTitle}</h1>
        <HeroSlider />
        <CatalogStatus />
        {catalog?.data && !catalog.error && (
          <>
            {catalog.data.categories.length === 0 && <p role="status">Меню пока пусто.</p>}
            <NewArrivals
              onProductAction={(product) => setSelectedItem(dialogItemFromProduct(product))}
            />
            <HomeCatalog
              onProductAction={(product) => setSelectedItem(dialogItemFromProduct(product))}
              onComboAction={(combo) => setSelectedItem(dialogItemFromCombo(combo))}
            />
            <HomeClosingSections
              onSauceAction={(name) => {
                const live = catalog?.data?.categories
                  .find((category) => category.id === 'sauces')
                  ?.products.find((item) => item.name === name)
                setSelectedItem(live ?? dialogItemFromSauce(name))
              }}
              onLogin={onLogin}
            />
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

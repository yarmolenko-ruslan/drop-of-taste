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

export function HomeScreen() {
  const [selectedItem, setSelectedItem] = useState<DialogItem | null>(null)
  return (
    <>
      <main className={styles.root}>
        <h1 className={styles.title}>Капела вкуса</h1>
        <HeroSlider />
        <NewArrivals
          onProductAction={(product) => setSelectedItem(dialogItemFromProduct(product))}
        />
        <HomeCatalog
          onProductAction={(product) => setSelectedItem(dialogItemFromProduct(product))}
          onComboAction={(combo) => setSelectedItem(dialogItemFromCombo(combo))}
        />
        <HomeClosingSections onSauceAction={(name) => setSelectedItem(dialogItemFromSauce(name))} />
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

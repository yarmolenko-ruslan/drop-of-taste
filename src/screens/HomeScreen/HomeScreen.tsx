import { HomeCatalog } from '../../features/catalog/ui/HomeCatalog/HomeCatalog'
import { NewArrivals } from '../../features/catalog/ui/NewArrivals/NewArrivals'
import { HeroSlider } from './HeroSlider'
import styles from './HomeScreen.module.css'

export function HomeScreen() {
  return (
    <main className={styles.root}>
      <h1 className={styles.title}>Капела вкуса</h1>
      <HeroSlider />
      <NewArrivals />
      <HomeCatalog />
    </main>
  )
}

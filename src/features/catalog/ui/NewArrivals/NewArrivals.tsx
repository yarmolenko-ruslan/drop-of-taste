import { A11y, Navigation } from 'swiper/modules'
import { Swiper, SwiperSlide } from 'swiper/react'
import 'swiper/css'
import { newArrivals } from '../../model/newArrivals'
import type { CatalogProduct } from '../../model/product'
import { ProductCard } from '../ProductCard/ProductCard'
import styles from './NewArrivals.module.css'
import { useSiteContent } from '../../../site-content/SiteContentProvider'
import { useCatalog } from '../../api/CatalogProvider'

export function NewArrivals({
  onProductAction,
}: {
  onProductAction?: (product: CatalogProduct) => void
}) {
  const { settings } = useSiteContent()
  const catalogState = useCatalog()
  const catalog = catalogState?.data
  const products = catalog
    ? catalog.newArrivalIds.flatMap((id) => {
        const product = catalogState.itemsById.get(id)
        return product ? [product] : []
      })
    : newArrivals
  if (products.length === 0) return null
  return (
    <section className={styles.section} id="new" aria-labelledby="new-arrivals-title">
      <div className={styles.headingRow}>
        <h2 className={styles.heading} id="new-arrivals-title">
          {settings.labels.newArrivals}
        </h2>
        <div className={styles.controls}>
          <button className={styles.previous} type="button" aria-label="Предыдущие новинки">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="m15 5-7 7 7 7" />
            </svg>
          </button>
          <button className={styles.next} type="button" aria-label="Следующие новинки">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="m9 5 7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
      <Swiper
        className={styles.carousel}
        modules={[A11y, Navigation]}
        slidesPerView={1}
        spaceBetween={16}
        speed={550}
        grabCursor
        simulateTouch
        focusableElements="input, select, option, textarea, video, label"
        navigation={{ prevEl: `.${styles.previous}`, nextEl: `.${styles.next}` }}
        breakpoints={{
          521: { slidesPerView: 2, spaceBetween: 16 },
          768: { slidesPerView: 3, spaceBetween: 16 },
          1000: { slidesPerView: 4, spaceBetween: 20 },
        }}
        a11y={{ prevSlideMessage: 'Предыдущие новинки', nextSlideMessage: 'Следующие новинки' }}
      >
        {products.map((product) => (
          <SwiperSlide className={styles.productSlide} key={product.id}>
            <ProductCard product={product} onAction={onProductAction} />
          </SwiperSlide>
        ))}
      </Swiper>
    </section>
  )
}

import { A11y, Autoplay, Navigation, Pagination } from 'swiper/modules'
import { Swiper, SwiperSlide } from 'swiper/react'
import { Link } from 'react-router'
import 'swiper/css'
import 'swiper/css/navigation'
import 'swiper/css/pagination'
import styles from './HeroSlider.module.css'
import { useSiteContent } from '../../features/site-content/SiteContentProvider'

export function HeroSlider() {
  const { heroSlides: slides, promotions } = useSiteContent()
  return (
    <section className={styles.slider} id="promotions" aria-label="Предложения кафе">
      {slides.length > 1 && <div className={styles.pagination} aria-label="Выбор слайда" />}
      {slides.length > 1 && (
        <>
          <button className={styles.previous} type="button" aria-label="Предыдущий слайд">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="m15 5-7 7 7 7" />
            </svg>
          </button>
          <button className={styles.next} type="button" aria-label="Следующий слайд">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="m9 5 7 7-7 7" />
            </svg>
          </button>
        </>
      )}
      <Swiper
        className={styles.carousel}
        modules={[A11y, Autoplay, Navigation, Pagination]}
        slidesPerView={1}
        speed={650}
        loop={slides.length > 1}
        grabCursor
        simulateTouch
        navigation={
          slides.length > 1 ? { prevEl: `.${styles.previous}`, nextEl: `.${styles.next}` } : false
        }
        pagination={slides.length > 1 ? { el: `.${styles.pagination}`, clickable: true } : false}
        autoplay={
          slides.length > 1
            ? { delay: 5000, disableOnInteraction: false, pauseOnMouseEnter: true }
            : false
        }
        a11y={{
          prevSlideMessage: 'Предыдущий слайд',
          nextSlideMessage: 'Следующий слайд',
          paginationBulletMessage: 'Перейти к слайду {{index}}',
        }}
      >
        {slides.map((slide, index) => (
          <SwiperSlide key={slide.id}>
            <div className={styles.slide}>
              <Link
                className={styles.slideLink}
                to={
                  slide.href ??
                  (promotions.some((promotion) => promotion.id === slide.id)
                    ? `/promotions/${slide.id}`
                    : '/promotions')
                }
                aria-label={slide.title}
              >
                <img
                  className={styles.image}
                  src={slide.image}
                  alt={slide.imageAlt}
                  width="1400"
                  height="788"
                  fetchPriority={index === 0 ? 'high' : undefined}
                  loading={index === 0 ? 'eager' : 'lazy'}
                />
              </Link>
            </div>
          </SwiperSlide>
        ))}
      </Swiper>
    </section>
  )
}

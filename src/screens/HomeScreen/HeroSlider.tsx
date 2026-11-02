import { A11y, Autoplay, Navigation, Pagination } from 'swiper/modules'
import { Swiper, SwiperSlide } from 'swiper/react'
import 'swiper/css'
import 'swiper/css/navigation'
import 'swiper/css/pagination'
import styles from './HeroSlider.module.css'

const slides = [
  {
    id: 'birthday',
    badge: 'АКЦИЯ',
    title: 'Скидка 10% в день рождения',
    description: 'По паспорту · скидки не суммируются',
    image: '/banners/cafe-exterior.jpg',
    imageAlt: 'Фасад кафе «Капела вкуса» вечером',
  },
  {
    id: 'cafe',
    badge: 'О НАС',
    title: 'Больше, чем еда — это наш край',
    description: 'Домашняя кухня, тёплая атмосфера и любимые вкусы',
    image: '/banners/cafe-interior.jpg',
    imageAlt: 'Уютный зал кафе с тёплым освещением',
  },
  {
    id: 'breakfast',
    badge: 'ЗАВТРАКИ',
    title: 'Доброе утро начинается с завтрака',
    description: 'Сырники, горячий кофе и немного времени для себя',
    image: '/banners/breakfast.jpg',
    imageAlt: 'Сырники с ягодами и чашка кофе',
  },
] as const

export function HeroSlider() {
  return (
    <section className={styles.slider} aria-label="Предложения кафе">
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
              <div className={styles.content}>
                <span className={styles.badge}>{slide.badge}</span>
                <div>
                  <h2 className={styles.title}>{slide.title}</h2>
                  <p className={styles.description}>{slide.description}</p>
                </div>
              </div>
              <img
                className={styles.image}
                src={slide.image}
                alt={slide.imageAlt}
                width="1400"
                height="788"
                fetchPriority={index === 0 ? 'high' : undefined}
                loading={index === 0 ? 'eager' : 'lazy'}
              />
            </div>
          </SwiperSlide>
        ))}
      </Swiper>
    </section>
  )
}

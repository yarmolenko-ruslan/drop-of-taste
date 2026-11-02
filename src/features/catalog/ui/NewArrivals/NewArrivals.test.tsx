import { render, screen } from '@testing-library/react'
import { NewArrivals } from './NewArrivals'

test('показывает восемь новинок и использует Swiper без автопрокрутки и точек', () => {
  render(<NewArrivals />)

  expect(screen.getByRole('heading', { name: 'Новинки' })).toBeInTheDocument()
  expect(screen.getAllByRole('article')).toHaveLength(8)
  expect(screen.getByRole('button', { name: 'Предыдущие новинки' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Следующие новинки' })).toBeInTheDocument()

  const swiper = document.querySelector('.swiper') as
    (HTMLElement & { swiper?: import('swiper').Swiper }) | null
  expect(swiper?.swiper?.params.autoplay).toBeFalsy()
  expect(swiper?.swiper?.params.simulateTouch).toBe(true)
  expect(swiper?.swiper?.params.breakpoints?.[1000]).toMatchObject({ slidesPerView: 4 })
  expect(document.querySelector('.swiper-pagination')).not.toBeInTheDocument()
})

import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { HeroSlider } from './HeroSlider'

test('Swiper показывает слайды, стрелки и точки навигации', () => {
  render(
    <MemoryRouter>
      <HeroSlider />
    </MemoryRouter>,
  )

  expect(screen.getByRole('region', { name: 'Предложения кафе' })).toBeInTheDocument()
  expect(screen.getAllByRole('group', { name: /\d \/ 3/ })).toHaveLength(3)
  expect(screen.getByRole('button', { name: 'Предыдущий слайд' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Следующий слайд' })).toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: /Перейти к слайду/ })).toHaveLength(3)
  expect(screen.getByRole('link', { name: /Скидка 10% в день рождения/ })).toHaveAttribute(
    'href',
    '/promotions/birthday',
  )

  const swiper = document.querySelector('.swiper') as
    (HTMLElement & { swiper?: import('swiper').Swiper }) | null
  expect(swiper?.swiper?.params.autoplay).toMatchObject({ delay: 5000 })
  expect(swiper?.swiper?.params.simulateTouch).toBe(true)
  expect(swiper?.swiper?.params.loop).toBe(true)
})

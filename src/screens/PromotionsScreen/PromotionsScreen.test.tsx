import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { PromotionsScreen } from './PromotionsScreen'

test('показывает акции и фильтрует их по способу получения', async () => {
  const user = userEvent.setup()
  render(
    <MemoryRouter>
      <PromotionsScreen />
    </MemoryRouter>,
  )

  expect(screen.getAllByRole('article')).toHaveLength(6)
  await user.click(screen.getByRole('button', { name: 'Самовывоз' }))
  expect(screen.getAllByRole('article')).toHaveLength(1)
  expect(screen.getByRole('heading', { name: 'Скидка на самовывоз' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: '5% бонусами' })).not.toBeInTheDocument()
})

test('открывает страницу акции с подробностями по ссылке с баннера', () => {
  render(
    <MemoryRouter initialEntries={['/promotions/birthday']}>
      <Routes><Route path="/promotions/:promotionId" element={<PromotionsScreen />} /></Routes>
    </MemoryRouter>,
  )
  expect(screen.getByRole('heading', { name: /день рождения/i })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Условия акции' })).toBeInTheDocument()
  expect(screen.getByRole('article').querySelector('img')).toHaveAttribute('src', '/banners/cafe-exterior.jpg')
})

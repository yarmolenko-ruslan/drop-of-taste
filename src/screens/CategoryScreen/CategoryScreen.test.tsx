import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { CategoryScreen } from './CategoryScreen'

test('ссылка раздела открывает список товаров категории', () => {
  render(
    <MemoryRouter initialEntries={['/menu/soups']}>
      <Routes>
        <Route path="/menu/:categoryId" element={<CategoryScreen />} />
      </Routes>
    </MemoryRouter>,
  )

  expect(screen.getByRole('heading', { level: 1, name: 'Супы' })).toBeInTheDocument()
  expect(screen.getAllByRole('article')).toHaveLength(4)
  expect(screen.getByRole('heading', { name: 'Борщ с пампушками' })).toBeInTheDocument()
})

test('раздел соусов открывается по ссылке с главной', () => {
  render(
    <MemoryRouter initialEntries={['/menu/sauces']}>
      <Routes>
        <Route path="/menu/:categoryId" element={<CategoryScreen />} />
      </Routes>
    </MemoryRouter>,
  )

  expect(screen.getByRole('heading', { level: 1, name: 'Соусы' })).toBeInTheDocument()
  expect(screen.getAllByRole('article')).toHaveLength(5)
})

test('страница комбо открывается как отдельный раздел', () => {
  render(
    <MemoryRouter initialEntries={['/menu/combo']}>
      <Routes>
        <Route path="/menu/:categoryId" element={<CategoryScreen />} />
      </Routes>
    </MemoryRouter>,
  )
  expect(screen.getByRole('heading', { level: 1, name: 'Комбо' })).toBeInTheDocument()
  expect(screen.getAllByRole('article')).toHaveLength(4)
})

test('карточка открывает описание выбранного блюда', () => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
  render(
    <MemoryRouter initialEntries={['/menu/soups']}>
      <Routes>
        <Route path="/menu/:categoryId" element={<CategoryScreen />} />
      </Routes>
    </MemoryRouter>,
  )

  fireEvent.click(screen.getByRole('button', { name: 'Подробнее о блюде «Борщ с пампушками»' }))
  expect(screen.getByRole('dialog', { name: 'Борщ с пампушками' })).toBeInTheDocument()
  expect(screen.getByText(/Наваристый борщ на говяжьем бульоне/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Закрыть окно' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

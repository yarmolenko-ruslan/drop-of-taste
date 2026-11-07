import { fireEvent, render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { CafeMapDialog } from './CafeMapDialog'

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})

test('показывает карту кафе и открывает маршрут', () => {
  const open = vi.spyOn(window, 'open').mockImplementation(() => null)
  const cafeAddress = 'г. Красноярск, улица Петра Подзолкова, 3и'
  render(<CafeMapDialog onClose={() => {}} />)

  expect(screen.getByRole('dialog', { name: 'Самовывоз из кафе' })).toBeInTheDocument()
  expect(screen.getByText(cafeAddress)).toBeInTheDocument()
  expect(
    screen.getByTitle(`Кафе «Капела вкуса» на Яндекс Карте: ${cafeAddress}`),
  ).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Маршрут до кафе' }))
  expect(open).toHaveBeenCalledWith(
    'https://yandex.ru/maps/?rtext=~56.049189,92.884165',
    '_blank',
    'noopener,noreferrer',
  )
  open.mockRestore()
})

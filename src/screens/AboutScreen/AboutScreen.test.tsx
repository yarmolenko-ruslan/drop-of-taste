import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { AboutScreen } from './AboutScreen'

const cafeAddress = 'г. Красноярск, улица Петра Подзолкова, 3и'

test('показывает описание ресторана и карту конкретной организации', () => {
  render(
    <MemoryRouter>
      <AboutScreen />
    </MemoryRouter>,
  )

  expect(screen.getByRole('heading', { name: 'О кафе', level: 1 })).toBeInTheDocument()
  expect(screen.getAllByText(cafeAddress)).toHaveLength(2)
  const map = screen.getByTitle(`Кафе «Капела вкуса» на карте: ${cafeAddress}`)
  expect(map).toHaveAttribute(
    'src',
    'https://yandex.ru/map-widget/v1/?ll=92.884165%2C56.049189&mode=search&oid=172905214895&ol=biz&z=16.73',
  )
  expect(screen.getByRole('status')).toHaveTextContent('Загружаем карту…')
  fireEvent.load(map)
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

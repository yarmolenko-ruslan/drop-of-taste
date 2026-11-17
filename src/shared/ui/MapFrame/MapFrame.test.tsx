import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, test, vi } from 'vitest'
import { MapFrame } from './MapFrame'

afterEach(() => vi.useRealTimers())

test('изменение адреса карты сбрасывает ошибку старого источника', () => {
  vi.useFakeTimers()
  const { rerender } = render(
    <MapFrame src="https://example.com/old" title="Карта" routeUrl="https://example.com/" />,
  )
  act(() => vi.advanceTimersByTime(12000))
  expect(screen.getByRole('alert')).toBeInTheDocument()
  rerender(<MapFrame src="https://example.com/new" title="Карта" routeUrl="https://example.com/" />)
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByTitle('Карта')).toHaveAttribute('src', 'https://example.com/new')
})

test('при долгой загрузке основной карты переключается на резервную, затем показывает ошибку', () => {
  vi.useFakeTimers()
  render(
    <MapFrame
      src="https://yandex.ru/map-widget/v1/"
      backupSrc="https://maps.example.com/embed"
      routeUrl="https://yandex.ru/maps/"
      title="Карта кафе"
    />,
  )

  expect(screen.getByRole('status')).toHaveTextContent('Загружаем карту…')
  act(() => vi.advanceTimersByTime(12000))
  expect(screen.getByTitle('Карта кафе')).toHaveAttribute('src', 'https://maps.example.com/embed')
  expect(screen.getByRole('status')).toHaveTextContent('Загружаем резервную карту…')
  act(() => vi.advanceTimersByTime(12000))
  expect(screen.getByRole('alert')).toHaveTextContent('Не удалось загрузить карту')
  expect(screen.queryByTitle('Карта кафе')).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Открыть маршрут отдельно' })).toHaveAttribute(
    'href',
    'https://yandex.ru/maps/',
  )

  fireEvent.click(screen.getByRole('button', { name: 'Попробовать ещё раз' }))
  expect(screen.getByTitle('Карта кафе')).toHaveAttribute('src', 'https://yandex.ru/map-widget/v1/')
})

test('можно вручную переключиться, когда iframe сообщает о загрузке, но карта пуста', () => {
  vi.useFakeTimers()
  render(
    <MapFrame
      src="https://yandex.ru/map-widget/v1/"
      backupSrc="https://maps.example.com/embed"
      routeUrl="https://yandex.ru/maps/"
      title="Карта кафе"
    />,
  )
  fireEvent.load(screen.getByTitle('Карта кафе'))
  fireEvent.click(screen.getByRole('button', { name: 'Карта не отображается?' }))
  expect(screen.getByTitle('Карта кафе')).toHaveAttribute('src', 'https://maps.example.com/embed')
  act(() => vi.advanceTimersByTime(12000))
  expect(screen.getByRole('alert')).toHaveTextContent('Не удалось загрузить карту')
})

test('без резервной ссылки показывает ошибку и кнопку повторной загрузки', () => {
  vi.useFakeTimers()
  render(
    <MapFrame
      src="https://yandex.ru/map-widget/v1/"
      routeUrl="https://yandex.ru/maps/"
      title="Карта кафе"
    />,
  )
  act(() => vi.advanceTimersByTime(12000))
  expect(screen.getByRole('alert')).toHaveTextContent('Не удалось загрузить карту')
  fireEvent.click(screen.getByRole('button', { name: 'Попробовать ещё раз' }))
  expect(screen.getByRole('status')).toHaveTextContent('Загружаем карту…')
})

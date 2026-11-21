import { act, renderHook } from '@testing-library/react'
import { defaultSiteContent } from '../../../shared/site-content'
import { usePromotionActive } from './usePromotionActive'

afterEach(() => vi.useRealTimers())

test('акция начинается и заканчивается без обновления данных с сервера', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-21T10:00:00Z'))
  const promotion = {
    ...defaultSiteContent.promotions[0]!,
    startsAt: '2026-11-21T10:00:01Z',
    endsAt: '2026-11-21T10:00:02Z',
  }
  const { result, unmount } = renderHook(() => usePromotionActive(promotion))
  expect(result.current).toBe(false)
  act(() => vi.advanceTimersByTime(1000))
  expect(result.current).toBe(true)
  act(() => vi.advanceTimersByTime(1000))
  expect(result.current).toBe(false)
  unmount()
  expect(vi.getTimerCount()).toBe(0)
})

test('перенос срока и отключение отменяют прежние границы; далёкая дата не переполняет таймер', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-21T10:00:00Z'))
  const promotion = { ...defaultSiteContent.promotions[0]!, startsAt: '2099-01-01T00:00:00Z' }
  const { result, rerender, unmount } = renderHook(({ value }) => usePromotionActive(value), {
    initialProps: { value: promotion },
  })
  act(() => vi.advanceTimersByTime(60_000))
  expect(result.current).toBe(false)
  rerender({ value: { ...promotion, startsAt: '2026-11-21T10:01:01Z' } })
  act(() => vi.advanceTimersByTime(1000))
  expect(result.current).toBe(true)
  rerender({ value: { ...promotion, startsAt: '', enabled: false } })
  expect(result.current).toBe(false)
  unmount()
  expect(vi.getTimerCount()).toBe(0)
})

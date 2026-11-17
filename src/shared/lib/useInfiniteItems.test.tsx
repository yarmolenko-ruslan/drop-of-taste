import { act, render, screen } from '@testing-library/react'
import { vi } from 'vitest'

test('продолжает загрузку, пока сторожок остаётся в области наблюдения', async () => {
  const callbacks: IntersectionObserverCallback[] = []
  const disconnect = vi.fn()
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        callbacks.push(callback)
      }
      observe() {}
      disconnect = disconnect
    },
  )
  try {
    const { useInfiniteItems } = await import('./useInfiniteItems')
    const items = Array.from({ length: 20 }, (_, index) => index)
    function List() {
      const { visibleItems, sentinelRef } = useInfiniteItems(items, 6)
      return (
        <>
          <span data-testid="count">{visibleItems.length}</span>
          <div ref={sentinelRef} />
        </>
      )
    }
    render(<List />)
    expect(screen.getByTestId('count')).toHaveTextContent('6')
    for (const count of [12, 18, 20]) {
      act(() =>
        callbacks.at(-1)!(
          [{ isIntersecting: true }] as IntersectionObserverEntry[],
          {} as IntersectionObserver,
        ),
      )
      expect(screen.getByTestId('count')).toHaveTextContent(String(count))
    }
    expect(callbacks).toHaveLength(3)
    expect(disconnect).toHaveBeenCalledTimes(3)
  } finally {
    vi.unstubAllGlobals()
  }
})

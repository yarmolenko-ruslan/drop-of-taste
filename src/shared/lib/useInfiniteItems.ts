import { useEffect, useRef, useState } from 'react'

const IO_AVAILABLE = typeof IntersectionObserver !== 'undefined'

type InfiniteItems<T> = {
  /** Уже показанные элементы — первый батч и всё, что догрузилось при прокрутке. */
  visibleItems: readonly T[]
  /** true, если впереди ещё есть скрытые элементы. */
  hasMore: boolean
  /** Повесить на элемент-«сторожок» после списка: виден → подгружаем следующий батч. */
  sentinelRef: React.RefObject<HTMLDivElement | null>
  /** Ручная дозагрузка (кнопка «Показать ещё»). */
  showMore: () => void
}

/**
 * Прогрессивный показ длинных списков: сначала первый батч, остальное
 * подгружается само при приближении к концу прокрутки (IntersectionObserver).
 * Если IntersectionObserver недоступен (старые браузеры, тестовое окружение),
 * показываем всё сразу — список остаётся полностью доступным.
 */
export function useInfiniteItems<T>(items: readonly T[], batchSize = 8): InfiniteItems<T> {
  const [shownCount, setShownCount] = useState(batchSize)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const total = items.length
  // Без IntersectionObserver (старые браузеры, тестовое окружение) показываем всё сразу —
  // список остаётся полностью доступным.
  const visibleCount = IO_AVAILABLE ? Math.min(shownCount, total) : total
  const hasMore = IO_AVAILABLE && visibleCount < total

  // Список заметно укоротился (смена категории, фильтр): visibleCount ограничен total,
  // поэтому отдельный сброс не нужен — при возврате к длинному списку сторожок
  // догрузит остаток с того же места.
  const showMore = () => setShownCount((current) => Math.min(current + batchSize, total))

  useEffect(() => {
    if (!hasMore) return
    const node = sentinelRef.current
    if (!node) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) showMore()
      },
      { rootMargin: '800px 0px' }, // грузим заранее, до самого конца списка
    )
    observer.observe(node)
    return () => observer.disconnect()
    // showMore стабилен по смыслу; пересоздаём наблюдатель при смене состава
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, total, batchSize])

  return { visibleItems: items.slice(0, visibleCount), hasMore, sentinelRef, showMore }
}

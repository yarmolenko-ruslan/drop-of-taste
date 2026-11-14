import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import styles from './SiteHeader.module.css'

type CategoryScrollerProps = {
  children: ReactNode
  compact?: boolean
}

export function CategoryScroller({ children, compact = false }: CategoryScrollerProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ x: number; scrollLeft: number; dragging: boolean } | null>(null)
  const suppressClickRef = useRef(false)
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [dragging, setDragging] = useState(false)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  const updateEdges = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    setCanScrollLeft(viewport.scrollLeft > 1)
    setCanScrollRight(viewport.scrollLeft + viewport.clientWidth < viewport.scrollWidth - 1)
  }, [])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    updateEdges()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateEdges)
    observer?.observe(viewport)
    if (viewport.firstElementChild) observer?.observe(viewport.firstElementChild)
    window.addEventListener('resize', updateEdges)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', updateEdges)
    }
  }, [children, updateEdges])

  useEffect(
    () => () => {
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current)
    },
    [],
  )

  const scrollOneCategory = (direction: -1 | 1) => {
    const viewport = viewportRef.current
    const list = viewport?.firstElementChild
    if (!viewport || !list) return
    const links = Array.from(list.children) as HTMLElement[]
    const origin = links[0]?.offsetLeft ?? 0
    const positions = links.map((link) => link.offsetLeft - origin)
    const current = viewport.scrollLeft
    const target =
      direction === 1
        ? positions.find((position) => position > current + 1)
        : positions.findLast((position) => position < current - 1)
    viewport.scrollTo({
      left: target ?? (direction === 1 ? viewport.scrollWidth : 0),
      behavior: 'smooth',
    })
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return
    dragRef.current = {
      x: event.clientX,
      scrollLeft: event.currentTarget.scrollLeft,
      dragging: false,
    }
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const distance = event.clientX - drag.x
    if (!drag.dragging && Math.abs(distance) > 5) {
      drag.dragging = true
      event.currentTarget.setPointerCapture(event.pointerId)
      setDragging(true)
    }
    if (drag.dragging) {
      event.preventDefault()
      event.currentTarget.scrollLeft = drag.scrollLeft - distance
      updateEdges()
    }
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.dragging) {
      suppressClickRef.current = true
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current)
      clickTimerRef.current = setTimeout(() => {
        suppressClickRef.current = false
      }, 0)
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    }
    dragRef.current = null
    setDragging(false)
  }

  return (
    <nav
      className={`${compact ? styles.compactNav : styles.container} ${styles.scroller}`}
      aria-label="Категории меню"
    >
      <button
        className={styles.scrollArrow}
        type="button"
        aria-label="Прокрутить категории влево"
        disabled={!canScrollLeft}
        onClick={() => scrollOneCategory(-1)}
      >
        <span aria-hidden="true">‹</span>
      </button>
      <div
        className={`${styles.scrollWindow} ${canScrollLeft ? styles.hasLeft : ''} ${canScrollRight ? styles.hasRight : ''}`}
      >
        <div
          className={`${styles.scrollViewport} ${dragging ? styles.dragging : ''}`}
          ref={viewportRef}
          onScroll={updateEdges}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onClickCapture={(event) => {
            if (!suppressClickRef.current) return
            event.preventDefault()
            event.stopPropagation()
            suppressClickRef.current = false
          }}
        >
          <div className={compact ? styles.compactCategories : styles.categoryList}>{children}</div>
        </div>
      </div>
      <button
        className={styles.scrollArrow}
        type="button"
        aria-label="Прокрутить категории вправо"
        disabled={!canScrollRight}
        onClick={() => scrollOneCategory(1)}
      >
        <span aria-hidden="true">›</span>
      </button>
    </nav>
  )
}

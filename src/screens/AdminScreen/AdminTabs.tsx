import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import styles from './AdminScreen.module.css'

export type Tab =
  | 'orders'
  | 'clients'
  | 'content'
  | 'promotions'
  | 'codes'
  | 'categories'
  | 'products'
  | 'legal'
  | 'logs'
  | 'iiko'

const adminSections: readonly (readonly [Tab, string])[] = [
  ['orders', 'Заказы'],
  ['clients', 'Клиенты'],
  ['content', 'Сайт и баннеры'],
  ['promotions', 'Акции'],
  ['codes', 'Бонус-коды'],
  ['categories', 'Разделы меню'],
  ['products', 'Товары'],
  ['legal', 'Документы'],
  ['logs', 'Журнал'],
  ['iiko', 'iiko'],
]

export function AdminTabs({ tab, onSelect }: { tab: Tab; onSelect: (tab: Tab) => void }) {
  const navRef = useRef<HTMLElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const fullWidthRef = useRef(0)
  const [collapsed, setCollapsed] = useState(false)
  const [open, setOpen] = useState(false)

  useLayoutEffect(() => {
    const nav = navRef.current
    const list = listRef.current
    if (!nav || !list) return
    const measure = () => {
      if (!collapsed) fullWidthRef.current = list.scrollWidth
      setCollapsed(fullWidthRef.current > nav.clientWidth)
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(nav)
    if (!collapsed) observer?.observe(list)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [collapsed])

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (!navRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  return (
    <nav
      ref={navRef}
      className={`${styles.tabs} ${collapsed ? styles.tabsCollapsed : ''}`}
      aria-label="Разделы панели"
    >
      {collapsed && (
        <button
          className={styles.tabsToggle}
          type="button"
          aria-expanded={open}
          aria-controls="admin-section-list"
          onClick={() => setOpen((current) => !current)}
        >
          <span aria-hidden="true">☰</span> Разделы
        </button>
      )}
      <div
        id="admin-section-list"
        ref={listRef}
        className={styles.tabList}
        hidden={collapsed && !open}
      >
        {adminSections.map(([id, label]) => (
          <button
            type="button"
            key={id}
            className={tab === id ? styles.active : ''}
            aria-current={tab === id ? 'page' : undefined}
            onClick={() => {
              onSelect(id)
              setOpen(false)
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </nav>
  )
}

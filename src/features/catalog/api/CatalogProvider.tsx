/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { apiRequest } from '../../auth/api/authApi'
import { subscribeSiteUpdate } from '../../../shared/lib/siteUpdates'
import { Spinner } from '../../../shared/ui/Spinner/Spinner'
import styles from './CatalogStatus.module.css'
import type { CatalogProduct } from '../model/product'
import type { DialogItem } from '../model/dialogContent'

export type ApiCatalogItem = Omit<DialogItem, 'priceRub'> &
  CatalogProduct & {
    _id: string
    categoryId: string
    priceKopecks: number
    available: boolean
    portions?: string
  }
type CatalogData = {
  categories: { id: string; title: string; subtitle: string; products: ApiCatalogItem[] }[]
  newArrivalIds: string[]
}
type CatalogState = {
  data: CatalogData | null
  /** Плоский индекс товаров по id — поиск O(1) вместо обхода всех категорий на каждый рендер. */
  itemsById: ReadonlyMap<string, ApiCatalogItem>
  loading: boolean
  error: string
  retry: () => void
}
const CatalogContext = createContext<CatalogState | null>(null)

function buildItemsById(data: CatalogData | null): ReadonlyMap<string, ApiCatalogItem> {
  const map = new Map<string, ApiCatalogItem>()
  if (!data) return map
  for (const category of data.categories) {
    for (const product of category.products) map.set(product._id, product)
  }
  return map
}

export function CatalogProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<CatalogData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    apiRequest<CatalogData>('/catalog')
      .then((result) => {
        if (!active) return
        if (!Array.isArray(result.categories)) throw new Error('Меню пока недоступно')
        setData(result)
        setError('')
      })
      .catch((failure) => {
        if (active) setError(failure instanceof Error ? failure.message : 'Меню недоступно')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [attempt])
  // Индекс и значение контекста стабильны между рендерами: потребители
  // (карточки товаров, диалоги) не перерисовываются без изменения данных.
  const itemsById = useMemo(() => buildItemsById(data), [data])
  const retry = useMemo(
    () => () => {
      setLoading(true)
      setAttempt((value) => value + 1)
    },
    [],
  )
  useEffect(() => subscribeSiteUpdate('catalog', retry), [retry])
  const value = useMemo(
    () => ({ data, itemsById, loading, error, retry }),
    [data, itemsById, loading, error, retry],
  )
  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>
}

export function useCatalog() {
  return useContext(CatalogContext)
}
export function useCatalogItem(id: string): ApiCatalogItem | undefined {
  const catalog = useCatalog()
  return catalog?.itemsById.get(id)
}
export function CatalogStatus() {
  const catalog = useCatalog()
  if (!catalog) return null
  if (catalog.loading)
    return (
      <div className={styles.status}>
        <Spinner label="Загружаем меню…" />
      </div>
    )
  if (catalog.error)
    return (
      <div className={styles.status}>
        <div className={styles.alert} role="alert">
          <span className={styles.icon} aria-hidden="true">
            <svg viewBox="0 0 24 24" width="30" height="30" fill="none">
              <path
                d="M4 10h13v5.5A5.5 5.5 0 0 1 11.5 21h-2A5.5 5.5 0 0 1 4 15.5V10Z"
                stroke="currentColor"
                strokeWidth="1.7"
              />
              <path
                d="M17 11.5h1.2a2.8 2.8 0 0 1 0 5.6H17"
                stroke="currentColor"
                strokeWidth="1.7"
              />
              <path
                d="M8 6.5c-1-1.2 1-1.8 0-3M12 6.5c-1-1.2 1-1.8 0-3"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <p className={styles.message}>{catalog.error}</p>
          <button type="button" className={styles.retry} onClick={catalog.retry}>
            Повторить загрузку
          </button>
        </div>
      </div>
    )
  return null
}

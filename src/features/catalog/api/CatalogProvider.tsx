/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { apiRequest } from '../../auth/api/authApi'
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
type CatalogState = { data: CatalogData | null; loading: boolean; error: string; retry: () => void }
const CatalogContext = createContext<CatalogState | null>(null)

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
        if (!result.categories?.length) throw new Error('Меню пока недоступно')
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
  return (
    <CatalogContext.Provider
      value={{
        data,
        loading,
        error,
        retry: () => {
          setLoading(true)
          setAttempt((value) => value + 1)
        },
      }}
    >
      {children}
    </CatalogContext.Provider>
  )
}

export function useCatalog() {
  return useContext(CatalogContext)
}
export function useCatalogItem(id: string): ApiCatalogItem | undefined {
  const data = useCatalog()?.data
  return data?.categories.flatMap((category) => category.products).find((item) => item._id === id)
}
export function CatalogStatus() {
  const catalog = useCatalog()
  if (!catalog) return null
  if (catalog.loading) return <p role="status">Загружаем меню…</p>
  if (catalog.error)
    return (
      <div role="alert">
        <p>{catalog.error}</p>
        <button type="button" onClick={catalog.retry}>
          Повторить загрузку
        </button>
      </div>
    )
  return null
}

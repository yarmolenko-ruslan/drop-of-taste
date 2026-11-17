import type { SiteContent } from '../../../shared/site-content'

type Category = { _id: string; title: string; subtitle: string; sortOrder: number }
export type Product = {
  _id: string
  categoryId: string
  sortOrder: number
  name: string
  details: string
  description: string
  image: string
  imageAlt: string
  badges: string[]
  action: 'add' | 'choose'
  measure: 'г' | 'мл'
  amount: number | null
  calories: number | null
  ingredients: string[]
  allergenNote: string
  extras: string[]
  portions: string
  priceKopecks: number
  available: boolean
}
export type Dashboard = {
  content: SiteContent
  categories: Category[]
  products: Product[]
  iikoConfigured: boolean
}

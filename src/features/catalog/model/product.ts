export type ProductBadge = 'new' | 'lenten' | 'hit' | 'spicy' | 'discount'

export type CatalogProduct = {
  id: string
  name: string
  details: string
  image: string
  imageAlt: string
  badges: readonly ProductBadge[]
  action: 'add' | 'choose'
  measure: 'г' | 'мл'
  amount: number | null
  calories: number | null
  priceRub: number | null
}

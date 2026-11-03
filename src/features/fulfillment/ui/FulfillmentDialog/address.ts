export type AddressDetails = {
  street: string
  entrance: string
  floor: string
  flat: string
  comment: string
  isHouse: boolean
}

export function formatAddress(details: AddressDetails): string {
  const parts = [details.street.trim()]
  if (!details.isHouse) {
    if (details.entrance.trim()) parts.push(`подъезд ${details.entrance.trim()}`)
    if (details.floor.trim()) parts.push(`${details.floor.trim()} этаж`)
    if (details.flat.trim()) parts.push(`квартира ${details.flat.trim()}`)
  }
  return parts.join(', ')
}

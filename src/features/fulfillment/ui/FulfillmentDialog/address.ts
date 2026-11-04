import type { AddressDetails } from '../../../../../shared/validation/address'

export { addressDetailsSchema } from '../../../../../shared/validation/address'
export type { AddressDetails } from '../../../../../shared/validation/address'

export function formatAddress(details: AddressDetails): string {
  const parts = [details.street]
  if (!details.isHouse) {
    if (details.entrance) parts.push(`подъезд ${details.entrance}`)
    if (details.floor) parts.push(`${details.floor} этаж`)
    if (details.flat) parts.push(`квартира ${details.flat}`)
  }
  return parts.join(', ')
}

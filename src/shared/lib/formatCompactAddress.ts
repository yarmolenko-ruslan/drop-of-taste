import type { AddressDetails } from '../../../shared/validation/address'

const streetTypePattern =
  /^(улица\s+|ул(?:\.\s*|\s+)|проспект\s+|просп(?:\.\s*|\s+)|пр-т\s+|переулок\s+|пер(?:\.\s*|\s+)|бульвар\s+|б-р\s+)/i
const addressPartPattern =
  /^(?:дом(?:\s|$)|д\.\s*|подъезд(?:\s|$)|под\.\s*|этаж(?:\s|$)|эт\.\s*|квартира(?:\s|$)|кв\.\s*)/i

/** Компактное отображение адреса без изменения сохранённых данных. */
export function formatCompactAddress(details: AddressDetails): string {
  let street = details.street.trim().replace(/\s+/g, ' ')
  let city = ''
  const segments = street.split(/\s*,\s*/).filter(Boolean)
  const first = segments[0] ?? ''
  const second = segments[1] ?? ''
  const firstIsStreet = streetTypePattern.test(first)
  const secondIsAddress = /\p{L}/u.test(second) && !addressPartPattern.test(second)
  if (segments.length > 1 && !firstIsStreet && secondIsAddress) {
    city = first.replace(/^(?:город|г\.?)\s*/i, '').trim()
    city = city.replace(/\p{L}/u, (letter) => letter.toLocaleUpperCase('ru-RU'))
    street = segments.slice(1).join(', ')
  }
  const type = street.match(streetTypePattern)
  let prefix = 'ул.'
  if (type) {
    const kind = type[0].toLowerCase().trim()
    if (/^просп|^пр-т/.test(kind)) prefix = 'Пр-т'
    else if (/^пер/.test(kind)) prefix = 'Пер.'
    else if (/^бульвар|^б-р/.test(kind)) prefix = 'Б-р'
    street = street.slice(type[0].length).trim()
  }

  const house = street.match(/(?:,\s*|\s+)(?:(?:дом|д\.)\s*)?(\d[\d\p{L}/-]*)$/iu)
  if (house) street = street.slice(0, house.index).trim().replace(/,$/, '')
  street = street.replace(/\p{L}/u, (letter) => letter.toLocaleUpperCase('ru-RU'))
  const parts = [
    ...(city ? [`г. ${city}`] : []),
    `${prefix} ${street}${house ? `, д. ${house[1]}` : ''}`,
  ]
  if (!details.isHouse) {
    if (details.entrance) parts.push(`под. ${details.entrance}`)
    if (details.floor) parts.push(`эт. ${details.floor}`)
    if (details.flat) parts.push(`кв. ${details.flat}`)
  }
  return parts.join(', ')
}

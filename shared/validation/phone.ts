import { z } from 'zod'

export const INVALID_PHONE_MESSAGE = 'Введите российский мобильный номер'

export function normalizeRussianMobilePhone(value: string): string | null {
  // Плюс допустим только в начале: «7+999…» не считается корректной записью номера.
  if (!/^\+?[\d\s()-]+$/.test(value)) return null
  const digits = value.replace(/\D/g, '')
  const national = digits.startsWith('8') ? `7${digits.slice(1)}` : digits
  return /^79\d{9}$/.test(national) ? `+${national}` : null
}

export function formatRussianPhone(value: string): string {
  const digits = value.replace(/\D/g, '')
  const national = digits.startsWith('8') ? `7${digits.slice(1)}` : digits
  if (!/^7\d{10}$/.test(national)) return value
  const number = national.slice(1)
  return `+7 (${number.slice(0, 3)}) ${number.slice(3, 6)}-${number.slice(6, 8)}-${number.slice(8)}`
}

export function formatRussianPhoneInput(value: string, previous: string): string {
  let digits = value.replace(/\D/g, '')
  const previousDigits = previous.replace(/\D/g, '')
  if (digits && digits.length === previousDigits.length && value.length < previous.length)
    digits = digits.slice(0, -1)
  if (digits.startsWith('8')) digits = `7${digits.slice(1)}`
  if (digits && !digits.startsWith('7')) digits = `7${digits}`
  digits = digits.slice(0, 11)
  if (!digits) return '+7'
  const rest = digits.slice(1)
  let result = '+7'
  if (rest) result += ` (${rest.slice(0, 3)}`
  if (rest.length >= 3) result += ')'
  if (rest.length > 3) result += ` ${rest.slice(3, 6)}`
  if (rest.length > 6) result += `-${rest.slice(6, 8)}`
  if (rest.length > 8) result += `-${rest.slice(8, 10)}`
  return result
}

/** Полный российский мобильный номер после нормализации, например «+79991234567». */
export const phoneSchema = z
  .string()
  .transform(normalizeRussianMobilePhone)
  .refine((phone): phone is string => phone !== null, INVALID_PHONE_MESSAGE)

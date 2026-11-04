import { z } from 'zod'

export const INVALID_PHONE_MESSAGE = 'Введите российский мобильный номер'

export function normalizeRussianMobilePhone(value: string): string | null {
  // Плюс допустим только в начале: «7+999…» не считается корректной записью номера.
  if (!/^\+?[\d\s()-]+$/.test(value)) return null
  const digits = value.replace(/\D/g, '')
  const national = digits.startsWith('8') ? `7${digits.slice(1)}` : digits
  return /^79\d{9}$/.test(national) ? `+${national}` : null
}

/** Полный российский мобильный номер после нормализации, например «+79991234567». */
export const phoneSchema = z
  .string()
  .transform(normalizeRussianMobilePhone)
  .refine((phone): phone is string => phone !== null, INVALID_PHONE_MESSAGE)

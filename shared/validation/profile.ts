import { z } from 'zod'

export const nameSchema = z
  .string()
  .trim()
  .min(1, 'Введите имя')
  .max(50, 'Имя слишком длинное')
  .regex(/^[\p{L} -]+$/u, 'Имя может содержать только буквы, пробелы и дефис')

export const emailSchema = z
  .string()
  .trim()
  .pipe(z.union([z.literal(''), z.email('Проверьте адрес электронной почты')]))

/** Имя и необязательная почта личного кабинета. */
export const profileSchema = z.object({ name: nameSchema, email: emailSchema })

/** Дата рождения: либо все селекты пустые, либо указана полная существующая дата. */
export const birthDateSchema = z
  .object({ day: z.string(), month: z.string(), year: z.string() })
  .superRefine((birthDate, context) => {
    const { day, month, year } = birthDate
    if (!day && !month && !year) return
    if (!day || !month || !year) {
      context.addIssue({
        code: 'custom',
        path: ['day'],
        message: 'Укажите дату рождения полностью',
      })
      return
    }
    const date = new Date(Number(year), Number(month) - 1, Number(day))
    const isRealDate =
      date.getFullYear() === Number(year) &&
      date.getMonth() === Number(month) - 1 &&
      date.getDate() === Number(day)
    if (!isRealDate) {
      context.addIssue({ code: 'custom', path: ['day'], message: 'Проверьте дату рождения' })
    }
  })

export type ProfileValues = z.infer<typeof profileSchema>
export type BirthDateValues = z.infer<typeof birthDateSchema>

/** Сериализованная дата рождения «YYYY-MM-DD» или пустая строка. */
export const birthdayStringSchema = z.string().regex(/^(|\d{4}-\d{2}-\d{2})$/)

/** Проверяет, что строка «YYYY-MM-DD» обозначает реально существующую дату. */
export function isRealBirthday(value: string): boolean {
  if (!value) return true
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

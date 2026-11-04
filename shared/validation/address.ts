import { z } from 'zod'

const digitsOnly = (message: string) =>
  z
    .string()
    .trim()
    .regex(/^\d{0,3}$/, message)

/** Детали адреса доставки. Подъезд, этаж и квартира обязательны, пока не отмечен частный дом. */
export const addressDetailsSchema = z
  .object({
    street: z
      .string()
      .trim()
      .min(6, 'Укажите улицу и номер дома')
      .max(120, 'Адрес слишком длинный'),
    entrance: digitsOnly('Подъезд — только цифры, до 3 знаков'),
    floor: digitsOnly('Этаж — только цифры, до 3 знаков'),
    flat: z.string().trim().max(10, 'Номер квартиры — не более 10 символов'),
    comment: z.string().trim().max(300, 'Комментарий слишком длинный — не более 300 символов'),
    isHouse: z.boolean(),
  })
  .superRefine((details, context) => {
    if (details.isHouse) return
    if (!details.entrance) {
      context.addIssue({ code: 'custom', path: ['entrance'], message: 'Укажите подъезд' })
    }
    if (!details.floor) {
      context.addIssue({ code: 'custom', path: ['floor'], message: 'Укажите этаж' })
    }
    if (!details.flat) {
      context.addIssue({ code: 'custom', path: ['flat'], message: 'Укажите квартиру' })
    }
  })

export type AddressDetails = z.infer<typeof addressDetailsSchema>

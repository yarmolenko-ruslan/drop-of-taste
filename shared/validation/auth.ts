import { z } from 'zod'

/** Шестизначный одноразовый код подтверждения. */
export const otpCodeSchema = z.string().regex(/^\d{6}$/)
export const OTP_CODE_TTL_SECONDS = 5 * 60
export const CONSENT_VERSION = '2026-11-06'

/** Общая форма телефона в теле запроса: строка разумной длины, нормализацию делает сервис. */
export const requestCodeBodySchema = z.object({ phone: z.string().min(10).max(32) }).strict()

export const verifyCodeBodySchema = z
  .object({ phone: z.string().min(10).max(32), code: otpCodeSchema, consent: z.literal(true) })
  .strict()

export type RequestCodeBody = z.infer<typeof requestCodeBodySchema>
export type VerifyCodeBody = z.infer<typeof verifyCodeBodySchema>

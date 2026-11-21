import { z } from 'zod'

export const CALL_CHECK_TTL_SECONDS = 5 * 60
export const CALL_STATUS_POLL_SECONDS = 3
export const CONSENT_VERSION = '2026-11-06'
export const attemptTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
export const startCallBodySchema = z
  .object({
    phone: z.string().min(10).max(32),
    consent: z.literal(true),
  })
  .strict()
export const checkCallBodySchema = z
  .object({
    attemptToken: attemptTokenSchema,
    consent: z.literal(true),
  })
  .strict()

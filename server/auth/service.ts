import { createHash, createHmac, randomBytes, randomInt, randomUUID } from 'node:crypto'
import { normalizeRussianMobilePhone } from '../../shared/validation/phone.ts'
import type { AuthStore, CodeSender } from './types.ts'

const CODE_TTL_MS = 5 * 60_000
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60

export type AuthServiceOptions = {
  store: AuthStore
  sender: CodeSender
  secret: string
  now?: () => number
  // This exists only for the local stub sender and must never be used in production.
  developmentCode?: string
}

function tokenDigest(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function createAuthService({
  store,
  sender,
  secret,
  now = Date.now,
  developmentCode,
}: AuthServiceOptions) {
  function codeDigest(phone: string, code: string): string {
    return createHmac('sha256', secret).update(`${phone}:${code}`).digest('hex')
  }

  return {
    async requestCode(rawPhone: string, ip: string) {
      const phone = normalizeRussianMobilePhone(rawPhone)
      if (!phone) return { status: 'invalid_phone' } as const
      const code = developmentCode ?? randomInt(0, 1_000_000).toString().padStart(6, '0')
      const digest = codeDigest(phone, code)
      const reservationId = randomUUID()
      const currentTime = now()
      const reservation = await store.reserveCode({
        reservationId,
        phone,
        ip,
        digest,
        now: currentTime,
        expiresAt: currentTime + CODE_TTL_MS,
      })
      if (reservation.status === 'limited') return reservation

      try {
        await sender.send(phone, code)
      } catch {
        await store.cancelCode(phone, reservationId)
        return { status: 'delivery_failed' } as const
      }
      const confirmed = await store.confirmCode(phone, reservationId, now())
      if (!confirmed) return { status: 'delivery_failed' } as const
      return { status: 'accepted', retryAfterSeconds: 60 } as const
    },
    async verifyCode(rawPhone: string, code: string) {
      const phone = normalizeRussianMobilePhone(rawPhone)
      if (!phone) return { status: 'invalid_phone' } as const
      const result = await store.verifyCode(phone, codeDigest(phone, code), now())
      if (result !== 'verified') return { status: result } as const

      const account = await store.getOrCreateAccount(phone)
      const token = randomBytes(32).toString('base64url')
      await store.createSession(tokenDigest(token), account.id, now() + SESSION_TTL_SECONDS * 1000)
      return { status: 'verified', account, token } as const
    },
    async getAccount(token: string | undefined) {
      return token ? store.findSession(tokenDigest(token), now()) : null
    },
    async logout(token: string | undefined) {
      if (token) await store.deleteSession(tokenDigest(token))
    },
  }
}

export type AuthService = ReturnType<typeof createAuthService>

import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { normalizeRussianMobilePhone } from '../../../shared/validation/phone.ts'
import {
  CONSENT_VERSION,
  CALL_CHECK_TTL_SECONDS,
  CALL_STATUS_POLL_SECONDS,
  attemptTokenSchema,
} from '../../../shared/validation/auth.ts'
import {
  CallProviderError,
  SESSION_TTL_SECONDS,
  type AuthStore,
  type CallProvider,
} from './types.ts'
export { SESSION_TTL_SECONDS } from './types.ts'

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

export function createAuthService({
  store,
  provider,
  now = Date.now,
  consentVersion,
}: {
  store: AuthStore
  provider: CallProvider
  now?: () => number
  consentVersion?: () => Promise<string>
}) {
  return {
    async startCall(rawPhone: string, ip: string) {
      const phone = normalizeRussianMobilePhone(rawPhone)
      if (!phone) return { status: 'invalid_phone' } as const
      const reservationId = randomUUID()
      const startedAt = now()
      const expiresAt = startedAt + CALL_CHECK_TTL_SECONDS * 1000
      const reserved = await store.reserveCall({
        reservationId,
        phone,
        ip,
        now: startedAt,
        expiresAt,
      })
      if (reserved.status === 'limited') return reserved
      if (now() >= expiresAt) {
        await store.cancelCall(phone, reservationId, true)
        return { status: 'unavailable' } as const
      }
      let result: Awaited<ReturnType<CallProvider['start']>>
      try {
        result = await provider.start(phone, ip)
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(result.checkId) || !/^\+7\d{10}$/.test(result.callPhone))
          throw new CallProviderError(false)
      } catch (failure) {
        await store.cancelCall(
          phone,
          reservationId,
          failure instanceof CallProviderError && failure.definitelyRejected,
        )
        return { status: 'unavailable' } as const
      }
      const attemptToken = randomBytes(32).toString('base64url')
      const confirmed = await store.confirmCall(phone, reservationId, now(), {
        digest: digest(attemptToken),
        checkId: result.checkId,
        callPhone: result.callPhone,
        expiresAt,
      })
      if (!confirmed) return { status: 'unavailable' } as const
      return {
        status: 'accepted',
        attemptToken,
        callPhone: result.callPhone,
        expiresAt,
        retryAfterSeconds: 60,
      } as const
    },
    async checkCall(attemptToken: string) {
      if (!attemptTokenSchema.safeParse(attemptToken).success) return { status: 'expired' } as const
      const attemptDigest = digest(attemptToken)
      const lease = await store.acquireCall(attemptDigest, now())
      if (lease.status !== 'ready') return lease
      let status: Awaited<ReturnType<CallProvider['status']>>
      try {
        status = await provider.status(lease.checkId)
      } catch {
        return { status: 'unavailable', pollAfterSeconds: CALL_STATUS_POLL_SECONDS } as const
      }
      if (status === 'expired') return { status: 'expired' } as const
      if (status === 'waiting')
        return { status: 'waiting', pollAfterSeconds: CALL_STATUS_POLL_SECONDS } as const
      if (status !== 'verified')
        return { status: 'unavailable', pollAfterSeconds: CALL_STATUS_POLL_SECONDS } as const
      const revision = consentVersion ? await consentVersion() : CONSENT_VERSION
      const token = randomBytes(32).toString('base64url')
      const currentTime = now()
      const result = await store.completeCall({
        phone: lease.phone,
        digest: attemptDigest,
        checkId: lease.checkId,
        now: currentTime,
        consentVersion: revision,
        sessionDigest: digest(token),
        sessionExpiresAt: currentTime + SESSION_TTL_SECONDS * 1000,
      })
      return result.status === 'verified' ? { ...result, token } : result
    },
    async getAccount(token: string | undefined) {
      return token ? store.findSession(digest(token), now()) : null
    },
    async logout(token: string | undefined) {
      if (token) await store.deleteSession(digest(token))
    },
  }
}
export type AuthService = ReturnType<typeof createAuthService>

import { randomUUID, timingSafeEqual } from 'node:crypto'
import { CALL_STATUS_POLL_SECONDS } from '../../../shared/validation/auth.ts'
import type {
  Account,
  AuthStore,
  ReserveCallResult,
  CompleteCallResult,
  CallRecord,
} from './types.ts'
import {
  DAY_MS,
  GLOBAL_DAILY_LIMIT,
  HOUR_MS,
  IP_HOURLY_LIMIT,
  PHONE_DAILY_LIMIT,
  PHONE_HOURLY_LIMIT,
  SEND_COOLDOWN_MS,
} from './limits.ts'

type Challenge = {
  active?: CallRecord
  pending?: {
    reservationId: string
    expiresAt: number
    ip: string
    reservedAt: number
  }
}

function sameDigest(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex')
  const b = Buffer.from(right, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

// In-memory store for isolated tests. The application uses MongoDB for persistent limits.
export function createMemoryAuthStore(): AuthStore {
  const challenges = new Map<string, Challenge>()
  const phoneRequests = new Map<string, number[]>()
  const phoneDayRequests = new Map<string, number[]>()
  const ipRequests = new Map<string, number[]>()
  const allRequests: number[] = []
  const accountsByPhone = new Map<string, Account>()
  const accountsById = new Map<string, Account>()
  const sessions = new Map<string, { accountId: string; expiresAt: number }>()

  function recent(map: Map<string, number[]>, key: string, now: number): number[] {
    const values = (map.get(key) ?? []).filter((time) => time > now - HOUR_MS)
    if (values.length) map.set(key, values)
    else map.delete(key)
    return values
  }

  function prune(now: number) {
    for (const [phone, challenge] of challenges) {
      if (challenge.active && challenge.active.expiresAt <= now) challenge.active = undefined
      if (challenge.pending && challenge.pending.expiresAt <= now) challenge.pending = undefined
      if (!challenge.active && !challenge.pending) challenges.delete(phone)
    }
    for (const [key] of phoneRequests) recent(phoneRequests, key, now)
    for (const [key, times] of phoneDayRequests) {
      const actual = times.filter((time) => time > now - DAY_MS)
      if (actual.length) phoneDayRequests.set(key, actual)
      else phoneDayRequests.delete(key)
    }
    for (const [key] of ipRequests) recent(ipRequests, key, now)
    for (const [digest, session] of sessions) {
      if (session.expiresAt <= now) sessions.delete(digest)
    }
    while (allRequests.length && allRequests[0]! <= now - DAY_MS) allRequests.shift()
  }

  function withoutOne(values: number[], value: number) {
    const index = values.indexOf(value)
    return index === -1 ? values : [...values.slice(0, index), ...values.slice(index + 1)]
  }

  return {
    async reserveCall({ reservationId, phone, ip, now, expiresAt }): Promise<ReserveCallResult> {
      prune(now)
      const existing = challenges.get(phone)
      const phoneTimes = recent(phoneRequests, phone, now)
      const phoneDayTimes = (phoneDayRequests.get(phone) ?? []).filter(
        (time) => time > now - DAY_MS,
      )
      const ipTimes = recent(ipRequests, ip, now)

      const retryMs = Math.max(
        existing?.pending ? existing.pending.expiresAt - now : 0,
        phoneTimes.length ? phoneTimes[phoneTimes.length - 1]! + SEND_COOLDOWN_MS - now : 0,
        phoneTimes.length >= PHONE_HOURLY_LIMIT ? phoneTimes[0]! + HOUR_MS - now : 0,
        phoneDayTimes.length >= PHONE_DAILY_LIMIT ? phoneDayTimes[0]! + DAY_MS - now : 0,
        ipTimes.length >= IP_HOURLY_LIMIT ? ipTimes[0]! + HOUR_MS - now : 0,
        allRequests.length >= GLOBAL_DAILY_LIMIT ? allRequests[0]! + DAY_MS - now : 0,
      )
      if (retryMs > 0) {
        return { status: 'limited', retryAfterSeconds: Math.ceil(retryMs / 1000) }
      }

      challenges.set(phone, {
        active: existing?.active,
        pending: { reservationId, expiresAt, ip, reservedAt: now },
      })
      phoneRequests.set(phone, [...phoneTimes, now])
      phoneDayRequests.set(phone, [...phoneDayTimes, now])
      ipRequests.set(ip, [...ipTimes, now])
      allRequests.push(now)
      return { status: 'reserved' }
    },
    async confirmCall(phone, reservationId, now, call) {
      const challenge = challenges.get(phone)
      const pending = challenge?.pending
      if (!challenge || !pending || pending.reservationId !== reservationId) return false
      challenge.pending = undefined
      if (pending.expiresAt <= now) {
        if (!challenge.active) challenges.delete(phone)
        return false
      }
      challenge.active = call
      return true
    },
    async cancelCall(phone, reservationId, releaseLimits) {
      const challenge = challenges.get(phone)
      if (!challenge || challenge.pending?.reservationId !== reservationId) return
      const pending = challenge.pending
      // Refund only when the provider explicitly rejected the call.
      if (releaseLimits) {
        phoneRequests.set(phone, withoutOne(phoneRequests.get(phone) ?? [], pending.reservedAt))
        phoneDayRequests.set(
          phone,
          withoutOne(phoneDayRequests.get(phone) ?? [], pending.reservedAt),
        )
        ipRequests.set(pending.ip, withoutOne(ipRequests.get(pending.ip) ?? [], pending.reservedAt))
        const globalIndex = allRequests.indexOf(pending.reservedAt)
        if (globalIndex !== -1) allRequests.splice(globalIndex, 1)
      }
      challenge.pending = undefined
      if (!challenge.active) challenges.delete(phone)
    },
    async acquireCall(digest, now) {
      for (const [phone, challenge] of challenges) {
        const active = challenge.active
        if (!active || !sameDigest(active.digest, digest)) continue
        if (active.expiresAt <= now) return { status: 'expired' }
        if ((active.nextCheckAt ?? 0) > now)
          return {
            status: 'waiting',
            pollAfterSeconds: Math.ceil((active.nextCheckAt! - now) / 1000),
          }
        active.nextCheckAt = now + CALL_STATUS_POLL_SECONDS * 1000
        return { status: 'ready', phone, checkId: active.checkId, expiresAt: active.expiresAt }
      }
      return { status: 'expired' }
    },
    async completeCall({
      phone,
      digest,
      checkId,
      now,
      sessionDigest,
      sessionExpiresAt,
    }): Promise<CompleteCallResult> {
      const challenge = challenges.get(phone)
      const active = challenge?.active
      if (
        !active ||
        active.expiresAt <= now ||
        active.checkId !== checkId ||
        !sameDigest(active.digest, digest)
      )
        return { status: 'expired' }
      const account = accountsByPhone.get(phone) ?? { id: randomUUID(), phone, name: '' }
      accountsByPhone.set(phone, account)
      accountsById.set(account.id, account)
      sessions.set(sessionDigest, { accountId: account.id, expiresAt: sessionExpiresAt })
      if (challenge.pending) challenge.active = undefined
      else challenges.delete(phone)
      return { status: 'verified', account }
    },
    async findSession(digest, now) {
      const session = sessions.get(digest)
      if (!session) return null
      if (session.expiresAt <= now) {
        sessions.delete(digest)
        return null
      }
      return accountsById.get(session.accountId) ?? null
    },
    async deleteSession(digest) {
      sessions.delete(digest)
    },
  }
}

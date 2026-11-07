import { randomUUID, timingSafeEqual } from 'node:crypto'
import type { Account, AuthStore, ReserveCodeResult, VerifyCodeResult } from './types.ts'
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
  active?: {
    digest: string
    expiresAt: number
    attempts: number
  }
  pending?: {
    reservationId: string
    digest: string
    expiresAt: number
    ip: string
    reservedAt: number
  }
}

const MAX_CODE_ATTEMPTS = 5

function sameDigest(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex')
  const b = Buffer.from(right, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

// Local-development implementation only. Rate limits and challenges must be
// persisted and updated atomically before any production SMS can be sent.
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
    async reserveCode({
      reservationId,
      phone,
      ip,
      digest,
      now,
      expiresAt,
    }): Promise<ReserveCodeResult> {
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
        pending: { reservationId, digest, expiresAt, ip, reservedAt: now },
      })
      phoneRequests.set(phone, [...phoneTimes, now])
      phoneDayRequests.set(phone, [...phoneDayTimes, now])
      ipRequests.set(ip, [...ipTimes, now])
      allRequests.push(now)
      return { status: 'reserved' }
    },
    async confirmCode(phone, reservationId, now) {
      const challenge = challenges.get(phone)
      const pending = challenge?.pending
      if (!challenge || !pending || pending.reservationId !== reservationId) return false
      challenge.pending = undefined
      if (pending.expiresAt <= now) {
        if (!challenge.active) challenges.delete(phone)
        return false
      }
      challenge.active = { digest: pending.digest, expiresAt: pending.expiresAt, attempts: 0 }
      return true
    },
    async cancelCode(phone, reservationId) {
      const challenge = challenges.get(phone)
      if (!challenge || challenge.pending?.reservationId !== reservationId) return
      const pending = challenge.pending
      // SMS не ушёл — откатываем лимиты резервирования, чтобы сбой доставки
      // не сжигал бюджеты номера, IP и всего сервиса.
      phoneRequests.set(phone, withoutOne(phoneRequests.get(phone) ?? [], pending.reservedAt))
      phoneDayRequests.set(phone, withoutOne(phoneDayRequests.get(phone) ?? [], pending.reservedAt))
      ipRequests.set(pending.ip, withoutOne(ipRequests.get(pending.ip) ?? [], pending.reservedAt))
      const globalIndex = allRequests.indexOf(pending.reservedAt)
      if (globalIndex !== -1) allRequests.splice(globalIndex, 1)
      challenge.pending = undefined
      if (!challenge.active) challenges.delete(phone)
    },
    async verifyCode(phone, digest, now): Promise<VerifyCodeResult> {
      const challenge = challenges.get(phone)
      const active = challenge?.active
      if (!active) return 'invalid'
      if (active.expiresAt <= now) {
        challenge.active = undefined
        if (!challenge.pending) challenges.delete(phone)
        return 'expired'
      }
      if (active.attempts >= MAX_CODE_ATTEMPTS) return 'limited'
      if (!sameDigest(active.digest, digest)) {
        active.attempts += 1
        return active.attempts >= MAX_CODE_ATTEMPTS ? 'limited' : 'invalid'
      }
      if (challenge.pending) challenge.active = undefined
      else challenges.delete(phone)
      return 'verified'
    },
    async getOrCreateAccount(phone) {
      const existing = accountsByPhone.get(phone)
      if (existing) return existing
      const account = { id: randomUUID(), phone, name: '' }
      accountsByPhone.set(phone, account)
      accountsById.set(account.id, account)
      return account
    },
    async createSession(digest, accountId, expiresAt) {
      sessions.set(digest, { accountId, expiresAt })
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

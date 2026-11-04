import { randomUUID, timingSafeEqual } from 'node:crypto'
import type { ClientSession, Db, MongoClient } from 'mongodb'
import type { Account, AuthStore, ReserveCodeResult, VerifyCodeResult } from './types.ts'

type CodeRecord = { digest: string; expiresAt: number; attempts: number }
type PendingRecord = { reservationId: string; digest: string; expiresAt: number }
type ChallengeDoc = {
  _id: string
  active?: CodeRecord
  pending?: PendingRecord
  cleanupAt: Date
}
type LimitDoc = { _id: string; times: number[]; cleanupAt: Date }
type UserDoc = Account & { _id: string }
type SessionDoc = { _id: string; accountId: string; expiresAt: Date }

const HOUR = 60 * 60_000
const DAY = 24 * HOUR

function currentTimes(doc: LimitDoc | null, now: number, window: number) {
  return (doc?.times ?? []).filter((time) => time > now - window)
}

function equalDigest(left: string, right: string) {
  const a = Buffer.from(left, 'hex')
  const b = Buffer.from(right, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function ensureAuthIndexes(db: Db) {
  await db.collection<UserDoc>('users').createIndex({ phone: 1 }, { unique: true })
  await db
    .collection<ChallengeDoc>('auth_challenges')
    .createIndex({ cleanupAt: 1 }, { expireAfterSeconds: 0 })
  await db
    .collection<LimitDoc>('auth_limits')
    .createIndex({ cleanupAt: 1 }, { expireAfterSeconds: 0 })
  await db
    .collection<SessionDoc>('sessions')
    .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
}

export function createMongoAuthStore(client: MongoClient, db: Db): AuthStore {
  const challenges = db.collection<ChallengeDoc>('auth_challenges')
  const limits = db.collection<LimitDoc>('auth_limits')
  const users = db.collection<UserDoc>('users')
  const sessions = db.collection<SessionDoc>('sessions')

  async function transaction<T>(action: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = client.startSession()
    try {
      const result = await session.withTransaction(() => action(session))
      if (result === undefined) throw new Error('Transaction did not return a result')
      return result
    } finally {
      await session.endSession()
    }
  }

  async function saveChallenge(
    session: ClientSession,
    phone: string,
    active?: CodeRecord,
    pending?: PendingRecord,
  ) {
    if (!active && !pending) {
      await challenges.deleteOne({ _id: phone }, { session })
      return
    }
    const cleanupAt = new Date(Math.max(active?.expiresAt ?? 0, pending?.expiresAt ?? 0))
    await challenges.replaceOne(
      { _id: phone },
      { ...(active && { active }), ...(pending && { pending }), cleanupAt },
      { upsert: true, session },
    )
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
      return transaction(async (session) => {
        const phoneKey = `phone:${phone}`
        const ipKey = `ip:${ip}`
        const phoneDoc = await limits.findOne({ _id: phoneKey }, { session })
        const ipDoc = await limits.findOne({ _id: ipKey }, { session })
        const dailyDoc = await limits.findOne({ _id: 'daily' }, { session })
        const challenge = await challenges.findOne({ _id: phone }, { session })
        const phoneTimes = currentTimes(phoneDoc, now, HOUR)
        const ipTimes = currentTimes(ipDoc, now, HOUR)
        const dailyTimes = currentTimes(dailyDoc, now, DAY)
        const pending =
          challenge?.pending?.expiresAt && challenge.pending.expiresAt > now
            ? challenge.pending
            : undefined
        const active =
          challenge?.active?.expiresAt && challenge.active.expiresAt > now
            ? challenge.active
            : undefined
        const retryMs = Math.max(
          pending ? pending.expiresAt - now : 0,
          phoneTimes.length ? phoneTimes[phoneTimes.length - 1]! + 60_000 - now : 0,
          phoneTimes.length >= 5 ? phoneTimes[0]! + HOUR - now : 0,
          ipTimes.length >= 20 ? ipTimes[0]! + HOUR - now : 0,
          dailyTimes.length >= 100 ? dailyTimes[0]! + DAY - now : 0,
        )
        if (retryMs > 0) {
          return { status: 'limited', retryAfterSeconds: Math.ceil(retryMs / 1000) }
        }

        await saveChallenge(session, phone, active, { reservationId, digest, expiresAt })
        await limits.replaceOne(
          { _id: phoneKey },
          { times: [...phoneTimes, now], cleanupAt: new Date(now + HOUR) },
          { upsert: true, session },
        )
        await limits.replaceOne(
          { _id: ipKey },
          { times: [...ipTimes, now], cleanupAt: new Date(now + HOUR) },
          { upsert: true, session },
        )
        await limits.replaceOne(
          { _id: 'daily' },
          { times: [...dailyTimes, now], cleanupAt: new Date(now + DAY) },
          { upsert: true, session },
        )
        return { status: 'reserved' }
      })
    },
    async confirmCode(phone, reservationId, now) {
      return transaction(async (session) => {
        const doc = await challenges.findOne({ _id: phone }, { session })
        if (doc?.pending?.reservationId !== reservationId) return false
        const active = doc.active?.expiresAt && doc.active.expiresAt > now ? doc.active : undefined
        if (doc.pending.expiresAt <= now) {
          await saveChallenge(session, phone, active)
          return false
        }
        await saveChallenge(session, phone, {
          digest: doc.pending.digest,
          expiresAt: doc.pending.expiresAt,
          attempts: 0,
        })
        return true
      })
    },
    async cancelCode(phone, reservationId) {
      await transaction(async (session) => {
        const doc = await challenges.findOne({ _id: phone }, { session })
        if (doc?.pending?.reservationId !== reservationId) return true
        await saveChallenge(session, phone, doc.active)
        return true
      })
    },
    async verifyCode(phone, digest, now): Promise<VerifyCodeResult> {
      return transaction(async (session) => {
        const doc = await challenges.findOne({ _id: phone }, { session })
        const active = doc?.active
        if (!active) return 'invalid'
        if (active.expiresAt <= now) {
          await saveChallenge(session, phone, undefined, doc.pending)
          return 'expired'
        }
        if (active.attempts >= 5) return 'limited'
        if (!equalDigest(active.digest, digest)) {
          const attempts = active.attempts + 1
          await saveChallenge(session, phone, { ...active, attempts }, doc.pending)
          return attempts >= 5 ? 'limited' : 'invalid'
        }
        await saveChallenge(session, phone, undefined, doc.pending)
        return 'verified'
      })
    },
    async getOrCreateAccount(phone) {
      const id = randomUUID()
      let account: UserDoc | null
      try {
        account = await users.findOneAndUpdate(
          { phone },
          { $setOnInsert: { _id: id, id, phone, name: '' } },
          { upsert: true, returnDocument: 'after' },
        )
      } catch (failure) {
        if ((failure as { code?: number }).code !== 11000) throw failure
        account = await users.findOne({ phone })
      }
      if (!account) throw new Error('Could not create account')
      return { id: account.id, phone: account.phone, name: account.name }
    },
    async createSession(digest, accountId, expiresAt) {
      await sessions.insertOne({ _id: digest, accountId, expiresAt: new Date(expiresAt) })
    },
    async findSession(digest, now) {
      const session = await sessions.findOne({ _id: digest, expiresAt: { $gt: new Date(now) } })
      if (!session) return null
      const account = await users.findOne({ id: session.accountId })
      return account ? { id: account.id, phone: account.phone, name: account.name } : null
    },
    async deleteSession(digest) {
      await sessions.deleteOne({ _id: digest })
    },
  }
}

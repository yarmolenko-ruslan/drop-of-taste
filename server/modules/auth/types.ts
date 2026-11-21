export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60

export type Account = { id: string; phone: string; name: string }
export type ReserveCallResult =
  { status: 'reserved' } | { status: 'limited'; retryAfterSeconds: number }
export type CallRecord = {
  digest: string
  checkId: string
  callPhone: string
  expiresAt: number
  nextCheckAt?: number
}
export type AcquireCallResult =
  | { status: 'ready'; phone: string; checkId: string; expiresAt: number }
  | { status: 'waiting'; pollAfterSeconds: number }
  | { status: 'expired' }
export type CompleteCallResult = { status: 'verified'; account: Account } | { status: 'expired' }

export type AuthStore = {
  reserveCall(input: {
    reservationId: string
    phone: string
    ip: string
    now: number
    expiresAt: number
  }): Promise<ReserveCallResult>
  confirmCall(
    phone: string,
    reservationId: string,
    now: number,
    call: Omit<CallRecord, 'nextCheckAt'>,
  ): Promise<boolean>
  cancelCall(phone: string, reservationId: string, releaseLimits: boolean): Promise<void>
  acquireCall(digest: string, now: number): Promise<AcquireCallResult>
  completeCall(input: {
    phone: string
    digest: string
    checkId: string
    now: number
    consentVersion: string
    sessionDigest: string
    sessionExpiresAt: number
  }): Promise<CompleteCallResult>
  findSession(digest: string, now: number): Promise<Account | null>
  deleteSession(digest: string): Promise<void>
}
export type CallProvider = {
  start(phone: string, ip: string): Promise<{ checkId: string; callPhone: string }>
  status(checkId: string): Promise<'waiting' | 'verified' | 'expired'>
}
export class CallProviderError extends Error {
  readonly definitelyRejected: boolean
  constructor(definitelyRejected: boolean) {
    super('Не удалось связаться с сервисом подтверждения телефона')
    this.name = 'CallProviderError'
    this.definitelyRejected = definitelyRejected
  }
}

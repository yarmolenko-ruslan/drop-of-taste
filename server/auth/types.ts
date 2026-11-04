export type Account = {
  id: string
  phone: string
  name: string
}

export type ReserveCodeResult =
  { status: 'reserved' } | { status: 'limited'; retryAfterSeconds: number }

export type VerifyCodeResult = 'verified' | 'invalid' | 'expired' | 'limited'

// MongoDB will implement these operations atomically in the next stage.
export type AuthStore = {
  reserveCode(input: {
    reservationId: string
    phone: string
    ip: string
    digest: string
    now: number
    expiresAt: number
  }): Promise<ReserveCodeResult>
  confirmCode(phone: string, reservationId: string, now: number): Promise<boolean>
  cancelCode(phone: string, reservationId: string): Promise<void>
  verifyCode(phone: string, digest: string, now: number): Promise<VerifyCodeResult>
  getOrCreateAccount(phone: string): Promise<Account>
  createSession(digest: string, accountId: string, expiresAt: number): Promise<void>
  findSession(digest: string, now: number): Promise<Account | null>
  deleteSession(digest: string): Promise<void>
}

export type CodeSender = {
  send(phone: string, code: string): Promise<void>
}

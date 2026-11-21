import { isIP } from 'node:net'
import { randomUUID } from 'node:crypto'
import { normalizeRussianMobilePhone } from '../../../shared/validation/phone.ts'
import { CallProviderError, type CallProvider } from './types.ts'

export type SmsRuDiagnostic = {
  requestId: string
  createdAt: Date
  phoneMasked?: string
  operation: 'start' | 'status'
  outcome:
    | 'accepted'
    | 'waiting'
    | 'verified'
    | 'expired'
    | 'provider_error'
    | 'http_error'
    | 'invalid_response'
    | 'network_error'
  durationMs: number
  httpStatus?: number
  providerStatusCode?: number
  invalidResponseReason?:
    | 'json_invalid'
    | 'check_id_invalid'
    | 'call_phone_missing'
    | 'call_phone_invalid'
    | 'call_phone_conflict'
    | 'check_status_invalid'
  callPhoneType?: 'string' | 'number' | 'missing' | 'other'
  checkId?: string
  costRubles?: number
}
const CHECK_ID = /^[A-Za-z0-9_-]{1,128}$/
const REJECTED = new Set([
  200, 201, 202, 206, 207, 209, 214, 215, 230, 231, 232, 233, 301, 302, 304, 305, 507, 508, 509,
  550,
])

function normalizeCallPhone(value: unknown): string | null {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) return null
    value = String(value)
  }
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (raw.length > 64 || !/^\+?[\d ()-]+$/.test(raw)) return null
  if (raw.startsWith('+') && !raw.startsWith('+7')) return null
  const digits = raw.replace(/[ ()-]/g, '')
  const national = digits.startsWith('8') ? '7' + digits.slice(1) : digits.replace(/^\+/, '')
  return /^7\d{10}$/.test(national) ? '+' + national : null
}

/** https://sms.ru/api/call — the user calls the returned phone number. */
export function createSmsRuCallProvider(
  apiId: string,
  {
    allowLocalIp = false,
    onDiagnostic,
  }: {
    allowLocalIp?: boolean
    onDiagnostic?: (event: SmsRuDiagnostic) => void | Promise<unknown>
  } = {},
): CallProvider {
  const key = apiId.trim()
  if (!key) throw new Error('Укажите SMS_RU_API_ID в серверном .env')

  async function request(operation: 'start' | 'status', parameters: Record<string, string>) {
    const startedAt = Date.now()
    let httpStatus: number | undefined
    let data: Record<string, unknown> = {}
    let outcome: SmsRuDiagnostic['outcome'] = 'network_error'
    let invalidResponseReason: SmsRuDiagnostic['invalidResponseReason']
    let callPhoneType: SmsRuDiagnostic['callPhoneType']
    try {
      const response = await fetch(
        operation === 'start' ? 'https://sms.ru/callcheck/add' : 'https://sms.ru/callcheck/status',
        {
          method: 'POST',
          body: new URLSearchParams({ api_id: key, json: '1', ...parameters }),
          redirect: 'error',
          signal: AbortSignal.timeout(10_000),
        },
      )
      httpStatus = response.status
      if (!response.ok) {
        outcome = 'http_error'
        throw new CallProviderError(false)
      }
      outcome = 'invalid_response'
      invalidResponseReason = 'json_invalid'
      const result: unknown = await response.json()
      if (!result || typeof result !== 'object' || Array.isArray(result))
        throw new CallProviderError(false)
      data = result as Record<string, unknown>
      invalidResponseReason = undefined
      if (data.status !== 'OK' || data.status_code !== 100) {
        outcome = 'provider_error'
        throw new CallProviderError(
          typeof data.status_code === 'number' &&
            REJECTED.has(data.status_code) &&
            data.check_id === undefined,
        )
      }
      if (operation === 'start') {
        if (typeof data.check_id !== 'string' || !CHECK_ID.test(data.check_id)) {
          invalidResponseReason = 'check_id_invalid'
          throw new CallProviderError(false)
        }
        // The docs use call_phone in JSON and call_number in the PHP example.
        // Normalize plaintext numbers only; never use call_phone_html as a dial target.
        const fields = ['call_phone', 'call_number'].filter((field) => Object.hasOwn(data, field))
        const rawPhone = data[fields[0] ?? 'call_phone']
        callPhoneType = !fields.length
          ? 'missing'
          : typeof rawPhone === 'string'
            ? 'string'
            : typeof rawPhone === 'number'
              ? 'number'
              : 'other'
        if (!fields.length) {
          invalidResponseReason = 'call_phone_missing'
          throw new CallProviderError(false)
        }
        const phones = fields.map((field) => normalizeCallPhone(data[field]))
        if (phones.some((phone) => phone === null)) {
          invalidResponseReason = 'call_phone_invalid'
          throw new CallProviderError(false)
        }
        if (new Set(phones).size !== 1) {
          invalidResponseReason = 'call_phone_conflict'
          throw new CallProviderError(false)
        }
        data.call_phone = phones[0]
        outcome = 'accepted'
      } else {
        const statuses = { '400': 'waiting', '401': 'verified', '402': 'expired' } as const
        const value =
          typeof data.check_status === 'number' ? String(data.check_status) : data.check_status
        if (value !== '400' && value !== '401' && value !== '402') {
          invalidResponseReason = 'check_status_invalid'
          throw new CallProviderError(false)
        }
        outcome = statuses[value]
      }
      return { data, outcome }
    } catch (failure) {
      if (failure instanceof CallProviderError) throw failure
      throw new CallProviderError(false)
    } finally {
      if (onDiagnostic) {
        try {
          const checkId = typeof data.check_id === 'string' ? data.check_id : parameters.check_id
          const event: SmsRuDiagnostic = {
            requestId: randomUUID(),
            createdAt: new Date(startedAt),
            operation,
            outcome,
            durationMs: Math.max(0, Date.now() - startedAt),
            httpStatus,
            ...(invalidResponseReason ? { invalidResponseReason } : {}),
            ...(callPhoneType ? { callPhoneType } : {}),
            ...(parameters.phone ? { phoneMasked: '+7***' + parameters.phone.slice(-4) } : {}),
            ...(typeof data.status_code === 'number' && Number.isInteger(data.status_code)
              ? { providerStatusCode: data.status_code }
              : {}),
            ...(checkId && CHECK_ID.test(checkId) && !checkId.includes(key) ? { checkId } : {}),
            ...(typeof data.cost === 'number' && Number.isFinite(data.cost) && data.cost >= 0
              ? { costRubles: data.cost }
              : {}),
          }
          void Promise.resolve(onDiagnostic(event)).catch(() => undefined)
        } catch {
          /* Diagnostics never changes authentication or retries a request. */
        }
      }
    }
  }

  return {
    async start(rawPhone, ip) {
      const phone = normalizeRussianMobilePhone(rawPhone)
      if (!phone || !isIP(ip)) throw new CallProviderError(true)
      const local = ip === '::1' || ip.startsWith('127.') || ip.startsWith('::ffff:127.')
      if (local && !allowLocalIp) throw new CallProviderError(true)
      const { data } = await request('start', { phone: phone.slice(1), ...(!local ? { ip } : {}) })
      return { checkId: data.check_id as string, callPhone: data.call_phone as string }
    },
    async status(checkId) {
      if (!CHECK_ID.test(checkId)) throw new CallProviderError(true)
      const { outcome } = await request('status', { check_id: checkId })
      if (outcome !== 'waiting' && outcome !== 'verified' && outcome !== 'expired')
        throw new CallProviderError(false)
      return outcome
    },
  }
}

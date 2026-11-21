export type AuthUser = { id: string; phone: string; name: string }

export class ApiError extends Error {
  code: string
  retryAfterSeconds: number
  status: number
  constructor(code: string, message: string, retryAfterSeconds = 0, status = 0) {
    super(message)
    this.code = code
    this.retryAfterSeconds = retryAfterSeconds
    this.status = status
  }
}

let adminIdentity: string | null = null
let adminSessionId: string | null = null
let adminRequestEpoch = 0
/** Bind working requests and their responses to the administrative screen that initiated them. */
export function setAdminRequestIdentity(id: string | null, sessionId: string | null = null) {
  adminIdentity = id
  adminSessionId = id ? sessionId : null
  adminRequestEpoch++
}

const REQUEST_TIMEOUT_MS = 15_000

export async function apiRequest<T>(
  path: string,
  init?: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<T> {
  let response: Response
  const administrative = path.startsWith('/admin/')
  const epoch = adminRequestEpoch
  const ensureCurrent = () => {
    if (administrative && epoch !== adminRequestEpoch)
      throw new ApiError(
        'ADMIN_REQUEST_SUPERSEDED',
        'Учётная запись изменилась. Повторите действие после входа',
      )
  }
  // Внешний сигнал (отмена диалогом) объединяем с таймаутом: иначе зависший
  // сервер оставлял бы кнопку в busy-состоянии бессрочно.
  const externalSignal = init?.signal ?? null
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  const signal = externalSignal ? AbortSignal.any([externalSignal, timeoutSignal]) : timeoutSignal
  try {
    const headers = new Headers(init?.headers)
    if (
      administrative &&
      adminIdentity &&
      !['/admin/login', '/admin/session', '/admin/logout'].includes(path.split('?')[0]!)
    ) {
      headers.set('X-Admin-Account-Id', adminIdentity)
      if (adminSessionId) headers.set('X-Admin-Session-Id', adminSessionId)
    }
    if (init?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
    response = await fetch(`/api${path}`, {
      credentials: 'same-origin',
      ...init,
      signal,
      headers,
    })
    ensureCurrent()
    if (!response.ok) {
      const body = await response.json().catch(() => null)
      ensureCurrent()
      if (body?.error?.code === 'ACCOUNT_CHANGED')
        window.dispatchEvent(new Event('drop-of-taste:account-changed'))
      if (
        ['ADMIN_UNAUTHORIZED', 'ADMIN_ACCOUNT_CHANGED', 'ADMIN_SESSION_CHANGED'].includes(
          body?.error?.code,
        )
      )
        window.dispatchEvent(new Event('drop-of-taste:admin-session-expired'))
      throw new ApiError(
        body?.error?.code ?? 'REQUEST_FAILED',
        body?.error?.message ?? 'Не удалось выполнить запрос',
        Number(response.headers.get('Retry-After') ?? 0),
        response.status,
      )
    }
    const result = response.status === 204 ? (undefined as T) : await response.json()
    ensureCurrent()
    return result
  } catch (failure) {
    if (externalSignal?.aborted) throw failure
    ensureCurrent()
    if (failure instanceof ApiError) throw failure
    if (
      timeoutSignal.aborted ||
      (failure instanceof DOMException && failure.name === 'TimeoutError')
    )
      throw new ApiError('TIMEOUT', 'Сервер не ответил вовремя. Попробуйте ещё раз')
    // Заголовки ещё не означают получение ответа: обрыв тела после сохранения
    // заказа тоже оставляет результат операции неизвестным.
    throw new ApiError('NETWORK_ERROR', 'Нет связи с сервером. Попробуйте ещё раз.')
  }
}

export type CallAttempt = {
  status: 'accepted'
  attemptToken: string
  callPhone: string
  expiresAt: number
  retryAfterSeconds: number
}
export type CallStatus =
  | { status: 'verified'; user: AuthUser }
  | { status: 'waiting' | 'unavailable'; pollAfterSeconds: number }
  | { status: 'expired' }
export const authApi = {
  startCall: (phone: string, consent: boolean, signal?: AbortSignal) =>
    apiRequest<CallAttempt>('/auth/call/start', {
      method: 'POST',
      body: JSON.stringify({ phone, consent }),
      signal,
    }),
  checkCall: (attemptToken: string, consent: boolean, signal?: AbortSignal) =>
    apiRequest<CallStatus>('/auth/call/status', {
      method: 'POST',
      body: JSON.stringify({ attemptToken, consent }),
      signal,
    }),
  me: () => apiRequest<{ user: AuthUser }>('/auth/me'),
  logout: () => apiRequest<void>('/auth/logout', { method: 'POST' }),
}

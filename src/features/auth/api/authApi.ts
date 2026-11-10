export type AuthUser = { id: string; phone: string; name: string }

export class ApiError extends Error {
  code: string
  retryAfterSeconds: number
  constructor(code: string, message: string, retryAfterSeconds = 0) {
    super(message)
    this.code = code
    this.retryAfterSeconds = retryAfterSeconds
  }
}

const REQUEST_TIMEOUT_MS = 15_000

export async function apiRequest<T>(
  path: string,
  init?: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<T> {
  let response: Response
  // Внешний сигнал (отмена диалогом) объединяем с таймаутом: иначе зависший
  // сервер оставлял бы кнопку в busy-состоянии бессрочно.
  const externalSignal = init?.signal ?? null
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  const signal = externalSignal ? AbortSignal.any([externalSignal, timeoutSignal]) : timeoutSignal
  try {
    const headers = new Headers(init?.headers)
    if (init?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
    response = await fetch(`/api${path}`, {
      credentials: 'same-origin',
      ...init,
      signal,
      headers,
    })
  } catch (failure) {
    if (externalSignal?.aborted) throw failure
    if (failure instanceof DOMException && failure.name === 'TimeoutError')
      throw new ApiError('TIMEOUT', 'Сервер не ответил вовремя. Попробуйте ещё раз')
    throw new ApiError('NETWORK_ERROR', 'Нет связи с локальным сервером')
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    if (body?.error?.code === 'ACCOUNT_CHANGED')
      window.dispatchEvent(new Event('drop-of-taste:account-changed'))
    throw new ApiError(
      body?.error?.code ?? 'REQUEST_FAILED',
      body?.error?.message ?? 'Не удалось выполнить запрос',
      Number(response.headers.get('Retry-After') ?? 0),
    )
  }
  return response.status === 204 ? (undefined as T) : response.json()
}

export const authApi = {
  requestCode: (phone: string, signal?: AbortSignal) =>
    apiRequest<{ status: string; retryAfterSeconds: number; developmentCode?: string }>(
      '/auth/request-code',
      {
        method: 'POST',
        body: JSON.stringify({ phone }),
        signal,
      },
    ),
  verifyCode: (phone: string, code: string, consent: boolean, signal?: AbortSignal) =>
    apiRequest<{ user: AuthUser }>('/auth/verify-code', {
      method: 'POST',
      body: JSON.stringify({ phone, code, consent }),
      signal,
    }),
  me: () => apiRequest<{ user: AuthUser }>('/auth/me'),
  logout: () => apiRequest<void>('/auth/logout', { method: 'POST' }),
}

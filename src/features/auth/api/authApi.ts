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

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      credentials: 'same-origin',
      ...init,
      headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
    })
  } catch {
    throw new ApiError('NETWORK_ERROR', 'Нет связи с локальным сервером')
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new ApiError(
      body?.error?.code ?? 'REQUEST_FAILED',
      body?.error?.message ?? 'Не удалось выполнить запрос',
      Number(response.headers.get('Retry-After') ?? 0),
    )
  }
  return response.status === 204 ? (undefined as T) : response.json()
}

export const authApi = {
  requestCode: (phone: string) =>
    apiRequest<{ status: string; retryAfterSeconds: number }>('/auth/request-code', {
      method: 'POST',
      body: JSON.stringify({ phone }),
    }),
  verifyCode: (phone: string, code: string) =>
    apiRequest<{ user: AuthUser }>('/auth/verify-code', {
      method: 'POST',
      body: JSON.stringify({ phone, code }),
    }),
  me: () => apiRequest<{ user: AuthUser }>('/auth/me'),
  logout: () => apiRequest<void>('/auth/logout', { method: 'POST' }),
}

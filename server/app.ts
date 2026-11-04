import Fastify, { type FastifyError, type FastifyInstance } from 'fastify'
import { requestCodeBodySchema, verifyCodeBodySchema } from '../shared/validation/auth.ts'
import { SESSION_TTL_SECONDS, type AuthService } from './auth/service.ts'

function readCookie(header: string | undefined, name: string): string | undefined {
  return header
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1)
}

function sessionCookie(name: string, token: string, secure: boolean, maxAge: number): string {
  return `${name}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`
}

function error(code: string, message: string) {
  return { error: { code, message } }
}

export function createApp(
  auth: AuthService,
  options: { origins: readonly string[]; secureCookies: boolean },
): FastifyInstance {
  const app = Fastify({
    logger: false,
    bodyLimit: 4_096,
    trustProxy: false,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
  })
  const cookieName = options.secureCookies ? '__Host-session' : 'dev_session'

  app.setErrorHandler((failure, _request, reply) => {
    const knownFailure = failure as FastifyError
    if (knownFailure.validation) {
      return reply.code(400).send(error('INVALID_BODY', 'Проверьте данные запроса'))
    }
    if (knownFailure.statusCode && knownFailure.statusCode < 500) {
      return reply.code(knownFailure.statusCode).send(error('BAD_REQUEST', 'Некорректный запрос'))
    }
    return reply.code(500).send(error('INTERNAL_ERROR', 'Не удалось выполнить запрос'))
  })

  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/auth/')) return
    reply.header('Cache-Control', 'no-store')
    if (request.method !== 'POST') return
    if (!request.headers.origin || !options.origins.includes(request.headers.origin)) {
      return reply.code(403).send(error('INVALID_ORIGIN', 'Запрос отклонён'))
    }
  })

  app.get('/api/health', async () => ({ status: 'ok' }))

  app.post('/api/auth/request-code', async (request, reply) => {
    const parsed = requestCodeBodySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send(error('INVALID_BODY', 'Проверьте данные запроса'))
    }
    const { phone } = parsed.data
    const result = await auth.requestCode(phone, request.ip)
    if (result.status === 'invalid_phone') {
      return reply.code(400).send(error('INVALID_PHONE', 'Введите российский мобильный номер'))
    }
    if (result.status === 'limited') {
      return reply
        .header('Retry-After', String(result.retryAfterSeconds))
        .code(429)
        .send(error('RATE_LIMITED', 'Повторите запрос позже'))
    }
    if (result.status === 'delivery_failed') {
      return reply.code(503).send(error('DELIVERY_UNAVAILABLE', 'Не удалось отправить код'))
    }
    return reply.code(202).send({ status: 'accepted', retryAfterSeconds: result.retryAfterSeconds })
  })

  app.post('/api/auth/verify-code', async (request, reply) => {
    const parsed = verifyCodeBodySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send(error('INVALID_BODY', 'Проверьте данные запроса'))
    }
    const { phone, code } = parsed.data
    const result = await auth.verifyCode(phone, code)
    if (result.status === 'invalid_phone') {
      return reply.code(400).send(error('INVALID_PHONE', 'Введите российский мобильный номер'))
    }
    if (result.status === 'limited') {
      return reply.code(429).send(error('CODE_ATTEMPTS_EXCEEDED', 'Запросите новый код'))
    }
    if (result.status !== 'verified') {
      return reply.code(400).send(error('INVALID_CODE', 'Неверный или просроченный код'))
    }
    reply.header(
      'Set-Cookie',
      sessionCookie(cookieName, result.token, options.secureCookies, SESSION_TTL_SECONDS),
    )
    return { user: result.account }
  })

  app.get('/api/auth/me', async (request, reply) => {
    const user = await auth.getAccount(readCookie(request.headers.cookie, cookieName))
    return user ? { user } : reply.code(401).send(error('UNAUTHENTICATED', 'Необходимо войти'))
  })

  app.post('/api/auth/logout', async (request, reply) => {
    await auth.logout(readCookie(request.headers.cookie, cookieName))
    reply.header('Set-Cookie', sessionCookie(cookieName, '', options.secureCookies, 0))
    return reply.code(204).send()
  })

  return app
}

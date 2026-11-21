// @vitest-environment node
import { createApp } from '../../app.ts'
import { createMemoryAuthStore } from './memory-store.ts'
import { createAuthService } from './service.ts'
import { createTestCallProvider } from '../../tests/fixtures/call-provider.ts'

const origin = 'http://localhost:5173'
const phone = '+79991234567'
function setup(secureCookies = false) {
  let now = Date.now()
  const provider = createTestCallProvider()
  const start = vi.spyOn(provider, 'start')
  const status = vi.spyOn(provider, 'status')
  const auth = createAuthService({ store: createMemoryAuthStore(), provider, now: () => now })
  const app = createApp(auth, { origins: [origin], secureCookies })
  const register = (body: unknown = { phone, consent: true }) =>
    app.inject({
      method: 'POST',
      url: '/api/auth/call/start',
      headers: { origin, 'content-type': 'application/json' },
      payload: JSON.stringify(body),
    })
  const check = (attemptToken: string) =>
    app.inject({
      method: 'POST',
      url: '/api/auth/call/status',
      headers: { origin },
      payload: { attemptToken, consent: true },
    })
  return {
    app,
    provider,
    start,
    status,
    register,
    check,
    advance: (ms: number) => {
      now += ms
    },
  }
}

test.each([false, true])(
  'call confirmation creates the appropriate HttpOnly cookie (secure=%s) and logout revokes it',
  async (secure) => {
    const { app, register, check, start } = setup(secure)
    try {
      const registration = await register()
      expect(registration.statusCode).toBe(202)
      expect(registration.headers['cache-control']).toBe('no-store')
      expect(registration.json()).toMatchObject({
        status: 'accepted',
        callPhone: '+78005008275',
        retryAfterSeconds: 60,
      })
      expect(registration.body).not.toContain('checkId')
      const verified = await check(registration.json().attemptToken)
      expect(verified.json()).toMatchObject({ status: 'verified', user: { phone } })
      const cookie = verified.headers['set-cookie'] as string
      expect(cookie).toContain('HttpOnly')
      expect(cookie).toContain('SameSite=Lax')
      expect(cookie).toContain(secure ? '__Host-session=' : 'dev_session=')
      if (secure) expect(cookie).toContain('; Secure')
      expect((await check(registration.json().attemptToken)).json().status).toBe('expired')
      const me = await app.inject({ url: '/api/auth/me', headers: { cookie } })
      expect(me.statusCode).toBe(200)
      expect(me.headers['cache-control']).toBe('no-store')
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/auth/logout',
            headers: { origin: 'https://attacker.invalid', cookie },
          })
        ).statusCode,
      ).toBe(403)
      expect((await app.inject({ url: '/api/auth/me', headers: { cookie } })).statusCode).toBe(200)
      const logout = await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: { origin, cookie },
      })
      expect(logout.statusCode).toBe(204)
      expect(logout.headers['set-cookie']).toContain('Max-Age=0')
      expect((await app.inject({ url: '/api/auth/me', headers: { cookie } })).statusCode).toBe(401)
      expect(start).toHaveBeenCalledTimes(1)
    } finally {
      await app.close()
    }
  },
)

test.each([
  {},
  { phone },
  { phone, consent: false },
  { phone, consent: 'true' },
  { phone: 79991234567, consent: true },
  { phone, consent: true, extra: true },
  { phone: '123', consent: true },
  { phone: '+7abc9991234567', consent: true },
  { phone: '7+9991234567', consent: true },
  { phone: '+12025550123', consent: true },
])('rejects malformed or non-Russian input without provider access: %j', async (body) => {
  const { app, register, start } = setup()
  try {
    expect((await register(body)).statusCode).toBe(400)
    expect(start).not.toHaveBeenCalled()
  } finally {
    await app.close()
  }
})

test('rejects foreign or missing Origin before invoking either provider method', async () => {
  const { app, start, status } = setup()
  try {
    for (const url of ['/api/auth/call/start', '/api/auth/call/status']) {
      for (const headers of [{}, { origin: 'https://attacker.invalid' }]) {
        expect(
          (await app.inject({ method: 'POST', url, headers, payload: { phone, consent: true } }))
            .statusCode,
        ).toBe(403)
      }
    }
    expect(start).not.toHaveBeenCalled()
    expect(status).not.toHaveBeenCalled()
  } finally {
    await app.close()
  }
})

test('throttles duplicate registrations with Retry-After and releases the window after 24 hours', async () => {
  const { app, register, advance, start } = setup()
  try {
    for (let i = 0; i < 5; i++) {
      expect((await register()).statusCode).toBe(202)
      const duplicate = await register()
      expect(duplicate.statusCode).toBe(429)
      expect(Number(duplicate.headers['retry-after'])).toBeGreaterThan(0)
      advance(60_000)
    }
    advance(60 * 60_000)
    expect((await register()).statusCode).toBe(429)
    expect(start).toHaveBeenCalledTimes(5)
    advance(24 * 60 * 60_000)
    expect((await register()).statusCode).toBe(202)
  } finally {
    await app.close()
  }
})

test('caps a single IP without trusting spoofed forwarding headers', async () => {
  const { app, start } = setup()
  try {
    for (let i = 0; i < 21; i++) {
      const result = await app.inject({
        method: 'POST',
        url: '/api/auth/call/start',
        headers: { origin, 'x-forwarded-for': '203.0.113.' + (i + 1) },
        payload: { phone: '+7999' + String(i).padStart(7, '0'), consent: true },
      })
      expect(result.statusCode).toBe(i < 20 ? 202 : 429)
    }
    expect(start).toHaveBeenCalledTimes(20)
  } finally {
    await app.close()
  }
})

test('expires a session at seven days without extending it on read', async () => {
  const { app, register, check, advance } = setup()
  try {
    const registered = await register()
    const verified = await check(registered.json().attemptToken)
    const cookie = verified.headers['set-cookie'] as string
    advance(4 * 24 * 60 * 60_000)
    const me = await app.inject({ url: '/api/auth/me', headers: { cookie } })
    expect(me.statusCode).toBe(200)
    expect(me.headers['set-cookie']).toBeUndefined()
    advance(3 * 24 * 60 * 60_000)
    expect((await app.inject({ url: '/api/auth/me', headers: { cookie } })).statusCode).toBe(401)
  } finally {
    await app.close()
  }
})

test('a failed registration is reported honestly and cannot create a session', async () => {
  const { app, register, check, start } = setup()
  start.mockRejectedValue(new Error('private diagnostic text'))
  try {
    const response = await register()
    expect(response.statusCode).toBe(503)
    expect(response.json().error.code).toBe('CALL_CHECK_UNAVAILABLE')
    expect(response.body).not.toContain('private diagnostic')
    expect((await check('A'.repeat(43))).json()).toEqual({ status: 'expired' })
    expect((await app.inject({ url: '/api/auth/me' })).statusCode).toBe(401)
  } finally {
    await app.close()
  }
})

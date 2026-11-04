import { createApp } from '../app.ts'
import { createMemoryAuthStore } from './memory-store.ts'
import { createAuthService } from './service.ts'

const origin = 'http://localhost:5173'
const phone = '+7 (999) 123-45-67'

function setup(options: { failingSender?: boolean } = {}) {
  let now = 1_000_000
  const sent: Array<{ phone: string; code: string }> = []
  const auth = createAuthService({
    store: createMemoryAuthStore(),
    sender: {
      async send(number, code) {
        if (options.failingSender) throw new Error('provider unavailable')
        sent.push({ phone: number, code })
      },
    },
    secret: 'test-secret',
    now: () => now,
    developmentCode: '123456',
  })
  return {
    app: createApp(auth, { origins: [origin], secureCookies: false }),
    sent,
    advance(milliseconds: number) {
      now += milliseconds
    },
  }
}

test('issues a code, creates a session and revokes it on logout', async () => {
  const { app, sent } = setup()
  try {
    const request = await app.inject({
      method: 'POST',
      url: '/api/auth/request-code',
      headers: { origin },
      payload: { phone },
    })
    expect(request.statusCode).toBe(202)
    expect(request.json()).toEqual({ status: 'accepted', retryAfterSeconds: 60 })
    expect(sent).toEqual([{ phone: '+79991234567', code: '123456' }])

    const verify = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-code',
      headers: { origin },
      payload: { phone: '+79991234567', code: '123456' },
    })
    expect(verify.statusCode).toBe(200)
    expect(verify.json().user.phone).toBe('+79991234567')
    const cookie = verify.headers['set-cookie'] as string
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')

    const reused = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-code',
      headers: { origin },
      payload: { phone, code: '123456' },
    })
    expect(reused.statusCode).toBe(400)

    const beforeLogout = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie },
    })
    expect(beforeLogout.statusCode).toBe(200)
    expect(beforeLogout.headers['cache-control']).toBe('no-store')

    const foreignLogout = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { origin: 'https://another.example', cookie },
    })
    expect(foreignLogout.statusCode).toBe(403)
    expect(
      (await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })).statusCode,
    ).toBe(200)

    const logout = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { origin, cookie },
    })
    expect(logout.statusCode).toBe(204)
    expect(logout.headers['set-cookie']).toContain('Max-Age=0')
    expect(
      (await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })).statusCode,
    ).toBe(401)
  } finally {
    await app.close()
  }
})

test('accepts a code only once under concurrent verification', async () => {
  const { app } = setup()
  try {
    await app.inject({
      method: 'POST',
      url: '/api/auth/request-code',
      headers: { origin },
      payload: { phone },
    })
    const verify = () =>
      app.inject({
        method: 'POST',
        url: '/api/auth/verify-code',
        headers: { origin },
        payload: { phone, code: '123456' },
      })
    const responses = await Promise.all([verify(), verify()])
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 400])
  } finally {
    await app.close()
  }
})

test('limits resends and code guesses, and expires old codes', async () => {
  const { app, advance } = setup()
  try {
    const send = () =>
      app.inject({
        method: 'POST',
        url: '/api/auth/request-code',
        headers: { origin },
        payload: { phone },
      })
    const verify = (code: string) =>
      app.inject({
        method: 'POST',
        url: '/api/auth/verify-code',
        headers: { origin },
        payload: { phone, code },
      })

    expect((await send()).statusCode).toBe(202)
    const limited = await send()
    expect(limited.statusCode).toBe(429)
    expect(limited.headers['retry-after']).toBe('60')
    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect((await verify('000000')).statusCode).toBe(400)
    }
    expect((await verify('000000')).statusCode).toBe(429)
    expect((await verify('123456')).statusCode).toBe(429)

    advance(60_000)
    expect((await send()).statusCode).toBe(202)
    advance(5 * 60_000)
    expect((await verify('123456')).statusCode).toBe(400)
  } finally {
    await app.close()
  }
})

test('rejects malformed input and cross-origin posts without sending', async () => {
  const { app, sent } = setup()
  try {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/request-code',
          headers: { origin: 'https://another.example' },
          payload: { phone },
        })
      ).statusCode,
    ).toBe(403)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/request-code',
          headers: { origin },
          payload: { phone: '123' },
        })
      ).statusCode,
    ).toBe(400)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/request-code',
          headers: { origin },
          payload: { phone: '+7abc9991234567' },
        })
      ).statusCode,
    ).toBe(400)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/request-code',
          headers: { origin },
          payload: { phone: '7+9991234567' },
        })
      ).statusCode,
    ).toBe(400)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/request-code',
          headers: { origin },
          payload: { phone, extra: true },
        })
      ).statusCode,
    ).toBe(400)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/request-code',
          headers: { origin },
          payload: { phone: 79991234567 },
        })
      ).statusCode,
    ).toBe(400)
    expect(sent).toEqual([])
  } finally {
    await app.close()
  }
})

test('limits requests across many phone numbers from the same address', async () => {
  const { app, sent } = setup()
  try {
    for (let index = 0; index < 20; index += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/request-code',
        headers: { origin },
        payload: { phone: `+7999000${String(index).padStart(4, '0')}` },
      })
      expect(response.statusCode).toBe(202)
    }
    const blocked = await app.inject({
      method: 'POST',
      url: '/api/auth/request-code',
      headers: { origin },
      payload: { phone: '+79990009999' },
    })
    expect(blocked.statusCode).toBe(429)
    expect(sent).toHaveLength(20)
  } finally {
    await app.close()
  }
})

test('rejects a numeric code without consuming the valid challenge', async () => {
  const { app } = setup()
  try {
    await app.inject({
      method: 'POST',
      url: '/api/auth/request-code',
      headers: { origin },
      payload: { phone },
    })
    const numeric = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-code',
      headers: { origin },
      payload: { phone, code: 123456 },
    })
    expect(numeric.statusCode).toBe(400)
    const valid = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-code',
      headers: { origin },
      payload: { phone, code: '123456' },
    })
    expect(valid.statusCode).toBe(200)
  } finally {
    await app.close()
  }
})

test('expires sessions and enforces the hourly send limit', async () => {
  const { app, advance } = setup()
  try {
    const send = () =>
      app.inject({
        method: 'POST',
        url: '/api/auth/request-code',
        headers: { origin },
        payload: { phone },
      })
    expect((await send()).statusCode).toBe(202)
    const verify = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-code',
      headers: { origin },
      payload: { phone, code: '123456' },
    })
    const cookie = verify.headers['set-cookie'] as string
    for (let sendIndex = 1; sendIndex < 5; sendIndex += 1) {
      advance(60_000)
      expect((await send()).statusCode).toBe(202)
    }
    advance(60_000)
    expect((await send()).statusCode).toBe(429)
    advance(7 * 24 * 60 * 60_000)
    expect(
      (await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })).statusCode,
    ).toBe(401)
    expect((await send()).statusCode).toBe(202)
  } finally {
    await app.close()
  }
})

test('keeps a new challenge when an older delivery fails late', async () => {
  let now = 1_000_000
  let rejectFirst: ((reason?: Error) => void) | undefined
  let calls = 0
  const auth = createAuthService({
    store: createMemoryAuthStore(),
    sender: {
      async send() {
        calls += 1
        if (calls === 1) {
          await new Promise<void>((_resolve, reject) => {
            rejectFirst = reject
          })
        }
      },
    },
    secret: 'test-secret',
    developmentCode: '123456',
    now: () => now,
  })
  const app = createApp(auth, { origins: [origin], secureCookies: false })
  try {
    const request = () =>
      app.inject({
        method: 'POST',
        url: '/api/auth/request-code',
        headers: { origin },
        payload: { phone },
      })
    const first = request()
    await vi.waitFor(() => expect(rejectFirst).toBeDefined())
    now += 5 * 60_000
    expect((await request()).statusCode).toBe(202)
    rejectFirst?.(new Error('provider unavailable'))
    expect((await first).statusCode).toBe(503)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/verify-code',
          headers: { origin },
          payload: { phone, code: '123456' },
        })
      ).statusCode,
    ).toBe(200)
  } finally {
    await app.close()
  }
})

test('does not leave a usable code if delivery fails', async () => {
  const { app } = setup({ failingSender: true })
  try {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/request-code',
          headers: { origin },
          payload: { phone },
        })
      ).statusCode,
    ).toBe(503)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/verify-code',
          headers: { origin },
          payload: { phone, code: '123456' },
        })
      ).statusCode,
    ).toBe(400)
  } finally {
    await app.close()
  }
})

test('keeps the previous valid code if a resend fails', async () => {
  let now = 1_000_000
  let sends = 0
  const auth = createAuthService({
    store: createMemoryAuthStore(),
    sender: {
      async send() {
        sends += 1
        if (sends === 2) throw new Error('provider unavailable')
      },
    },
    secret: 'test-secret',
    now: () => now,
    developmentCode: '123456',
  })
  const app = createApp(auth, { origins: [origin], secureCookies: false })
  try {
    const request = () =>
      app.inject({
        method: 'POST',
        url: '/api/auth/request-code',
        headers: { origin },
        payload: { phone },
      })
    expect((await request()).statusCode).toBe(202)
    now += 60_000
    expect((await request()).statusCode).toBe(503)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/verify-code',
          headers: { origin },
          payload: { phone, code: '123456' },
        })
      ).statusCode,
    ).toBe(200)
  } finally {
    await app.close()
  }
})

test('completes a pending resend after the previous code was used', async () => {
  let now = 1_000_000
  let sends = 0
  let completeSecond: (() => void) | undefined
  const auth = createAuthService({
    store: createMemoryAuthStore(),
    sender: {
      async send() {
        sends += 1
        if (sends === 2) {
          await new Promise<void>((resolve) => {
            completeSecond = resolve
          })
        }
      },
    },
    secret: 'test-secret',
    now: () => now,
    developmentCode: '123456',
  })
  const app = createApp(auth, { origins: [origin], secureCookies: false })
  try {
    const request = () =>
      app.inject({
        method: 'POST',
        url: '/api/auth/request-code',
        headers: { origin },
        payload: { phone },
      })
    const verify = () =>
      app.inject({
        method: 'POST',
        url: '/api/auth/verify-code',
        headers: { origin },
        payload: { phone, code: '123456' },
      })
    expect((await request()).statusCode).toBe(202)
    now += 60_000
    const second = request()
    await vi.waitFor(() => expect(completeSecond).toBeDefined())
    expect((await verify()).statusCode).toBe(200)
    completeSecond?.()
    expect((await second).statusCode).toBe(202)
    expect((await verify()).statusCode).toBe(200)
  } finally {
    await app.close()
  }
})

test('distinguishes malformed bodies from invalid phone numbers', async () => {
  const { app } = setup()
  try {
    const malformed = await app.inject({
      method: 'POST',
      url: '/api/auth/request-code',
      headers: { origin },
      payload: { phone: 79991234567 },
    })
    expect(malformed.statusCode).toBe(400)
    expect(malformed.json()).toEqual({
      error: { code: 'INVALID_BODY', message: 'Проверьте данные запроса' },
    })

    const invalidPhone = await app.inject({
      method: 'POST',
      url: '/api/auth/request-code',
      headers: { origin },
      payload: { phone: '+7abc9991234567' },
    })
    expect(invalidPhone.statusCode).toBe(400)
    expect(invalidPhone.json()).toEqual({
      error: { code: 'INVALID_PHONE', message: 'Введите российский мобильный номер' },
    })
  } finally {
    await app.close()
  }
})

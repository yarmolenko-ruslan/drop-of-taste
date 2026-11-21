// @vitest-environment node
import { connect } from 'node:net'
import { createApp } from '../../app.ts'
import type { AuthService } from '../../modules/auth/service.ts'

test('ambiguous HTTP framing is rejected before an authentication handler executes', async () => {
  const startCall = vi.fn(async () => ({ status: 'accepted', retryAfterSeconds: 60 }))
  const app = createApp({ startCall } as unknown as AuthService, {
    origins: ['http://localhost:5173'],
    secureCookies: false,
  })
  await app.listen({ host: '127.0.0.1', port: 0 })
  const address = app.server.address()
  if (!address || typeof address === 'string') throw new Error('No HTTP port')
  try {
    for (const framing of [
      'Content-Length: 5\r\nContent-Length: 6',
      'Content-Length: 5\r\nTransfer-Encoding: chunked',
    ]) {
      const raw = await new Promise<string>((resolve, reject) => {
        const socket = connect(address.port, '127.0.0.1')
        let output = ''
        socket.setTimeout(2000, () =>
          socket.destroy(new Error('HTTP parser did not close connection')),
        )
        socket.on('data', (chunk: Buffer) => {
          output += chunk.toString()
        })
        socket.on('error', reject)
        socket.on('close', () => resolve(output))
        socket.on('connect', () =>
          socket.write(
            `POST /api/auth/call/start HTTP/1.1\r\nHost: localhost\r\nOrigin: http://localhost:5173\r\n${framing}\r\nConnection: close\r\n\r\n0\r\n\r\n`,
          ),
        )
      })
      expect(raw).toContain('400 Bad Request')
    }
    expect(startCall).not.toHaveBeenCalled()
  } finally {
    await app.close()
  }
})

test('prototype pollution, malformed JSON and excessive bodies cannot reach authentication logic', async () => {
  const startCall = vi.fn()
  const app = createApp({ startCall } as unknown as AuthService, {
    origins: ['http://localhost:5173'],
    secureCookies: false,
  })
  try {
    for (const [payload, status] of [
      ['{"phone":"+79991234567","__proto__":{"admin":true}}', 400],
      ['{"phone":', 400],
      ['x'.repeat(70000), 413],
    ] as const) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/call/start',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        payload,
      })
      expect(response.statusCode).toBe(status)
      expect(response.headers['x-content-type-options']).toBe('nosniff')
      expect(response.body).not.toContain('stack')
    }
    expect(startCall).not.toHaveBeenCalled()
    expect(Object.prototype).not.toHaveProperty('admin')
  } finally {
    await app.close()
  }
})

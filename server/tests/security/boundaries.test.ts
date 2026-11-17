// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MongoClient } from 'mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { createApp } from '../../app.ts'
import { registerAdminRoutes } from '../../modules/admin/routes.ts'
import { createMongoAuthStore, ensureAuthIndexes } from '../../modules/auth/mongo-store.ts'
import { createAuthService } from '../../modules/auth/service.ts'
import { seedCatalog } from '../../modules/catalog/mongo-catalog.ts'
import { registerProfileRoutes } from '../../modules/profile/routes.ts'
import { registerIikoRoutes } from '../../integrations/iiko/iiko.ts'
import { ensureShopIndexes, registerShopRoutes } from '../../modules/orders/routes.ts'
import { defaultSiteContent } from '../../../shared/site-content.ts'
import type { AuthService } from '../../modules/auth/service.ts'

const origin = 'http://localhost:5173'
let replica: MongoMemoryReplSet
let mongo: MongoClient
beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({
    binary: { downloadDir: join(tmpdir(), 'drop-of-taste-mongodb') },
    replSet: { count: 1 },
  })
  mongo = new MongoClient(replica.getUri())
  await mongo.connect()
}, 20000)
afterAll(async () => {
  await mongo?.close()
  await replica?.stop()
})

async function setup() {
  const db = mongo.db(`boundaries_${randomUUID().replaceAll('-', '')}`)
  await ensureAuthIndexes(db)
  await ensureShopIndexes(db)
  await seedCatalog(db)
  const auth = createAuthService({
    store: createMongoAuthStore(mongo, db),
    secret: 'isolated-security-test',
    developmentCode: '123456',
    sender: { send: async () => {} },
  })
  const app = createApp(auth, { origins: [origin], secureCookies: false })
  registerProfileRoutes(app, db, mongo, auth, [origin])
  registerShopRoutes(app, db, mongo, auth, [origin])
  await registerAdminRoutes(app, db, [origin], 'audit-admin-password', mongo)
  registerIikoRoutes(app, db, mongo)
  const sent = await auth.requestCode('+79991234567', '127.0.0.1')
  expect(sent.status).toBe('accepted')
  const login = await auth.verifyCode('+79991234567', '123456')
  if (login.status !== 'verified') throw new Error('Test sign-in failed')
  return { app, db, headers: { origin, cookie: `dev_session=${login.token}` } }
}

// Encode letters in static segments. Fastify still resolves the original route.
function aliases(path: string) {
  return [
    path,
    path.replace('/api/', '/%61pi/'),
    `${path.slice(0, 5)}%${path.charCodeAt(5).toString(16)}${path.slice(6)}`,
  ]
}

test('changing the administrator password revokes existing sessions across server instances', async () => {
  const { app, db } = await setup()
  const next = createApp({} as AuthService, { origins: [origin], secureCookies: false })
  try {
    const login = await app.inject({
      method: 'POST',
      url: '/api/admin/login',
      headers: { origin },
      payload: { password: 'audit-admin-password' },
    })
    const cookie = login.headers['set-cookie']!.toString().split(';')[0]
    await registerAdminRoutes(next, db, [origin], 'changed-audit-password', mongo)
    expect((await next.inject({ url: '/api/admin/session', headers: { cookie } })).statusCode).toBe(
      401,
    )
    expect((await app.inject({ url: '/api/admin/session', headers: { cookie } })).statusCode).toBe(
      401,
    )
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/admin/login',
          headers: { origin },
          payload: { password: 'audit-admin-password' },
        })
      ).statusCode,
    ).toBe(409)
    expect(
      (
        await next.inject({
          method: 'POST',
          url: '/api/admin/login',
          headers: { origin },
          payload: { password: 'changed-audit-password' },
        })
      ).statusCode,
    ).toBe(200)
  } finally {
    await next.close()
    await app.close()
  }
})

test('a restart with unchanged administrator credentials preserves a valid session', async () => {
  const { app, db } = await setup()
  const next = createApp({} as AuthService, { origins: [origin], secureCookies: false })
  try {
    const login = await app.inject({
      method: 'POST',
      url: '/api/admin/login',
      headers: { origin },
      payload: { password: 'audit-admin-password' },
    })
    const cookie = login.headers['set-cookie']!.toString().split(';')[0]
    await registerAdminRoutes(next, db, [origin], 'audit-admin-password', mongo)
    expect((await next.inject({ url: '/api/admin/session', headers: { cookie } })).statusCode).toBe(
      200,
    )
  } finally {
    await next.close()
    await app.close()
  }
})

test('stored links cannot become an external redirect through control characters or backslashes', async () => {
  const { app } = await setup()
  try {
    const login = await app.inject({
      method: 'POST',
      url: '/api/admin/login',
      headers: { origin },
      payload: { password: 'audit-admin-password' },
    })
    const cookie = login.headers['set-cookie']!.toString().split(';')[0]
    for (const payload of [
      { heroSlides: [{ ...defaultSiteContent.heroSlides[0], href: '/\t/attacker.invalid' }] },
      { brandLogo: '/\\attacker.invalid/logo.png' },
      { settings: { ...defaultSiteContent.settings, favicon: '/\\attacker.invalid/icon.png' } },
    ]) {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/admin/content',
        headers: { origin, cookie },
        payload,
      })
      expect(response.statusCode).toBe(400)
    }
  } finally {
    await app.close()
  }
})

test('encoded admin routes never expose clients, orders, logs or mutations without a session', async () => {
  const { app, db } = await setup()
  try {
    const privateEmail = 'private-audit@example.invalid'
    await db.collection('users').updateOne({}, { $set: { email: privateEmail } })
    for (const route of [
      'session',
      'dashboard',
      'orders',
      'clients',
      'clients/victim',
      'logs',
      'bonus-codes',
    ]) {
      for (const url of aliases(`/api/admin/${route}`)) {
        for (const method of ['GET', 'HEAD'] as const) {
          const response = await app.inject({ method, url })
          expect(response.statusCode, `${method} ${url}`).toBe(401)
          expect(response.headers['cache-control']).toBe('no-store')
          expect(response.body).not.toContain(privateEmail)
        }
      }
    }
    for (const [method, path] of [
      ['POST', '/api/admin/categories'],
      ['PUT', '/api/admin/categories/victim'],
      ['DELETE', '/api/admin/categories/victim'],
      ['POST', '/api/admin/products'],
      ['PUT', '/api/admin/products/victim'],
      ['DELETE', '/api/admin/products/victim'],
      ['PATCH', '/api/admin/content'],
      ['PUT', '/api/admin/content'],
      ['PATCH', '/api/admin/orders/victim/stage'],
      ['POST', '/api/admin/bonus-codes'],
      ['PUT', '/api/admin/bonus-codes/victim'],
      ['DELETE', '/api/admin/bonus-codes/victim'],
      ['POST', '/api/admin/iiko/sync'],
      ['POST', '/api/admin/upload'],
    ] as const) {
      for (const url of aliases(path)) {
        const response = await app.inject({
          method,
          url,
          headers: { origin },
          payload: { title: 'Unauthorized' },
        })
        expect(response.statusCode, `${method} ${url}`).toBe(401)
      }
    }
    expect(
      await db.collection('catalog_categories').countDocuments({ title: 'Unauthorized' }),
    ).toBe(0)
  } finally {
    await app.close()
  }
})

test('encoded routes preserve Origin checks, account guards and private cache headers', async () => {
  const { app, headers } = await setup()
  try {
    const mutations = [
      ['POST', '/api/auth/request-code', { phone: '+79990000001' }],
      ['POST', '/api/auth/verify-code', { phone: '+79990000001', code: '123456', consent: true }],
      ['POST', '/api/auth/logout', undefined],
      ['PUT', '/api/profile/notifications', { push: false, email: false, sms: false }],
      ['POST', '/api/addresses', {}],
      ['POST', '/api/checkout/quote', {}],
      ['POST', '/api/orders/statuses', { ids: ['victim'] }],
    ] as const
    for (const [method, path, payload] of mutations) {
      for (const url of aliases(path)) {
        const response = await app.inject({
          method,
          url,
          payload,
          headers: { ...headers, origin: 'https://attacker.invalid' },
        })
        expect(response.statusCode, `${method} ${url}`).toBe(403)
        expect(response.headers['cache-control']).toBe('no-store')
      }
    }
    for (const path of [
      '/api/auth/me',
      '/api/profile',
      '/api/addresses',
      '/api/orders',
      '/api/checkout/config',
    ]) {
      const url = path.replace('/api/', '/%61pi/')
      const response = await app.inject({ url, headers })
      expect(response.statusCode, url).toBe(200)
      expect(response.headers['cache-control'], url).toBe('no-store')
      if (path !== '/api/auth/me') {
        const changed = await app.inject({
          url,
          headers: { ...headers, 'x-account-id': 'another-account' },
        })
        expect(changed.statusCode, url).toBe(409)
      }
    }
  } finally {
    await app.close()
  }
})

test('admin login with query parameters succeeds and logout revokes encoded routes too', async () => {
  const { app } = await setup()
  try {
    const login = await app.inject({
      method: 'POST',
      url: '/api/admin/login?source=audit',
      headers: { origin },
      payload: { password: 'audit-admin-password' },
    })
    expect(login.statusCode).toBe(200)
    const cookie = login.headers['set-cookie']!.toString().split(';')[0]
    expect(
      (await app.inject({ url: '/api/%61dmin/session', headers: { cookie } })).statusCode,
    ).toBe(200)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/%61dmin/logout',
          headers: { origin, cookie },
        })
      ).statusCode,
    ).toBe(200)
    expect(
      (await app.inject({ url: '/api/%61dmin/session', headers: { cookie } })).statusCode,
    ).toBe(401)
  } finally {
    await app.close()
  }
})

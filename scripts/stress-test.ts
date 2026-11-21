import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { monitorEventLoopDelay, performance } from 'node:perf_hooks'
import { setImmediate } from 'node:timers/promises'
import { MongoClient } from 'mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { createApp } from '../server/app.ts'
import { registerAdminRoutes } from '../server/modules/admin/routes.ts'
import { createMongoAuthStore, ensureAuthIndexes } from '../server/modules/auth/mongo-store.ts'
import { createAuthService } from '../server/modules/auth/service.ts'
import { getCatalog, seedCatalog } from '../server/modules/catalog/mongo-catalog.ts'
import { registerProfileRoutes } from '../server/modules/profile/routes.ts'
import { ensureShopIndexes, registerShopRoutes } from '../server/modules/orders/routes.ts'
import { getPublicSiteContent } from '../server/modules/content/service.ts'
import { registerSiteUpdateRoutes } from '../server/modules/content/updates.ts'
import type { YooPayment } from '../server/modules/payments/yookassa.ts'
import { restrictStressFetch } from './stress-network.ts'

// No .env, existing MongoDB, real SMS, payment or iiko services are used.
const networkGuard = restrictStressFetch()
let simulatedRegistrations = 0
const origin = 'http://localhost:5175'
const origins = [origin, 'http://127.0.0.1:5175']
const replica = await MongoMemoryReplSet.create({
  binary: { downloadDir: join(tmpdir(), 'drop-of-taste-mongodb') },
  replSet: { count: 1 },
})
const mongo = new MongoClient(replica.getUri())
const payments = new Map<string, YooPayment>()
await mongo.connect()
const db = mongo.db(`audit_${randomUUID().replaceAll('-', '')}`)
await ensureAuthIndexes(db)
await ensureShopIndexes(db)
await seedCatalog(db)
const auth = createAuthService({
  store: createMongoAuthStore(mongo, db),
  provider: {
    async start() {
      simulatedRegistrations++
      return { checkId: randomUUID(), callPhone: '+78005008275' }
    },
    async status() {
      return 'verified'
    },
  },
})
const app = createApp(auth, { origins, secureCookies: false })
app.get('/api/catalog', async (_request, reply) => {
  reply.header('Cache-Control', 'no-store')
  return getCatalog(db)
})
app.get('/api/site-content', async (_request, reply) => {
  reply.header('Cache-Control', 'no-store')
  return getPublicSiteContent(db)
})
registerProfileRoutes(app, db, mongo, auth, origins)
registerShopRoutes(app, db, mongo, auth, origins, false, {
  async create(orderId, totalKopecks) {
    const id = `audit-${orderId}`
    const payment: YooPayment = {
      id,
      status: 'pending',
      paid: false,
      test: true,
      amount: { value: (totalKopecks / 100).toFixed(2), currency: 'RUB' },
      confirmation: { confirmation_url: 'https://yoomoney.ru/audit-placeholder' },
    }
    payments.set(id, payment)
    return payment
  },
  async get(id) {
    const payment = payments.get(id)
    assert(payment, 'Unknown test payment')
    return payment
  },
})
await registerAdminRoutes(app, db, origins, 'audit-admin-password', mongo)
registerSiteUpdateRoutes(app)
await app.listen({ host: '127.0.0.1', port: 0 })
networkGuard.allowLocalOrigin(app.listeningOrigin!)

if (process.argv.includes('--serve')) {
  const { createServer } = await import('vite')
  const vite = await createServer({
    server: {
      host: '127.0.0.1',
      port: 5175,
      strictPort: true,
      proxy: { '/api': app.listeningOrigin! },
    },
  })
  await vite.listen()
  console.log(
    'Isolated audit app: http://127.0.0.1:5175; test call verification: automatic (fake provider); admin: audit-admin-password',
  )
  let closing = false
  const close = async () => {
    if (closing) return
    closing = true
    await vite.close()
    await app.close()
    await mongo.close()
    await replica.stop()
    networkGuard.restore()
  }
  process.once('SIGINT', () => void close())
  process.once('SIGTERM', () => void close())
} else {
  const lag = monitorEventLoopDelay({ resolution: 10 })
  try {
    async function call<T>(path: string, init: RequestInit = {}, expected = 200) {
      const response = await fetch(`${app.listeningOrigin}/api${path}`, {
        ...init,
        headers: {
          origin,
          ...(init.body && { 'Content-Type': 'application/json' }),
          ...init.headers,
        },
        signal: AbortSignal.timeout(15_000),
      })
      const text = await response.text()
      assert.equal(
        response.status,
        expected,
        `${init.method ?? 'GET'} ${path}: ${text.slice(0, 250)}`,
      )
      return { data: (text ? JSON.parse(text) : undefined) as T, response }
    }
    async function login(phone: string) {
      const started = await call<{ attemptToken: string }>(
        '/auth/call/start',
        { method: 'POST', body: JSON.stringify({ phone, consent: true }) },
        202,
      )
      const result = await call<{ user: { id: string } }>('/auth/call/status', {
        method: 'POST',
        body: JSON.stringify({ attemptToken: started.data.attemptToken, consent: true }),
      })
      return {
        cookie: result.response.headers.get('set-cookie')!.split(';')[0]!,
        'X-Account-Id': result.data.user.id,
      }
    }
    const headers = await login('+79991234567')
    const other = await login('+79991234568')
    await call('/profile', {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        name: 'Audit User',
        email: 'audit@example.invalid',
        birthday: '',
        notifications: { push: false, email: true, sms: false },
      }),
    })
    const addressPayload = {
      label: 'г. Красноярск, Тестовая улица, 10',
      details: {
        street: 'Тестовая улица, 10',
        entrance: '1',
        floor: '2',
        flat: '3',
        comment: '',
        isHouse: false,
      },
    }
    const address = await call<{ address: { id: string } }>(
      '/addresses',
      { method: 'POST', headers, body: JSON.stringify(addressPayload) },
      201,
    )
    const addressId = address.data.address.id
    await call(`/addresses/${addressId}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ ...addressPayload, label: 'г. Красноярск, Тестовая улица, 11' }),
    })
    await call(`/addresses/${addressId}`, { method: 'DELETE', headers: other }, 404)
    await call('/profile/delivery-selection', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ addressId }),
    })
    await call(`/addresses/${addressId}`, { method: 'DELETE', headers }, 204)
    assert.equal(
      (await call<{ profile: { selectedAddressId: string | null } }>('/profile', { headers })).data
        .profile.selectedAddressId,
      null,
    )
    const content = (await call<{ address: string }>('/site-content')).data
    const input = {
      lines: [{ productId: 'borscht', quantity: 2, extras: [] }],
      fulfillment: { mode: 'pickup', label: content.address },
    }
    const quote = (
      await call<{ totalKopecks: number }>('/checkout/quote', {
        method: 'POST',
        headers,
        body: JSON.stringify(input),
      })
    ).data
    const orderBody = JSON.stringify({ ...input, expectedTotalKopecks: quote.totalKopecks })
    await call(
      '/orders',
      {
        method: 'POST',
        headers: { ...headers, 'Idempotency-Key': 'bad-price-audit' },
        body: JSON.stringify({ ...input, expectedTotalKopecks: 1 }),
      },
      409,
    )
    const repeats = await Promise.all(
      Array.from({ length: 50 }, async () => {
        const result = await fetch(`${app.listeningOrigin}/api/orders`, {
          method: 'POST',
          headers: {
            ...headers,
            origin,
            'Content-Type': 'application/json',
            'Idempotency-Key': 'same-audit-order',
          },
          body: orderBody,
          signal: AbortSignal.timeout(15_000),
        })
        assert([200, 201].includes(result.status))
        return ((await result.json()) as { order: { _id: string } }).order._id
      }),
    )
    assert.equal(new Set(repeats).size, 1)
    const orderId = repeats[0]!
    await call(`/orders/${orderId}/payment`, { headers: other }, 404)
    await call(`/orders/${orderId}/pay`, { method: 'POST', headers })
    const payment = payments.get(`audit-${orderId}`)!
    payments.set(payment.id, {
      ...payment,
      paid: true,
      status: 'succeeded',
      captured_at: new Date().toISOString(),
    })
    assert.equal(
      (await call<{ status: string }>(`/orders/${orderId}/payment`, { headers })).data.status,
      'succeeded',
    )
    const adminLogin = await call('/admin/login', {
      method: 'POST',
      body: JSON.stringify({ password: 'audit-admin-password' }),
    })
    const admin = { cookie: adminLogin.response.headers.get('set-cookie')!.split(';')[0]! }
    await call(`/admin/orders/${orderId}/stage`, {
      method: 'PATCH',
      headers: admin,
      body: JSON.stringify({ stage: 'preparing' }),
    })
    await call(`/admin/orders/${orderId}/stage`, {
      method: 'PATCH',
      headers: admin,
      body: JSON.stringify({ stage: 'delivering' }),
    })
    await call(`/admin/orders/${orderId}/stage`, {
      method: 'PATCH',
      headers: admin,
      body: JSON.stringify({ stage: 'completed' }),
    })
    await call(`/orders/${orderId}/cancel`, { method: 'POST', headers }, 409)
    const paths = [
      '/catalog',
      '/site-content',
      '/auth/me',
      '/profile',
      '/addresses',
      '/checkout/config',
      '/orders',
      '/checkout/quote',
      '/orders/statuses',
      '/%61dmin/clients',
    ]
    let completed = 0
    async function batch(count: number, concurrency: number) {
      let next = 0
      const times: number[] = []
      const start = performance.now()
      await Promise.all(
        Array.from({ length: concurrency }, async () => {
          while (next < count) {
            const index = next++
            const path = paths[index % paths.length]!
            const started = performance.now()
            const payload =
              path === '/checkout/quote'
                ? input
                : path === '/orders/statuses'
                  ? { ids: [orderId] }
                  : undefined
            const result = await call(
              path,
              { headers, ...(payload && { method: 'POST', body: JSON.stringify(payload) }) },
              path.startsWith('/%') ? 401 : 200,
            )
            if (path === '/orders')
              assert(!JSON.stringify(result.data).includes(other['X-Account-Id']))
            times.push(performance.now() - started)
            completed++
          }
        }),
      )
      times.sort((a, b) => a - b)
      const elapsedMs = performance.now() - start
      return {
        requests: count,
        concurrency,
        elapsedMs: Math.round(elapsedMs),
        requestsPerSecond: Math.round((count / elapsedMs) * 1000),
        p50Ms: Math.round(times[Math.floor(times.length * 0.5)]!),
        p95Ms: Math.round(times[Math.floor(times.length * 0.95)]!),
        p99Ms: Math.round(times[Math.floor(times.length * 0.99)]!),
      }
    }
    async function memory() {
      await setImmediate()
      global.gc?.()
      await setImmediate()
      global.gc?.()
      const data = process.memoryUsage()
      return {
        heapMiB: +(data.heapUsed / 2 ** 20).toFixed(2),
        rssMiB: +(data.rss / 2 ** 20).toFixed(2),
        externalMiB: +(data.external / 2 ** 20).toFixed(2),
        arrayBuffersMiB: +(data.arrayBuffers / 2 ** 20).toFixed(2),
      }
    }
    await batch(300, 30)
    const baseline = await memory()
    lag.enable()
    const rounds = []
    for (const concurrency of [25, 50, 100, 200, 200, 50]) {
      rounds.push({ ...(await batch(2000, concurrency)), memory: await memory() })
    }
    lag.disable()
    const final = await memory()
    const report = {
      test: 'isolated HTTP stress',
      node: process.version,
      completedRequests: completed,
      externalProviderCalls: 0,
      blockedExternalRequests: networkGuard.blockedRequests,
      simulatedRegistrations,
      functionalChecks:
        'callcheck/session, profile, address CRUD/ownership, selected-address cleanup, server price, 50 concurrent idempotent orders, payment, admin order stages, foreign-order denial',
      baseline,
      rounds,
      final,
      retainedHeapGrowthMiB: +(final.heapMiB - baseline.heapMiB).toFixed(2),
      eventLoopP99Ms: +(lag.percentile(99) / 1e6).toFixed(2),
      gcAvailable: Boolean(global.gc),
    }
    console.log(JSON.stringify(report, null, 2))
    assert.equal(
      networkGuard.blockedRequests,
      0,
      'An external provider was incorrectly used in the stress test',
    )
    assert(
      final.heapMiB - baseline.heapMiB < 32,
      'Retained heap grew by over 32 MiB; inspect a heap profile',
    )
    await call('/auth/logout', { method: 'POST', headers }, 204)
    await call('/profile', { headers }, 401)
  } finally {
    lag.disable()
    await app.close()
    await mongo.close()
    await replica.stop()
    networkGuard.restore()
  }
}

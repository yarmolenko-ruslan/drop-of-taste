// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { Collection, MongoClient, type Document, type Filter, type FindOptions } from 'mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { registerAdminRoutes } from './routes.ts'
import { seedCatalog } from '../catalog/mongo-catalog.ts'
import { defaultSiteContent } from '../../../shared/site-content.ts'
import { permissions, permissionGroups, type Permission } from '../../../shared/admin-access.ts'

const origin = 'http://localhost:5173'
const personalPassword = 'employee-personal-password-2026'
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
const cookieOf = (response: { headers: Record<string, unknown> }) =>
  String(response.headers['set-cookie']).split(';')[0]!
async function setup(https = false) {
  const db = mongo.db(`access_${randomUUID().replaceAll('-', '')}`)
  await seedCatalog(db)
  const app = Fastify()
  await registerAdminRoutes(
    app,
    db,
    [origin, ...(https ? ['https://example.invalid'] : [])],
    'owner-password',
    mongo,
  )
  app.post('/api/admin/iiko/sync', async () => ({ ok: true }))
  app.get('/api/admin/future-feature', async () => ({ secret: true }))
  app.delete('/api/admin/orders', async () => ({ shouldNotRun: true }))
  app.post('/api/admin/clients', async () => ({ shouldNotRun: true }))
  const login = await app.inject({
    method: 'POST',
    url: '/api/admin/login',
    headers: { origin },
    payload: { password: 'owner-password' },
  })
  expect(login.statusCode).toBe(200)
  const owner = { origin, cookie: cookieOf(login) }
  const create = async (grants: Permission[] = [], login = 'operator.one') => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/employees',
      headers: owner,
      payload: { login, name: 'Оператор', active: true, permissions: grants },
    })
    expect(response.statusCode, response.body).toBe(201)
    return response.json() as {
      employee: { id: string; revision: string; login: string }
      temporaryPassword: string
      temporaryPasswordExpiresAt: string
    }
  }
  const signIn = async (login: string, password = personalPassword) =>
    app.inject({
      method: 'POST',
      url: '/api/admin/login',
      headers: { origin },
      payload: { login, password },
    })
  const activate = async (grants: Permission[] = []) => {
    const created = await create(grants)
    const initial = await signIn(created.employee.login, created.temporaryPassword)
    expect(initial.statusCode).toBe(200)
    const changed = await app.inject({
      method: 'POST',
      url: '/api/admin/password',
      headers: { origin, cookie: cookieOf(initial) },
      payload: { currentPassword: created.temporaryPassword, newPassword: personalPassword },
    })
    expect(changed.statusCode, changed.body).toBe(200)
    const signed = await signIn(created.employee.login)
    expect(signed.statusCode, signed.body).toBe(200)
    return { ...created, headers: { origin, cookie: cookieOf(signed) } }
  }
  return { app, db, owner, create, signIn, activate, login }
}

test('creation normalizes logins, rejects mass assignment and duplicates, and never lists secrets', async () => {
  const { app, db, owner, create } = await setup()
  try {
    const created = await create(['orders.read'], '  Operator.One  ')
    expect(created.employee.login).toBe('operator.one')
    expect(created.temporaryPassword.length).toBeGreaterThanOrEqual(24)
    const stored = await db.collection('admin_employees').findOne({ login: 'operator.one' })
    expect(stored?.passwordHash).toHaveLength(128)
    expect(stored?.salt).toHaveLength(64)
    expect(JSON.stringify(stored)).not.toContain(created.temporaryPassword)
    for (const payload of [
      { login: 'operator.one', name: 'Дубликат', active: true, permissions: [] },
      { login: 'owner', name: 'Нельзя', active: true, permissions: [] },
      { login: { $ne: '' }, name: 'Инъекция', active: true, permissions: [] },
      { login: 'another', name: 'Админ', active: true, permissions: [], role: 'owner' },
      { login: 'another', name: 'Права', active: true, permissions: ['employees.manage'] },
      { login: 'another', name: 'Права', active: true, permissions: ['orders.manage'] },
      {
        login: 'another',
        name: 'Права',
        active: true,
        permissions: ['orders.read', 'orders.read'],
      },
    ]) {
      const result = await app.inject({
        method: 'POST',
        url: '/api/admin/employees',
        headers: owner,
        payload,
      })
      expect([400, 409]).toContain(result.statusCode)
    }
    const list = await app.inject({ url: '/api/admin/employees', headers: owner })
    expect(list.json().employees).toHaveLength(1)
    for (const value of ['passwordHash', 'salt', 'temporaryPassword', created.temporaryPassword])
      expect(list.body).not.toContain(value)
    const logs = await app.inject({ url: '/api/admin/logs', headers: owner })
    expect(logs.json().changes[0].actor.role).toBe('owner')
    for (const value of ['passwordHash', 'salt', created.temporaryPassword])
      expect(logs.body).not.toContain(value)
  } finally {
    await app.close()
  }
})

test('temporary login requires password change, validates current password, revokes tokens and expires after 48 hours', async () => {
  const { app, db, owner, create, signIn } = await setup()
  try {
    const created = await create(['orders.read'])
    const initial = await signIn('OPERATOR.ONE', created.temporaryPassword)
    expect(initial.json().principal.mustChangePassword).toBe(true)
    const headers = { origin, cookie: cookieOf(initial) }
    for (const route of ['dashboard', 'orders', 'employees', 'clients'])
      expect((await app.inject({ url: `/api/admin/${route}`, headers })).statusCode).toBe(403)
    for (const payload of [
      { currentPassword: 'wrong', newPassword: personalPassword },
      { currentPassword: created.temporaryPassword, newPassword: 'short' },
      { currentPassword: created.temporaryPassword, newPassword: 'x'.repeat(129) },
      { currentPassword: created.temporaryPassword, newPassword: created.temporaryPassword },
    ])
      expect(
        (await app.inject({ method: 'POST', url: '/api/admin/password', headers, payload }))
          .statusCode,
      ).toBe(400)
    const changed = await app.inject({
      method: 'POST',
      url: '/api/admin/password',
      headers,
      payload: { currentPassword: created.temporaryPassword, newPassword: personalPassword },
    })
    expect(changed.statusCode).toBe(200)
    expect(String(changed.headers['set-cookie'])).toContain('Max-Age=0')
    expect((await app.inject({ url: '/api/admin/session', headers })).statusCode).toBe(401)
    expect((await signIn('operator.one', created.temporaryPassword)).statusCode).toBe(401)
    const current = await signIn('operator.one')
    expect(current.statusCode).toBe(200)
    expect(current.json().principal.mustChangePassword).toBe(false)
    const session = await db
      .collection('admin_sessions')
      .findOne({ employeeId: created.employee.id })
    expect(session?.tokenHash).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(session)).not.toContain(cookieOf(current).split('=')[1]!)
    const employee = await db.collection('admin_employees').findOne({ login: 'operator.one' })
    const reset = await app.inject({
      method: 'POST',
      url: `/api/admin/employees/${created.employee.id}/reset-password`,
      headers: owner,
      payload: { revision: employee!.revision },
    })
    expect(reset.statusCode).toBe(200)
    expect(
      (await app.inject({ url: '/api/admin/session', headers: { cookie: cookieOf(current) } }))
        .statusCode,
    ).toBe(401)
    await db
      .collection('admin_employees')
      .updateOne(
        { login: 'operator.one' },
        { $set: { temporaryPasswordExpiresAt: new Date(Date.now() - 1) } },
      )
    expect((await signIn('operator.one', reset.json().temporaryPassword)).statusCode).toBe(401)
    const logs = await app.inject({ url: '/api/admin/logs', headers: owner })
    expect(logs.body).not.toContain(reset.json().temporaryPassword)
    expect(logs.body).not.toContain(personalPassword)
    expect(logs.body).not.toContain('passwordHash')
  } finally {
    await app.close()
  }
})

test('no rights means no private data; all employee capabilities still cannot access owner routes or bypass encoded URLs', async () => {
  const { app, owner, activate, db } = await setup()
  try {
    const employee = await activate([])
    await db
      .collection<{ _id: string; phone: string; email: string }>('users')
      .insertOne({ _id: 'customer', phone: '+79991234567', email: 'private@example.invalid' })
    const dashboard = await app.inject({ url: '/api/admin/dashboard', headers: employee.headers })
    expect(dashboard.json()).toMatchObject({ products: [], categories: [], iikoConfigured: false })
    for (const route of [
      'orders',
      'clients',
      'clients/customer',
      'logs',
      'bonus-codes',
      'employees',
      'future-feature',
    ]) {
      for (const method of ['GET', 'HEAD'] as const) {
        const response = await app.inject({
          method,
          url: `/api/%61dmin/${route}`,
          headers: employee.headers,
        })
        expect(response.statusCode, route).toBe(403)
        expect(response.headers['cache-control']).toBe('no-store')
        expect(response.body).not.toContain('private@example.invalid')
      }
    }
    const record = await db.collection('admin_employees').findOne({ login: 'operator.one' })
    const update = await app.inject({
      method: 'PATCH',
      url: `/api/admin/employees/${employee.employee.id}`,
      headers: owner,
      payload: { name: 'Все права', active: true, permissions, revision: record!.revision },
    })
    expect(update.statusCode).toBe(200)
    const signIn = await app.inject({
      method: 'POST',
      url: '/api/admin/login',
      headers: { origin },
      payload: { login: 'operator.one', password: personalPassword },
    })
    const headers = { origin, cookie: cookieOf(signIn) }
    for (const [method, url] of [
      ['GET', 'employees'],
      ['POST', 'employees'],
      ['PATCH', 'employees/victim'],
      ['POST', 'employees/victim/reset-password'],
      ['GET', 'logs'],
      ['POST', 'iiko/sync'],
      ['GET', 'future-feature'],
      ['PUT', 'content'],
      ['DELETE', 'orders'],
      ['POST', 'clients'],
    ] as const) {
      expect(
        (
          await app.inject({
            method,
            url: `/api/%61dmin/${url}`,
            headers,
            payload: ['GET', 'HEAD'].includes(method) ? undefined : {},
          })
        ).statusCode,
        url,
      ).toBe(403)
    }
  } finally {
    await app.close()
  }
})

test.each(permissionGroups)(
  '$id read permits reading but rejects all corresponding writes',
  async (group) => {
    const { app, activate } = await setup()
    try {
      const { headers } = await activate([`${group.id}.read`])
      const reads: Record<string, string> = {
        orders: 'orders',
        clients: 'clients',
        catalog: 'dashboard',
        site: 'dashboard',
        promotions: 'dashboard',
        codes: 'bonus-codes',
        legal: 'dashboard',
      }
      expect((await app.inject({ url: `/api/admin/${reads[group.id]}`, headers })).statusCode).toBe(
        200,
      )
      const writes = [
        ['PATCH', 'orders/victim/stage', { stage: 'preparing' }],
        ['POST', 'categories', { title: 'Не создано' }],
        ['PUT', 'categories/victim', {}],
        ['DELETE', 'categories/victim', undefined],
        ['POST', 'products', {}],
        ['PUT', 'products/victim', {}],
        ['DELETE', 'products/victim', undefined],
        ['POST', 'bonus-codes', {}],
        ['PUT', 'bonus-codes/victim', {}],
        ['DELETE', 'bonus-codes/victim', undefined],
        ['PATCH', 'content', { phone: 'Не изменено' }],
        ['PATCH', 'content', { promotions: [] }],
        ['PATCH', 'content', { legalRevision: 'Не изменено' }],
        ['PUT', 'content', defaultSiteContent],
        ['POST', 'upload', {}],
      ] as const
      for (const [method, route, payload] of writes)
        expect(
          (await app.inject({ method, url: `/api/admin/${route}`, headers, payload })).statusCode,
          `${group.id}: ${route}`,
        ).toBe(403)
    } finally {
      await app.close()
    }
  },
)

test('manage capabilities permit valid scoped writes; mixed content PATCH is atomic and requires every permission', async () => {
  const { app, db, activate } = await setup()
  try {
    const { headers } = await activate([
      'promotions.read',
      'promotions.manage',
      'catalog.read',
      'catalog.manage',
      'orders.read',
      'orders.manage',
    ])
    const dashboard = await app.inject({ url: '/api/admin/dashboard', headers })
    expect(dashboard.json().products.length).toBeGreaterThan(0)
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: '/api/admin/content',
          headers,
          payload: { promotions: [] },
        })
      ).statusCode,
    ).toBe(200)
    const mixed = await app.inject({
      method: 'PATCH',
      url: '/api/admin/content',
      headers,
      payload: { promotions: defaultSiteContent.promotions, phone: 'hacked' },
    })
    expect(mixed.statusCode).toBe(403)
    expect(
      (
        await db
          .collection<{ _id: string; promotions: unknown }>('site_content')
          .findOne({ _id: 'public' })
      )?.promotions,
    ).toEqual([])
    const category = await app.inject({
      method: 'POST',
      url: '/api/admin/categories',
      headers,
      payload: { title: 'Сотрудник', subtitle: '', sortOrder: 5 },
    })
    expect(category.statusCode, category.body).toBe(201)
    await db.collection<{ _id: string; [key: string]: unknown }>('orders').insertOne({
      _id: 'stage-order',
      accountId: 'test',
      fulfillmentStatus: 'new',
      status: 'completed',
      quote: { totalKopecks: 100 },
      createdAt: new Date(),
    })
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: '/api/admin/orders/stage-order/stage',
          headers,
          payload: { stage: 'preparing' },
        })
      ).statusCode,
    ).toBe(200)
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: '/api/admin/orders/stage-order/stage',
          headers,
          payload: { stage: 'preparing' },
        })
      ).statusCode,
    ).toBe(409)
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: '/api/admin/orders/stage-order/stage',
          headers,
          payload: { stage: 'completed' },
        })
      ).statusCode,
    ).toBe(409)
    const audit = await db.collection('admin_audit').findOne({ action: 'order.stage' })
    expect(audit?.actor.role).toBe('employee')
  } finally {
    await app.close()
  }
})

test('editing, blocking, unblocking and resetting revoke all old sessions, and stale revisions cannot overwrite new data', async () => {
  const { app, db, owner, activate, signIn } = await setup()
  try {
    const employee = await activate(['orders.read'])
    const second = await signIn('operator.one')
    const record = await db.collection('admin_employees').findOne({ login: 'operator.one' })
    const payload = {
      name: 'Заблокирован',
      active: false,
      permissions: ['orders.read'],
      revision: record!.revision,
    }
    const update = await app.inject({
      method: 'PATCH',
      url: `/api/admin/employees/${employee.employee.id}`,
      headers: owner,
      payload,
    })
    expect(update.statusCode).toBe(200)
    for (const headers of [employee.headers, { cookie: cookieOf(second) }])
      expect((await app.inject({ url: '/api/admin/session', headers })).statusCode).toBe(401)
    expect((await signIn('operator.one')).statusCode).toBe(401)
    const stale = await app.inject({
      method: 'PATCH',
      url: `/api/admin/employees/${employee.employee.id}`,
      headers: owner,
      payload: { ...payload, active: true },
    })
    expect(stale.statusCode).toBe(409)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/admin/employees/${employee.employee.id}/reset-password`,
          headers: owner,
          payload: { revision: record!.revision },
        })
      ).statusCode,
    ).toBe(409)
    const unblock = await app.inject({
      method: 'PATCH',
      url: `/api/admin/employees/${employee.employee.id}`,
      headers: owner,
      payload: { ...payload, active: true, revision: update.json().employee.revision },
    })
    expect(unblock.statusCode).toBe(200)
    expect(
      (await app.inject({ url: '/api/admin/session', headers: employee.headers })).statusCode,
    ).toBe(401)
    expect((await signIn('operator.one')).statusCode).toBe(200)
    const next = Fastify()
    try {
      await registerAdminRoutes(next, db, [origin], 'owner-password', mongo)
      const login = await signIn('operator.one')
      expect(
        (await next.inject({ url: '/api/admin/session', headers: { cookie: cookieOf(login) } }))
          .statusCode,
      ).toBe(200)
      await app.inject({
        method: 'PATCH',
        url: `/api/admin/employees/${employee.employee.id}`,
        headers: owner,
        payload: {
          name: 'Новые права',
          active: true,
          permissions: [],
          revision: unblock.json().employee.revision,
        },
      })
      expect(
        (await next.inject({ url: '/api/admin/session', headers: { cookie: cookieOf(login) } }))
          .statusCode,
      ).toBe(401)
    } finally {
      await next.close()
    }
  } finally {
    await app.close()
  }
})

test('CSRF, login injection, session expiry, Secure cookie, and parallel employee login attempts are guarded', async () => {
  const { app, db, owner, activate, login } = await setup(true)
  try {
    expect(login.headers['set-cookie']).toContain('HttpOnly')
    expect(login.headers['set-cookie']).toContain('SameSite=Strict')
    expect(login.headers['set-cookie']).toContain('Secure')
    const employee = await activate(['orders.read'])
    expect(
      (
        await app.inject({
          url: '/api/admin/session',
          headers: { cookie: owner.cookie.replace('admin_session=', 'dev_session=') },
        })
      ).statusCode,
    ).toBe(401)
    expect(
      (
        await app.inject({
          url: '/api/admin/session',
          headers: { cookie: `admin_session=${'0'.repeat(64)}` },
        })
      ).statusCode,
    ).toBe(401)
    for (const headers of [
      { cookie: owner.cookie },
      { ...owner, origin: 'https://attacker.invalid' },
    ]) {
      for (const [method, path, payload] of [
        ['POST', 'employees', {}],
        ['PATCH', `employees/${employee.employee.id}`, {}],
        ['POST', 'password', {}],
        ['POST', 'login', { password: 'owner-password' }],
      ] as const)
        expect(
          (await app.inject({ method, url: `/api/admin/${path}`, headers, payload })).statusCode,
        ).toBe(403)
    }
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/admin/login',
          headers: { origin },
          payload: { login: { $ne: '' }, password: 'owner-password' },
        })
      ).statusCode,
    ).toBe(400)
    const attempts = await Promise.all(
      Array.from({ length: 12 }, () =>
        app.inject({
          method: 'POST',
          url: '/api/admin/login',
          remoteAddress: '127.0.0.222',
          headers: { origin },
          payload: { login: 'operator.one', password: 'wrong' },
        }),
      ),
    )
    expect(attempts.filter((result) => result.statusCode === 401)).toHaveLength(5)
    expect(attempts.filter((result) => result.statusCode === 429)).toHaveLength(7)
    await db
      .collection('admin_sessions')
      .updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1) } })
    expect(
      (await app.inject({ url: '/api/admin/session', headers: employee.headers })).statusCode,
    ).toBe(401)
  } finally {
    await app.close()
  }
})

test('concurrent creation at the employee cap reserves only one remaining slot', async () => {
  const { app, db, owner, create } = await setup()
  try {
    await create()
    const template = await db
      .collection<{ _id: string; [key: string]: unknown }>('admin_employees')
      .findOne({ login: 'operator.one' })
    await db.collection<{ _id: string; [key: string]: unknown }>('admin_employees').insertMany(
      Array.from({ length: 498 }, (_, index) => ({
        ...template!,
        _id: randomUUID(),
        login: `filler-${index}`,
      })),
    )
    const result = await Promise.all(
      ['last-one', 'last-two'].map((login) =>
        app.inject({
          method: 'POST',
          url: '/api/admin/employees',
          headers: owner,
          payload: { login, name: 'Последний', active: true, permissions: [] },
        }),
      ),
    )
    expect(result.map((response) => response.statusCode).sort()).toEqual([201, 409])
    expect(await db.collection('admin_employees').countDocuments()).toBe(500)
    expect(
      (await app.inject({ url: '/api/admin/employees', headers: owner })).json().employees,
    ).toHaveLength(500)
  } finally {
    await app.close()
  }
})

test('successful employee authentication cannot erase failed owner password attempts', async () => {
  const { app, activate, signIn } = await setup()
  try {
    await activate()
    for (let attempt = 0; attempt < 4; attempt++) {
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/admin/login',
            headers: { origin },
            payload: { password: 'wrong-owner-password' },
          })
        ).statusCode,
      ).toBe(401)
      expect((await signIn('operator.one')).statusCode).toBe(200)
    }
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/admin/login',
          headers: { origin },
          payload: { password: 'wrong-owner-password' },
        })
      ).statusCode,
    ).toBe(401)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/admin/login',
          headers: { origin },
          payload: { password: 'wrong-owner-password' },
        })
      ).statusCode,
    ).toBe(429)
  } finally {
    await app.close()
  }
})

test.each(['site', 'legal', 'codes'] as const)(
  '%s editors can save their section without gaining other capabilities',
  async (group) => {
    const { app, activate } = await setup()
    try {
      const { headers } = await activate([`${group}.read`, `${group}.manage`])
      const allowedPatch =
        group === 'site' ? { phone: '+7 999 111-22-33' } : { legalRevision: '2026-11-17' }
      if (group === 'codes') {
        const payload = {
          code: 'STAFF10',
          kind: 'percent',
          value: 10,
          active: true,
          startsAt: '2026-11-01T00:00:00Z',
          endsAt: '2027-01-01T00:00:00Z',
        }
        expect(
          (await app.inject({ method: 'POST', url: '/api/admin/bonus-codes', headers, payload }))
            .statusCode,
        ).toBe(201)
        expect(
          (
            await app.inject({
              method: 'PUT',
              url: '/api/admin/bonus-codes/STAFF10',
              headers,
              payload: { ...payload, value: 15 },
            })
          ).statusCode,
        ).toBe(200)
        expect(
          (await app.inject({ method: 'DELETE', url: '/api/admin/bonus-codes/STAFF10', headers }))
            .statusCode,
        ).toBe(204)
      } else
        expect(
          (
            await app.inject({
              method: 'PATCH',
              url: '/api/admin/content',
              headers,
              payload: allowedPatch,
            })
          ).statusCode,
        ).toBe(200)
      const deniedPatch = group === 'site' ? { legalRevision: 'hacked' } : { phone: 'hacked' }
      expect(
        (
          await app.inject({
            method: 'PATCH',
            url: '/api/admin/content',
            headers,
            payload: deniedPatch,
          })
        ).statusCode,
      ).toBe(403)
      expect(
        (await app.inject({ method: 'POST', url: '/api/admin/categories', headers, payload: {} }))
          .statusCode,
      ).toBe(403)
      expect(
        (await app.inject({ method: 'POST', url: '/api/admin/upload', headers, payload: {} }))
          .statusCode,
      ).toBe(group === 'site' ? 400 : 403)
    } finally {
      await app.close()
    }
  },
)

test('client viewing explicitly includes history and saved addresses without access to working orders', async () => {
  const { app, db, activate } = await setup()
  try {
    const { headers } = await activate(['clients.read'])
    await db
      .collection<{ _id: string; phone: string }>('users')
      .insertOne({ _id: 'customer', phone: '+79991234567' })
    await db.collection('addresses').insertOne({ accountId: 'customer', label: 'Дом клиента' })
    await db
      .collection<{ _id: string; accountId: string; createdAt: Date }>('orders')
      .insertOne({ _id: 'history', accountId: 'customer', createdAt: new Date() })
    const card = await app.inject({ url: '/api/admin/clients/customer', headers })
    expect(card.statusCode).toBe(200)
    expect(card.json()).toMatchObject({ addresses: ['Дом клиента'], orders: [{ _id: 'history' }] })
    expect((await app.inject({ url: '/api/admin/orders', headers })).statusCode).toBe(403)
    expect(
      (await app.inject({ url: '/api/admin/clients/does-not-exist', headers })).statusCode,
    ).toBe(404)
  } finally {
    await app.close()
  }
})

test.each(['none', 'site', 'promotions', 'legal'] as const)(
  'dashboard and save responses expose only %s content permissions',
  async (section) => {
    const { app, db, owner, activate } = await setup()
    try {
      const grants: Permission[] =
        section === 'none' ? [] : [`${section}.read`, `${section}.manage`]
      const { headers } = await activate(grants)
      const hidden = {
        ...defaultSiteContent.promotions[0]!,
        id: 'private-draft',
        title: 'Секретная акция',
        enabled: false,
      }
      await db.collection<{ _id: string; [key: string]: unknown }>('site_content').insertOne({
        _id: 'public',
        ...defaultSiteContent,
        contentVersion: 1,
        phone: 'private-contact-setting',
        internalSecret: 'do-not-expose-unknown-content',
        promotions: [hidden],
        legalRevision: 'private-legal-revision',
      })
      const result = await app.inject({ url: '/api/admin/dashboard', headers })
      expect(result.statusCode).toBe(200)
      expect(result.body).not.toContain('do-not-expose-unknown-content')
      const content = result.json().content
      if (section === 'none') expect(content).toEqual({})
      if (section !== 'promotions') expect(result.body).not.toContain('Секретная акция')
      if (section !== 'site') expect(result.body).not.toContain('private-contact-setting')
      if (section !== 'legal') expect(result.body).not.toContain('private-legal-revision')
      const payload =
        section === 'site'
          ? { phone: 'updated-private-contact' }
          : section === 'promotions'
            ? { promotions: [hidden] }
            : section === 'legal'
              ? { legalRevision: 'updated-legal' }
              : {}
      const saved = await app.inject({
        method: 'PATCH',
        url: '/api/admin/content',
        headers,
        payload,
      })
      expect(saved.statusCode).toBe(200)
      expect(Object.keys(saved.json().content).sort()).toEqual(Object.keys(content).sort())
      if (section !== 'promotions') expect(saved.body).not.toContain('Секретная акция')
      const full = await app.inject({ url: '/api/admin/dashboard', headers: owner })
      expect(full.body).toContain('Секретная акция')
      expect(full.json().content.legal).toBeTruthy()
    } finally {
      await app.close()
    }
  },
)

test('order views and stage responses do not expose payment attempts, customer profile fields or future internal fields', async () => {
  const { app, db, owner, activate } = await setup()
  try {
    const { headers } = await activate(['orders.read', 'orders.manage'])
    await db.collection<{ _id: string; [key: string]: unknown }>('users').insertOne({
      _id: 'limited-customer',
      name: 'Покупатель',
      phone: '+79991234567',
      birthday: '1990-01-01',
      email: 'private-profile@example.invalid',
      internalSecret: 'user-internal-secret',
    })
    await db.collection<{ _id: string; [key: string]: unknown }>('orders').insertOne({
      _id: 'limited-order',
      accountId: 'limited-customer',
      createdAt: new Date(),
      status: 'completed',
      fulfillmentStatus: 'new',
      idempotencyKey: 'private-idempotency-key',
      internalSecret: 'order-internal-secret',
      payment: {
        status: 'succeeded',
        attemptKey: 'private-attempt',
        confirmationUrl: 'https://example.invalid/private-payment-url',
        id: 'private-payment-id',
      },
      input: {
        fulfillment: {
          mode: 'delivery',
          label: 'Адрес заказа',
          details: { comment: 'Позвонить', internalSecret: 'address-internal-secret' },
        },
        internalSecret: 'input-internal-secret',
      },
      quote: {
        totalKopecks: 100,
        lines: [
          {
            name: 'Суп',
            quantity: 1,
            lineTotalKopecks: 100,
            internalSecret: 'line-internal-secret',
          },
        ],
        internalSecret: 'quote-internal-secret',
      },
    })
    const listed = await app.inject({ url: '/api/admin/orders', headers })
    const changed = await app.inject({
      method: 'PATCH',
      url: '/api/admin/orders/limited-order/stage',
      headers,
      payload: { stage: 'preparing' },
    })
    for (const response of [listed, changed]) {
      expect(response.statusCode).toBe(200)
      for (const forbidden of ['private-', 'internal-secret', '1990-01-01'])
        expect(response.body).not.toContain(forbidden)
    }
    expect(listed.json().orders[0]).toMatchObject({
      customer: { name: 'Покупатель', phone: '+79991234567' },
      payment: { status: 'succeeded' },
      input: { fulfillment: { details: { comment: 'Позвонить' } } },
      quote: { lines: [{ name: 'Суп' }] },
    })
    expect(changed.json().order.fulfillmentStatus).toBe('preparing')
    // Sanitizing responses never deletes stored fields or alters owner access.
    const ownerView = await app.inject({ url: '/api/admin/orders', headers: owner })
    expect(ownerView.body).toContain('private-attempt')
    expect(
      (await db.collection('orders').findOne({ idempotencyKey: 'private-idempotency-key' }))
        ?.payment.attemptKey,
    ).toBe('private-attempt')
  } finally {
    await app.close()
  }
})

test('client search, filtered search and history use explicit safe field projections', async () => {
  const { app, db, activate } = await setup()
  try {
    const { headers } = await activate(['clients.read'])
    await db.collection<{ _id: string; [key: string]: unknown }>('users').insertOne({
      _id: 'safe-customer',
      name: 'Клиент',
      phone: '+79991234567',
      email: 'allowed@example.invalid',
      birthday: '1990-01-01',
      internalSecret: 'do-not-send-profile',
    })
    await db.collection<{ _id: string; [key: string]: unknown }>('orders').insertOne({
      _id: 'safe-history',
      accountId: 'safe-customer',
      createdAt: new Date(),
      quote: { totalKopecks: 100 },
      payment: { status: 'succeeded', attemptKey: 'do-not-send-payment' },
    })
    for (const path of [
      'clients',
      'clients?filter=ordered',
      'clients?q=allowed&filter=ordered',
      'clients/safe-customer',
    ]) {
      const response = await app.inject({ url: `/api/admin/${path}`, headers })
      expect(response.statusCode).toBe(200)
      expect(response.body).toContain('allowed@example.invalid')
      expect(response.body).not.toContain('do-not-send')
    }
  } finally {
    await app.close()
  }
})

test('a screen bound to the previous administrator cannot read or mutate using a different account cookie', async () => {
  const { app, db, owner, activate } = await setup()
  try {
    const employee = await activate(['orders.read', 'orders.manage'])
    await db.collection<{ _id: string; [key: string]: unknown }>('orders').insertOne({
      _id: 'identity-order',
      accountId: 'customer',
      fulfillmentStatus: 'new',
      quote: { totalKopecks: 100 },
      createdAt: new Date(),
    })
    for (const headers of [
      { ...employee.headers, 'x-admin-account-id': 'owner' },
      { ...owner, 'x-admin-account-id': employee.employee.id },
    ]) {
      const view = await app.inject({ url: '/api/admin/dashboard', headers })
      expect(view.statusCode).toBe(409)
      expect(view.json().error.code).toBe('ADMIN_ACCOUNT_CHANGED')
      expect(view.headers['cache-control']).toBe('no-store')
      expect(
        (
          await app.inject({
            method: 'PATCH',
            url: '/api/admin/orders/identity-order/stage',
            headers,
            payload: { stage: 'preparing' },
          })
        ).statusCode,
      ).toBe(409)
    }
    expect(
      (
        await db
          .collection<{ _id: string; fulfillmentStatus: string }>('orders')
          .findOne({ _id: 'identity-order' })
      )?.fulfillmentStatus,
    ).toBe('new')
    expect(
      (
        await app.inject({
          url: '/api/admin/orders',
          headers: { ...employee.headers, 'x-admin-account-id': employee.employee.id },
        })
      ).statusCode,
    ).toBe(200)
  } finally {
    await app.close()
  }
})

test('blocking an employee during password verification prevents minting an authenticated login response', async () => {
  const { app, activate, signIn } = await setup()
  let spy: ReturnType<typeof vi.spyOn> | undefined
  try {
    await activate(['orders.read'])
    const original = Collection.prototype.findOne
    let revoked = false
    spy = vi.spyOn(Collection.prototype, 'findOne').mockImplementation(async function (
      this: Collection,
      filter: Filter<Document>,
      options?: FindOptions,
    ) {
      const result = (await original.call(this, filter, options ?? {})) as Document | null
      if (
        !revoked &&
        this.collectionName === 'admin_employees' &&
        filter.login === 'operator.one' &&
        result
      ) {
        revoked = true
        await this.updateOne(
          { _id: result._id },
          { $set: { active: false, revision: randomUUID() } },
        )
      }
      return result
    })
    const response = await signIn('operator.one')
    expect(response.statusCode).toBe(409)
    expect(response.headers['set-cookie']).toBeUndefined()
    expect(response.json().principal).toBeUndefined()
  } finally {
    spy?.mockRestore()
    await app.close()
  }
})

test('activity records concrete actions and access events without recording reads or navigation', async () => {
  const { app, db, owner, activate } = await setup()
  try {
    const employee = await activate(['orders.read'])
    await app.inject({ url: '/api/admin/orders?stage=new', headers: employee.headers })
    await app.inject({ url: '/api/admin/clients?q=private-search-token', headers: owner })
    await app.inject({ url: '/api/admin/clients', headers: employee.headers })
    await app.inject({
      method: 'PATCH',
      url: '/api/admin/content',
      headers: owner,
      payload: { phone: '+7 999 000-00-00' },
    })
    await app.inject({
      method: 'POST',
      url: '/api/admin/activity',
      headers: employee.headers,
      payload: { type: 'section.open', section: 'orders' },
    })
    const denied = await app.inject({
      method: 'POST',
      url: '/api/admin/activity',
      headers: employee.headers,
      payload: { type: 'section.open', section: 'logs' },
    })
    expect(denied.statusCode).toBe(403)
    const forged = await app.inject({
      method: 'POST',
      url: '/api/admin/activity',
      headers: employee.headers,
      payload: {
        type: 'section.open',
        section: 'orders',
        actor: { id: 'owner' },
        password: 'do-not-record-this-body',
      },
    })
    expect(forged.statusCode).toBe(400)
    const failedLogin = await app.inject({
      method: 'POST',
      url: '/api/admin/login',
      headers: { origin },
      payload: { password: 'do-not-record-wrong-password' },
    })
    expect(failedLogin.statusCode).toBe(401)
    await app.inject({ method: 'POST', url: '/api/admin/logout', headers: employee.headers })
    const entries = await db.collection('admin_activity').find({}).toArray()
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'auth.login',
          outcome: 'success',
          actor: expect.objectContaining({ id: 'owner', role: 'owner' }),
        }),
        expect.objectContaining({
          action: 'auth.login',
          outcome: 'success',
          actor: expect.objectContaining({ id: employee.employee.id, role: 'employee' }),
        }),
        expect.objectContaining({
          action: 'employee.create',
          resourceId: employee.employee.id,
          actor: expect.objectContaining({ role: 'owner' }),
        }),
        expect.objectContaining({
          action: 'content.save',
          outcome: 'success',
          actor: expect.objectContaining({ role: 'owner' }),
        }),
        expect.objectContaining({ action: 'auth.login', outcome: 'denied', actor: null }),
        expect.objectContaining({
          action: 'auth.logout',
          outcome: 'success',
          actor: expect.objectContaining({ role: 'employee' }),
        }),
      ]),
    )
    expect(
      entries.some((entry) =>
        ['orders.view', 'clients.search', 'section.open', 'employee.open', 'logs.view'].includes(
          entry.action,
        ),
      ),
    ).toBe(false)
    const serialized = JSON.stringify(entries)
    for (const secret of [
      employee.temporaryPassword,
      personalPassword,
      'owner-password',
      'private-search-token',
      'do-not-record-this-body',
      'do-not-record-wrong-password',
      'tokenHash',
      'passwordHash',
      'salt',
      owner.cookie,
    ])
      expect(serialized).not.toContain(secret)
    expect(entries.every((entry) => entry.outcome !== 'pending')).toBe(true)
    expect(
      (await db.collection('admin_audit').findOne({ action: 'content.update' }))?.actor.role,
    ).toBe('owner')
  } finally {
    await app.close()
  }
})

test.each(['password', 'reset', 'expiry', 'missing'] as const)(
  'cached temporary credentials are rejected after %s',
  async (mode) => {
    const { app, db, owner, create, signIn } = await setup()
    try {
      const created = await create()
      const report = (
        type: 'employee.credentials.view' | 'employee.credentials.copy',
        revision = created.employee.revision,
      ) =>
        app.inject({
          method: 'POST',
          url: '/api/admin/activity',
          headers: owner,
          payload: { type, employeeId: created.employee.id, revision },
        })
      expect((await report('employee.credentials.view')).statusCode).toBe(204)
      expect((await report('employee.credentials.copy')).statusCode).toBe(204)
      if (mode === 'password') {
        const initial = await signIn(created.employee.login, created.temporaryPassword)
        const changed = await app.inject({
          method: 'POST',
          url: '/api/admin/password',
          headers: { origin, cookie: cookieOf(initial) },
          payload: { currentPassword: created.temporaryPassword, newPassword: personalPassword },
        })
        expect(changed.statusCode, changed.body).toBe(200)
      } else if (mode === 'reset') {
        const reset = await app.inject({
          method: 'POST',
          url: `/api/admin/employees/${created.employee.id}/reset-password`,
          headers: owner,
          payload: { revision: created.employee.revision },
        })
        expect(reset.statusCode, reset.body).toBe(200)
        expect(
          (await report('employee.credentials.view', reset.json().employee.revision)).statusCode,
        ).toBe(204)
      } else if (mode === 'expiry') {
        await db
          .collection<{ _id: string }>('admin_employees')
          .updateOne(
            { _id: created.employee.id },
            { $set: { temporaryPasswordExpiresAt: new Date(0) } },
          )
      } else
        await db
          .collection<{ _id: string }>('admin_employees')
          .deleteOne({ _id: created.employee.id })
      for (const type of ['employee.credentials.view', 'employee.credentials.copy'] as const) {
        const response = await report(type)
        expect(response.statusCode, response.body).toBe(409)
        expect(response.json().error.code).toBe('EMPLOYEE_CREDENTIALS_CHANGED')
        expect(response.body).not.toContain(created.temporaryPassword)
      }
      const history = await db
        .collection('admin_activity')
        .find({ resourceId: created.employee.id })
        .toArray()
      expect(
        history.filter((entry) => entry.errorCode === 'EMPLOYEE_CREDENTIALS_CHANGED'),
      ).toHaveLength(2)
      expect(JSON.stringify(history)).not.toContain(created.temporaryPassword)
    } finally {
      await app.close()
    }
  },
)

test('employees cannot read the action journal or report owner-only UI actions', async () => {
  const { app, db, activate } = await setup()
  try {
    const employee = await activate(['orders.read'])
    for (const method of ['GET', 'HEAD'] as const)
      expect(
        (await app.inject({ method, url: '/api/%61dmin/activity', headers: employee.headers }))
          .statusCode,
      ).toBe(403)
    const event = await app.inject({
      method: 'POST',
      url: '/api/admin/activity',
      headers: employee.headers,
      payload: {
        type: 'employee.credentials.view',
        employeeId: employee.employee.id,
        revision: employee.employee.revision,
      },
    })
    expect(event.statusCode).toBe(403)
    const saved = await db
      .collection('admin_activity')
      .findOne({ action: 'employee.credentials.view' })
    expect(saved).toMatchObject({
      outcome: 'denied',
      actor: { id: employee.employee.id, role: 'employee' },
    })
  } finally {
    await app.close()
  }
})

test('the full activity history has stable pages, filters and literal name search', async () => {
  const { app, db, owner } = await setup()
  try {
    const timestamp = new Date(Date.now() - 60 * 60 * 1000)
    await db.collection<{ _id: string; [key: string]: unknown }>('admin_activity').insertMany(
      Array.from({ length: 61 }, (_, index) => ({
        _id: randomUUID(),
        at: timestamp,
        completedAt: timestamp,
        actor: { id: 'test-employee', name: 'UniqueAuditAuthor', role: 'employee' },
        action: 'order.accept',
        kind: 'change',
        outcome: 'success',
        method: 'PATCH',
        route: '/api/admin/orders/:id/stage',
        resourceId: `history-${index}`,
        statusCode: 200,
      })),
    )
    const first = await app.inject({
      url: '/api/admin/activity?q=UniqueAuditAuthor&role=employee&kind=change&outcome=success',
      headers: owner,
    })
    expect(first.statusCode).toBe(200)
    expect(first.json().activities).toHaveLength(50)
    const second = await app.inject({
      url: `/api/admin/activity?q=UniqueAuditAuthor&role=employee&kind=change&outcome=success&before=${encodeURIComponent(first.json().nextBefore)}`,
      headers: owner,
    })
    expect(second.json().activities).toHaveLength(11)
    expect(second.json().nextBefore).toBeNull()
    expect(
      new Set([...first.json().activities, ...second.json().activities].map((item) => item._id))
        .size,
    ).toBe(61)
    const noMatch = await app.inject({
      url: '/api/admin/activity?q=.*&role=employee',
      headers: owner,
    })
    expect(noMatch.json().activities).toEqual([])
    expect(
      (await app.inject({ url: '/api/admin/activity?before=invalid', headers: owner })).statusCode,
    ).toBe(400)
    expect(
      (await app.inject({ url: '/api/admin/activity?limit=101', headers: owner })).statusCode,
    ).toBe(400)
    expect(
      (await app.inject({ url: '/api/admin/activity?role=administrator', headers: owner }))
        .statusCode,
    ).toBe(400)
    const beforeRead = await db.collection('admin_activity').countDocuments()
    await app.inject({ url: '/api/admin/activity', headers: owner })
    expect(await db.collection('admin_activity').countDocuments()).toBe(beforeRead)
  } finally {
    await app.close()
  }
})

test('if the activity attempt cannot be recorded, the business handler never runs', async () => {
  const { app, db, owner } = await setup()
  const original = Collection.prototype.insertOne
  const spy = vi.spyOn(Collection.prototype, 'insertOne').mockImplementation(async function (
    this: Collection,
    ...args: Parameters<Collection['insertOne']>
  ) {
    if (this.collectionName === 'admin_activity') throw new Error('private-audit-database-error')
    return original.apply(this, args)
  })
  try {
    const result = await app.inject({
      method: 'POST',
      url: '/api/admin/categories',
      headers: owner,
      payload: { title: 'Must not be created', subtitle: '', sortOrder: 0 },
    })
    expect(result.statusCode).toBe(503)
    expect(result.json().error.code).toBe('AUDIT_UNAVAILABLE')
    expect(result.body).not.toContain('private-audit-database-error')
    expect(
      await db.collection('catalog_categories').countDocuments({ title: 'Must not be created' }),
    ).toBe(0)
  } finally {
    spy.mockRestore()
    await app.close()
  }
})

test('audit finalization failures leave an explicit pending attempt and never return a new login cookie', async () => {
  const { app, db, owner } = await setup()
  const original = Collection.prototype.updateOne
  const spy = vi.spyOn(Collection.prototype, 'updateOne').mockImplementation(async function (
    this: Collection,
    ...args: Parameters<Collection['updateOne']>
  ) {
    if (this.collectionName === 'admin_activity') throw new Error('private-finalization-error')
    return original.apply(this, args)
  })
  try {
    const changed = await app.inject({
      method: 'POST',
      url: '/api/admin/categories',
      headers: owner,
      payload: { title: 'Result must be checked', subtitle: '', sortOrder: 0 },
    })
    expect(changed.statusCode).toBe(503)
    expect(changed.json().error.code).toBe('AUDIT_UNAVAILABLE')
    expect(changed.body).not.toContain('private-finalization-error')
    expect(
      await db.collection('catalog_categories').countDocuments({ title: 'Result must be checked' }),
    ).toBe(1)
    expect(
      await db
        .collection('admin_activity')
        .countDocuments({ action: 'category.create', outcome: 'pending', 'actor.id': 'owner' }),
    ).toBe(1)
    const login = await app.inject({
      method: 'POST',
      url: '/api/admin/login',
      headers: { origin },
      payload: { password: 'owner-password' },
    })
    expect(login.statusCode).toBe(503)
    expect(login.headers['set-cookie']).toBeUndefined()
  } finally {
    spy.mockRestore()
    await app.close()
  }
})

test('slow activity storage cannot create an unbounded database write queue', async () => {
  const { app, owner } = await setup()
  const original = Collection.prototype.insertOne
  let started = 0
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const spy = vi.spyOn(Collection.prototype, 'insertOne').mockImplementation(async function (
    this: Collection,
    ...args: Parameters<Collection['insertOne']>
  ) {
    if (this.collectionName === 'admin_activity') {
      started++
      await gate
    }
    return original.apply(this, args)
  })
  let requests: Promise<unknown>[] = []
  try {
    requests = Array.from({ length: 64 }, () =>
      Promise.resolve(
        app.inject({
          method: 'POST',
          url: '/api/admin/categories',
          headers: owner,
          payload: { title: `Queue item ${randomUUID()}`, subtitle: '', sortOrder: 0 },
        }),
      ),
    )
    await vi.waitFor(() => expect(started).toBe(64), { timeout: 10000 })
    const rejected = await app.inject({
      method: 'POST',
      url: '/api/admin/categories',
      headers: owner,
      payload: { title: 'Overflow item', subtitle: '', sortOrder: 0 },
    })
    expect(rejected.statusCode).toBe(503)
    expect(rejected.json().error.code).toBe('AUDIT_UNAVAILABLE')
    expect(started).toBe(64)
    release()
    const results = (await Promise.all(requests)) as { statusCode: number }[]
    expect(results.every((response) => response.statusCode === 201)).toBe(true)
  } finally {
    release()
    await Promise.allSettled(requests)
    spy.mockRestore()
    await app.close()
  }
})

test('logout still revokes the session when activity storage is unavailable', async () => {
  const { app, owner } = await setup()
  const original = Collection.prototype.insertOne
  const spy = vi.spyOn(Collection.prototype, 'insertOne').mockImplementation(async function (
    this: Collection,
    ...args: Parameters<Collection['insertOne']>
  ) {
    if (this.collectionName === 'admin_activity') throw new Error('audit-outage')
    return original.apply(this, args)
  })
  try {
    const result = await app.inject({ method: 'POST', url: '/api/admin/logout', headers: owner })
    expect(result.statusCode).toBe(200)
    expect(result.headers['set-cookie']).toContain('Max-Age=0')
    expect((await app.inject({ url: '/api/admin/session', headers: owner })).statusCode).toBe(401)
  } finally {
    spy.mockRestore()
    await app.close()
  }
})

test('a delayed logout cannot revoke a new session of the same account', async () => {
  const { app, owner, login } = await setup()
  try {
    const previousId = login.json().sessionId
    const next = await app.inject({
      method: 'POST',
      url: '/api/admin/login',
      headers: owner,
      payload: { password: 'owner-password' },
    })
    expect(next.statusCode).toBe(200)
    expect(typeof next.json().sessionId).toBe('string')
    expect(next.json().sessionId).not.toBe(previousId)
    const current = { origin, cookie: cookieOf(next) }
    const delayed = await app.inject({
      method: 'POST',
      url: '/api/admin/logout',
      headers: { ...current, 'x-admin-account-id': 'owner', 'x-admin-session-id': previousId },
    })
    expect(delayed.statusCode).toBe(409)
    expect(delayed.json().error.code).toBe('ADMIN_SESSION_CHANGED')
    expect(delayed.headers['set-cookie']).toBeUndefined()
    expect((await app.inject({ url: '/api/admin/session', headers: current })).statusCode).toBe(200)
    expect((await app.inject({ url: '/api/admin/session', headers: owner })).statusCode).toBe(401)
  } finally {
    await app.close()
  }
})

test('switching accounts in one browser revokes the previous cookie without affecting other sessions', async () => {
  const { app, owner, activate, login, signIn } = await setup()
  try {
    const employee = await activate(['orders.read'])
    const separate = await signIn('operator.one')
    const switched = await app.inject({
      method: 'POST',
      url: '/api/admin/login',
      headers: owner,
      payload: { login: 'operator.one', password: personalPassword },
    })
    expect(switched.statusCode).toBe(200)
    expect((await app.inject({ url: '/api/admin/session', headers: owner })).statusCode).toBe(401)
    for (const headers of [
      employee.headers,
      { cookie: cookieOf(separate) },
      { cookie: cookieOf(switched) },
    ])
      expect((await app.inject({ url: '/api/admin/session', headers })).statusCode).toBe(200)
    const mismatch = await app.inject({
      method: 'POST',
      url: '/api/admin/logout',
      headers: {
        origin,
        cookie: cookieOf(switched),
        'x-admin-account-id': 'owner',
        'x-admin-session-id': login.json().sessionId,
      },
    })
    expect(mismatch.statusCode).toBe(409)
    expect(
      (await app.inject({ url: '/api/admin/session', headers: { cookie: cookieOf(switched) } }))
        .statusCode,
    ).toBe(200)
  } finally {
    await app.close()
  }
})

test('existing sessions without an explicit public marker stay compatible across server instances', async () => {
  const { app, db, owner } = await setup()
  const next = Fastify()
  try {
    await db.collection('admin_sessions').updateMany({}, { $unset: { sessionId: '' } })
    const legacy = await app.inject({ url: '/api/admin/session', headers: owner })
    expect(legacy.statusCode).toBe(200)
    expect(legacy.json().sessionId).toMatch(/^[a-f0-9]{64}$/)
    await registerAdminRoutes(next, db, [origin], 'owner-password', mongo)
    const restarted = await next.inject({ url: '/api/admin/session', headers: owner })
    expect(restarted.json().sessionId).toBe(legacy.json().sessionId)
    const headers = { ...owner, 'x-admin-session-id': legacy.json().sessionId }
    expect((await next.inject({ url: '/api/admin/dashboard', headers })).statusCode).toBe(200)
    expect(
      (
        await next.inject({
          url: '/api/admin/session',
          headers: { cookie: `admin_session=${legacy.json().sessionId}` },
        })
      ).statusCode,
    ).toBe(401)
  } finally {
    await next.close()
    await app.close()
  }
})

test('an invalid login never revokes the browser’s existing valid session', async () => {
  const { app, owner } = await setup()
  try {
    for (const payload of [
      { password: 'wrong-password' },
      { login: 'missing-employee', password: 'wrong-password' },
    ]) {
      expect(
        (await app.inject({ method: 'POST', url: '/api/admin/login', headers: owner, payload }))
          .statusCode,
      ).toBe(401)
      expect((await app.inject({ url: '/api/admin/session', headers: owner })).statusCode).toBe(200)
    }
  } finally {
    await app.close()
  }
})

test('a missing audit attempt is treated as an unconfirmed outcome, not a recorded success', async () => {
  const { app, owner } = await setup()
  const original = Collection.prototype.updateOne
  const spy = vi.spyOn(Collection.prototype, 'updateOne').mockImplementation(async function (
    this: Collection,
    ...args: Parameters<Collection['updateOne']>
  ) {
    if (this.collectionName === 'admin_activity')
      return {
        acknowledged: true,
        matchedCount: 0,
        modifiedCount: 0,
        upsertedCount: 0,
        upsertedId: null,
      }
    return original.apply(this, args)
  })
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/categories',
      headers: owner,
      payload: { title: 'Unconfirmed outcome', subtitle: '', sortOrder: 0 },
    })
    expect(response.statusCode).toBe(503)
    expect(response.json().error.code).toBe('AUDIT_UNAVAILABLE')
    const login = await app.inject({
      method: 'POST',
      url: '/api/admin/login',
      headers: { origin },
      payload: { password: 'owner-password' },
    })
    expect(login.statusCode).toBe(503)
    expect(login.headers['set-cookie']).toBeUndefined()
  } finally {
    spy.mockRestore()
    await app.close()
  }
})

test('new methods on known paths are audited as generic changes rather than fabricated reads', async () => {
  const { app, db, owner } = await setup()
  try {
    expect(
      (await app.inject({ method: 'DELETE', url: '/api/admin/orders', headers: owner })).statusCode,
    ).toBe(200)
    expect(
      (await app.inject({ method: 'POST', url: '/api/admin/clients', headers: owner, payload: {} }))
        .statusCode,
    ).toBe(200)
    for (const [method, route] of [
      ['DELETE', '/api/admin/orders'],
      ['POST', '/api/admin/clients'],
    ]) {
      expect(await db.collection('admin_activity').findOne({ method, route })).toMatchObject({
        action: 'admin.request',
        kind: 'change',
        outcome: 'success',
      })
    }
  } finally {
    await app.close()
  }
})

test('temporary-password responses include their real expiration without exposing it in employee lists', async () => {
  const { app, db, owner, create } = await setup()
  try {
    const created = await create([])
    const stored = await db.collection('admin_employees').findOne({ login: created.employee.login })
    expect(created.temporaryPasswordExpiresAt).toBe(
      stored!.temporaryPasswordExpiresAt.toISOString(),
    )
    const reset = await app.inject({
      method: 'POST',
      url: `/api/admin/employees/${created.employee.id}/reset-password`,
      headers: owner,
      payload: { revision: created.employee.revision },
    })
    expect(reset.statusCode).toBe(200)
    expect(new Date(reset.json().temporaryPasswordExpiresAt).getTime()).toBeGreaterThanOrEqual(
      stored!.temporaryPasswordExpiresAt.getTime(),
    )
    const after = await db.collection('admin_employees').findOne({ login: created.employee.login })
    expect(reset.json().temporaryPasswordExpiresAt).toBe(
      after!.temporaryPasswordExpiresAt.toISOString(),
    )
    expect((await app.inject({ url: '/api/admin/employees', headers: owner })).body).not.toContain(
      'temporaryPasswordExpiresAt',
    )
  } finally {
    await app.close()
  }
})

test('an unacknowledged audit write never authorizes the business handler', async () => {
  const { app, db, owner } = await setup()
  const original = Collection.prototype.insertOne
  const spy = vi.spyOn(Collection.prototype, 'insertOne').mockImplementation(async function (
    this: Collection,
    ...args: Parameters<Collection['insertOne']>
  ) {
    if (this.collectionName === 'admin_activity')
      return { acknowledged: false, insertedId: args[0]._id! }
    return original.apply(this, args)
  })
  try {
    const result = await app.inject({
      method: 'POST',
      url: '/api/admin/categories',
      headers: owner,
      payload: { title: 'Unconfirmed writes must not pass', subtitle: '', sortOrder: 0 },
    })
    expect(result.statusCode).toBe(503)
    expect(result.json().error.code).toBe('AUDIT_UNAVAILABLE')
    expect(
      await db
        .collection('catalog_categories')
        .countDocuments({ title: 'Unconfirmed writes must not pass' }),
    ).toBe(0)
  } finally {
    spy.mockRestore()
    await app.close()
  }
})

test('navigation, form preparation and automatic reads do not grow the journal', async () => {
  const { app, db, owner } = await setup()
  try {
    const before = await db.collection('admin_activity').countDocuments()
    for (let attempt = 0; attempt < 3; attempt++) {
      for (const url of [
        '/api/admin/dashboard',
        '/api/admin/orders?stage=new',
        '/api/admin/clients?q=typed-text',
        '/api/admin/employees',
        '/api/admin/logs',
        '/api/admin/activity',
      ]) {
        expect((await app.inject({ url, headers: owner })).statusCode).toBe(200)
      }
      for (const payload of [
        { type: 'section.open', section: 'orders' },
        { type: 'employee.open', employeeId: randomUUID() },
      ]) {
        expect(
          (
            await app.inject({
              method: 'POST',
              url: '/api/admin/activity',
              headers: owner,
              payload,
            })
          ).statusCode,
        ).toBe(204)
      }
    }
    expect(await db.collection('admin_activity').countDocuments()).toBe(before)
  } finally {
    await app.close()
  }
})

test('order stage changes identify acceptance, delivery and completion', async () => {
  const { app, db, owner } = await setup()
  try {
    await db.collection<{ _id: string; [key: string]: unknown }>('orders').insertOne({
      _id: 'named-stage-order',
      accountId: 'test',
      fulfillmentStatus: 'new',
      status: 'completed',
      quote: { totalKopecks: 100 },
      createdAt: new Date(),
    })
    for (const stage of ['preparing', 'delivering', 'completed']) {
      expect(
        (
          await app.inject({
            method: 'PATCH',
            url: '/api/admin/orders/named-stage-order/stage',
            headers: owner,
            payload: { stage },
          })
        ).statusCode,
      ).toBe(200)
    }
    const events = await db
      .collection('admin_activity')
      .find({ resourceId: 'named-stage-order' })
      .sort({ at: 1 })
      .toArray()
    expect(events.map((event) => event.action)).toEqual([
      'order.accept',
      'order.deliver',
      'order.complete',
    ])
    expect(events.every((event) => event.outcome === 'success' && event.actor.id === 'owner')).toBe(
      true,
    )
  } finally {
    await app.close()
  }
})

test('all administrative logs expire after 90 days without deleting orders', async () => {
  const { app, db, owner } = await setup()
  try {
    const day = 24 * 60 * 60 * 1000
    const recent = new Date(Date.now() - 89 * day)
    const expired = new Date(Date.now() - 91 * day)
    for (const name of ['admin_activity', 'admin_audit', 'payment_events']) {
      // Retention coexists with existing date-sort indexes.
      await db.collection(name).createIndex({ at: -1 })
      const ttl = (await db.collection(name).listIndexes().toArray()).find(
        (index) => index.name === 'logs_retention',
      )
      expect(ttl).toMatchObject({ key: { at: 1 }, expireAfterSeconds: 90 * 24 * 60 * 60 })
    }
    for (const [prefix, at] of [
      ['recent', recent],
      ['expired', expired],
    ] as const) {
      await db.collection<{ _id: string; [key: string]: unknown }>('admin_activity').insertOne({
        _id: `${prefix}-action`,
        at,
        actor: { id: 'owner', name: 'Владелец', role: 'owner' },
        action: 'employee.create',
        kind: 'change',
        method: 'POST',
        route: '/api/admin/employees',
        outcome: 'success',
      })
      await db
        .collection<{ _id: string; [key: string]: unknown }>('admin_audit')
        .insertOne({ _id: `${prefix}-audit`, at, action: 'product.update' })
      await db.collection<{ _id: string; [key: string]: unknown }>('payment_events').insertOne({
        _id: `${prefix}-payment`,
        at,
        orderId: `${prefix}-order`,
        status: 'succeeded',
      })
      await db.collection<{ _id: string; [key: string]: unknown }>('orders').insertOne({
        _id: `${prefix}-legacy-order`,
        quote: { totalKopecks: 100 },
        payment: { status: 'succeeded', updatedAt: at },
      })
    }
    await db.collection<{ _id: string; [key: string]: unknown }>('admin_activity').insertOne({
      _id: 'old-navigation',
      at: recent,
      action: 'section.open',
      kind: 'navigation',
      method: 'POST',
    })
    const journal = (await app.inject({ url: '/api/admin/activity', headers: owner })).json()
    expect(journal.activities.some((entry: { _id: string }) => entry._id === 'recent-action')).toBe(
      true,
    )
    expect(
      journal.activities.some((entry: { _id: string }) =>
        ['expired-action', 'old-navigation'].includes(entry._id),
      ),
    ).toBe(false)
    const logs = (await app.inject({ url: '/api/admin/logs', headers: owner })).json()
    expect(logs.changes.map((entry: { _id: string }) => entry._id)).toEqual(['recent-audit'])
    expect(logs.payments.map((entry: { _id: string }) => entry._id).sort()).toEqual([
      'legacy-recent-legacy-order',
      'recent-payment',
    ])
    expect(
      await db
        .collection<{ _id: string }>('orders')
        .countDocuments({ _id: 'expired-legacy-order' }),
    ).toBe(1)
  } finally {
    await app.close()
  }
})

test('retention includes the exact 90-day boundary on every activity page', async () => {
  const { app, db, owner } = await setup()
  // Keep the test boundary newer than MongoDB's real TTL clock while fixing the API clock.
  const fixedNow = Date.now() + 5 * 60_000
  const cutoff = fixedNow - 90 * 24 * 60 * 60 * 1000
  let clock: ReturnType<typeof vi.spyOn> | undefined
  try {
    await db.collection<{ _id: string; [key: string]: unknown }>('admin_activity').insertMany(
      [-1, 0, 1].map((offset) => ({
        _id: `boundary-${offset}`,
        at: new Date(cutoff + offset),
        actor: { id: 'boundary-actor', name: 'RetentionBoundaryAuthor', role: 'employee' },
        action: 'order.accept',
        kind: 'change',
        method: 'PATCH',
        route: '/api/admin/orders/:id/stage',
        outcome: 'success',
      })),
    )
    clock = vi.spyOn(Date, 'now').mockReturnValue(fixedNow)
    const first = await app.inject({
      url: '/api/admin/activity?q=RetentionBoundaryAuthor&limit=1',
      headers: owner,
    })
    expect(first.statusCode).toBe(200)
    expect(first.json().activities.map((entry: { _id: string }) => entry._id)).toEqual([
      'boundary-1',
    ])
    const next = await app.inject({
      url: `/api/admin/activity?q=RetentionBoundaryAuthor&limit=1&before=${encodeURIComponent(first.json().nextBefore)}`,
      headers: owner,
    })
    expect(next.json().activities.map((entry: { _id: string }) => entry._id)).toEqual([
      'boundary-0',
    ])
    expect(next.json().nextBefore).toBeNull()
  } finally {
    clock?.mockRestore()
    await app.close()
  }
})

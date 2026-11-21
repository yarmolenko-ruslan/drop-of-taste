import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type { Db, MongoClient } from 'mongodb'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  can,
  contentPermissionGroup,
  permissions,
  type AdminPrincipal,
  type Permission,
} from '../../../shared/admin-access.ts'
import { registerAdminActivity, noteActivityTarget } from './activity.ts'
import { createOriginChecker } from '../../http/origins.ts'
import {
  deriveAdminPassword,
  isAdminCredentialCurrent,
  loadAdminCredentials,
} from './credentials.ts'

declare module 'fastify' {
  interface FastifyRequest {
    adminPrincipal: AdminPrincipal | null
    adminSessionId: string | null
  }
}
type EmployeeDoc = {
  _id: string
  login: string
  name: string
  active: boolean
  permissions: Permission[]
  revision: string
  salt: string
  passwordHash: string
  mustChangePassword: boolean
  temporaryPasswordExpiresAt?: Date
  createdAt: Date
  updatedAt: Date
}
type SessionDoc = {
  sessionId?: string
  tokenHash: string
  expiresAt: Date
  credentialVersion?: string
  employeeId?: string
  employeeRevision?: string
}
const error = (code: string, message: string) => ({ error: { code, message } })
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const tokenOf = (request: FastifyRequest) =>
  /(?:^|;\s*)admin_session=([a-f0-9]{64})(?:;|$)/.exec(request.headers.cookie ?? '')?.[1]
const permissionSchema = z
  .array(z.enum(permissions as [Permission, ...Permission[]]))
  .max(permissions.length)
  .refine(
    (items) =>
      new Set(items).size === items.length &&
      items.every(
        (item) =>
          !item.endsWith('.manage') ||
          items.includes(item.replace('.manage', '.read') as Permission),
      ),
  )
const fields = {
  name: z.string().trim().min(1).max(100),
  permissions: permissionSchema,
  active: z.boolean(),
}
const revisionSchema = z.string().uuid()
const publicEmployee = (employee: EmployeeDoc) => ({
  id: employee._id,
  login: employee.login,
  name: employee.name,
  active: employee.active,
  permissions: employee.permissions,
  mustChangePassword: employee.mustChangePassword,
  revision: employee.revision,
  createdAt: employee.createdAt,
  updatedAt: employee.updatedAt,
})
function requiredPermission(route: string, method: string): Permission | 'owner' | null {
  const key = `${method === 'HEAD' ? 'GET' : method} ${route}`
  if (
    [
      'GET /api/admin/session',
      'POST /api/admin/logout',
      'POST /api/admin/password',
      'GET /api/admin/dashboard',
      'PATCH /api/admin/content',
      'POST /api/admin/upload',
      'POST /api/admin/activity',
    ].includes(key)
  )
    return null
  if (key === 'GET /api/admin/orders') return 'orders.read'
  if (key === 'PATCH /api/admin/orders/:id/stage') return 'orders.manage'
  if (['GET /api/admin/clients', 'GET /api/admin/clients/:id'].includes(key)) return 'clients.read'
  if (
    /^(POST \/api\/admin\/(products|categories)|(PUT|DELETE) \/api\/admin\/(products|categories)\/:id)$/.test(
      key,
    )
  )
    return 'catalog.manage'
  if (key === 'GET /api/admin/bonus-codes') return 'codes.read'
  if (
    [
      'POST /api/admin/bonus-codes',
      'PUT /api/admin/bonus-codes/:code',
      'DELETE /api/admin/bonus-codes/:code',
    ].includes(key)
  )
    return 'codes.manage'
  // Unknown route + method pairs, including new methods on known paths, fail closed.
  return 'owner'
}
export async function registerAdminAccess(
  app: FastifyInstance,
  db: Db,
  origins: readonly string[],
  password: string,
  mongo: MongoClient,
) {
  const credentials = await loadAdminCredentials(db, password)
  const employees = db.collection<EmployeeDoc>('admin_employees')
  const sessions = db.collection<SessionDoc>('admin_sessions')
  await employees.createIndex({ login: 1 }, { unique: true })
  await sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
  await sessions.createIndex({ tokenHash: 1 }, { unique: true })
  await sessions.createIndex({ employeeId: 1 })
  const originAllowed = createOriginChecker(origins)
  const secure = origins.some((origin) => new URL(origin).protocol === 'https:')
  const cookie = (token: string, maxAge: number) =>
    `admin_session=${token}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`
  const attempts = new Map<string, { count: number; until: number }>()
  let hashing = 0
  const reserve = (request: FastifyRequest) => {
    const now = Date.now()
    for (const [key, entry] of attempts) if (entry.until <= now) attempts.delete(key)
    const key = request.ip
    const previous = attempts.get(key)
    if (previous && previous.count >= 5) return 429
    if (hashing >= 8 || (!previous && attempts.size >= 1024)) return 503
    attempts.set(key, {
      count: (previous?.count ?? 0) + 1,
      until: previous?.until ?? now + 15 * 60_000,
    })
    return 0
  }
  // Successful credentials release only their own reserved attempt, never erase
  // failures accumulated against other identities from the same IP.
  const releaseSuccessfulAttempt = (request: FastifyRequest) => {
    const entry = attempts.get(request.ip)
    if (!entry) return
    if (entry.count <= 1) attempts.delete(request.ip)
    else entry.count--
  }
  const verify = async (value: string, salt: Buffer) => {
    hashing++
    try {
      return await deriveAdminPassword(value, salt)
    } finally {
      hashing--
    }
  }
  const audit = async (
    request: FastifyRequest,
    action: string,
    id: string,
    before: unknown,
    after: unknown,
  ) => {
    noteActivityTarget(request, id)
    await db.collection('admin_audit').insertOne({
      action,
      id,
      actor: request.adminPrincipal,
      changes: [{ field: 'employee', before, after }],
      at: new Date(),
    })
  }
  const temporaryCredential = async () => {
    const temporaryPassword = randomBytes(18).toString('base64url')
    const salt = randomBytes(32)
    const passwordHash = await verify(temporaryPassword, salt)
    return {
      temporaryPassword,
      salt: salt.toString('hex'),
      passwordHash: passwordHash.toString('hex'),
    }
  }
  app.decorateRequest('adminPrincipal', null)
  app.decorateRequest('adminSessionId', null)
  app.addHook('onRequest', async (request, reply) => {
    const route = request.routeOptions.url
    if (!route?.startsWith('/api/admin/')) return
    reply.header('Cache-Control', 'no-store')
    if (!['GET', 'HEAD'].includes(request.method) && !originAllowed(request.headers.origin))
      return reply.code(403).send(error('INVALID_ORIGIN', 'Запрос отклонён'))
    if (route === '/api/admin/login') return
    const token = tokenOf(request)
    const session = token
      ? await sessions.findOne({ tokenHash: hash(token), expiresAt: { $gt: new Date() } })
      : null
    if (session?.employeeId) {
      const employee = await employees.findOne({
        _id: session.employeeId,
        revision: session.employeeRevision,
        active: true,
      })
      if (
        employee &&
        (!employee.mustChangePassword ||
          (employee.temporaryPasswordExpiresAt && employee.temporaryPasswordExpiresAt > new Date()))
      ) {
        request.adminPrincipal = {
          id: employee._id,
          name: employee.name,
          role: 'employee',
          permissions: employee.permissions,
          mustChangePassword: employee.mustChangePassword,
        }
      }
    } else if (
      session?.credentialVersion === credentials.version &&
      (await isAdminCredentialCurrent(db, credentials.version))
    ) {
      request.adminPrincipal = {
        id: 'owner',
        name: 'Владелец',
        role: 'owner',
        permissions: [...permissions],
        mustChangePassword: false,
      }
    }
    if (!request.adminPrincipal)
      return reply.code(401).send(error('ADMIN_UNAUTHORIZED', 'Войдите в панель администратора'))
    // Legacy sessions receive a stable, non-authenticating opaque marker too.
    request.adminSessionId = session!.sessionId ?? hash(`admin-session-id:${session!.tokenHash}`)
    const expectedAccount = request.headers['x-admin-account-id']
    if (expectedAccount !== undefined && expectedAccount !== request.adminPrincipal.id)
      return reply
        .code(409)
        .send(error('ADMIN_ACCOUNT_CHANGED', 'Учётная запись изменилась. Войдите заново'))
    const expectedSession = request.headers['x-admin-session-id']
    if (expectedSession !== undefined && expectedSession !== request.adminSessionId)
      return reply
        .code(409)
        .send(error('ADMIN_SESSION_CHANGED', 'Сессия изменилась. Войдите заново'))
    if (
      request.adminPrincipal.mustChangePassword &&
      !['/api/admin/session', '/api/admin/logout', '/api/admin/password'].includes(route)
    )
      return reply
        .code(403)
        .send(error('PASSWORD_CHANGE_REQUIRED', 'Сначала замените временный пароль'))
    const permission = requiredPermission(route, request.method)
    const denied =
      permission === 'owner'
        ? request.adminPrincipal.role !== 'owner'
        : permission && !can(request.adminPrincipal, permission)
    if (denied)
      return reply.code(403).send(error('ADMIN_FORBIDDEN', 'Недостаточно прав для этого действия'))
    if (
      route === '/api/admin/upload' &&
      !['catalog.manage', 'site.manage', 'promotions.manage'].some((item) =>
        can(request.adminPrincipal, item as Permission),
      )
    )
      return reply.code(403).send(error('ADMIN_FORBIDDEN', 'Нет права загрузки изображений'))
  })
  // Runs before handlers but after the body parser. Mixed PATCHes are rejected atomically.
  app.addHook('preHandler', async (request, reply) => {
    if (
      request.routeOptions.url !== '/api/admin/content' ||
      request.method !== 'PATCH' ||
      request.adminPrincipal?.role === 'owner'
    )
      return
    if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) return
    for (const key of Object.keys(request.body)) {
      const permission: Permission = `${contentPermissionGroup(key)}.manage`
      if (!can(request.adminPrincipal, permission))
        return reply.code(403).send(error('ADMIN_FORBIDDEN', 'Нет права изменять одно из полей'))
    }
  })
  await registerAdminActivity(app, db)
  app.post('/api/admin/login', async (request, reply) => {
    const parsed = z
      .object({
        password: z.string().min(1).max(1024),
        login: z.string().trim().min(3).max(64).optional(),
      })
      .strict()
      .safeParse(request.body)
    if (!parsed.success)
      return reply.code(400).send(error('INVALID_BODY', 'Введите реквизиты входа'))
    const limited = reserve(request)
    if (limited)
      return reply
        .header('Retry-After', limited === 429 ? '900' : '1')
        .code(limited)
        .send(
          error(
            limited === 429 ? 'RATE_LIMITED' : 'ADMIN_LOGIN_BUSY',
            'Слишком много попыток. Повторите позже',
          ),
        )
    // Reserve hashing capacity before any awaited DB access.
    hashing++
    let employee: EmployeeDoc | null = null
    let valid = false
    try {
      if (parsed.data.login)
        employee = await employees.findOne({ login: parsed.data.login.toLowerCase() })
      const salt = employee ? Buffer.from(employee.salt, 'hex') : credentials.salt
      const candidate = await deriveAdminPassword(parsed.data.password, salt)
      const expected = employee
        ? Buffer.from(employee.passwordHash, 'hex')
        : credentials.passwordHash
      valid = timingSafeEqual(candidate, expected)
    } finally {
      hashing--
    }
    if (
      parsed.data.login &&
      (!employee?.active ||
        (employee.mustChangePassword &&
          (!employee.temporaryPasswordExpiresAt ||
            employee.temporaryPasswordExpiresAt <= new Date())))
    )
      valid = false
    if (!valid) return reply.code(401).send(error('INVALID_PASSWORD', 'Неверные реквизиты входа'))
    if (!parsed.data.login && !(await isAdminCredentialCurrent(db, credentials.version)))
      return reply
        .code(409)
        .send(error('ADMIN_CREDENTIALS_CHANGED', 'Настройки входа изменились. Повторите позже'))
    if (
      employee &&
      !(await employees.findOne(
        {
          _id: employee._id,
          revision: employee.revision,
          active: true,
          ...(employee.mustChangePassword
            ? { temporaryPasswordExpiresAt: { $gt: new Date() } }
            : {}),
        },
        { projection: { _id: 1 } },
      ))
    )
      return reply
        .code(409)
        .send(error('ADMIN_CREDENTIALS_CHANGED', 'Настройки входа изменились. Повторите позже'))
    releaseSuccessfulAttempt(request)
    const token = randomBytes(32).toString('hex')
    const sessionId = randomUUID()
    await sessions.insertOne({
      sessionId,
      tokenHash: hash(token),
      expiresAt: new Date(Date.now() + 12 * 60 * 60_000),
      ...(employee
        ? { employeeId: employee._id, employeeRevision: employee.revision }
        : { credentialVersion: credentials.version }),
    })
    const previousToken = tokenOf(request)
    if (previousToken) await sessions.deleteOne({ tokenHash: hash(previousToken) })
    request.adminSessionId = sessionId
    reply.header('Set-Cookie', cookie(token, 43200))
    request.adminPrincipal = employee
      ? {
          id: employee._id,
          name: employee.name,
          role: 'employee',
          permissions: employee.permissions,
          mustChangePassword: employee.mustChangePassword,
        }
      : {
          id: 'owner',
          name: 'Владелец',
          role: 'owner',
          permissions: [...permissions],
          mustChangePassword: false,
        }
    return {
      authenticated: true,
      principal: request.adminPrincipal,
      sessionId: request.adminSessionId,
    }
  })
  app.get('/api/admin/session', async (request) => ({
    authenticated: true,
    principal: request.adminPrincipal,
    sessionId: request.adminSessionId,
  }))
  app.post('/api/admin/logout', async (request, reply) => {
    const token = tokenOf(request)
    if (token) await sessions.deleteOne({ tokenHash: hash(token) })
    reply.header('Set-Cookie', cookie('', 0))
    return { authenticated: false }
  })
  app.get('/api/admin/employees', async () => ({
    employees: (
      await employees
        .find({}, { projection: { salt: 0, passwordHash: 0, temporaryPasswordExpiresAt: 0 } })
        .sort({ createdAt: -1 })
        .limit(500)
        .toArray()
    ).map(publicEmployee),
  }))
  app.post('/api/admin/employees', async (request, reply) => {
    const parsed = z
      .object({
        ...fields,
        login: z
          .string()
          .trim()
          .toLowerCase()
          .min(3)
          .max(64)
          .regex(/^[a-z0-9][a-z0-9._-]*$/)
          .refine((value) => value !== 'owner'),
      })
      .strict()
      .safeParse(request.body)
    if (!parsed.success)
      return reply.code(400).send(error('INVALID_BODY', 'Проверьте имя, логин и права'))
    if (hashing >= 8) return reply.code(503).send(error('ADMIN_LOGIN_BUSY', 'Повторите позже'))
    const secret = await temporaryCredential()
    const now = new Date()
    const employee: EmployeeDoc = {
      _id: randomUUID(),
      ...parsed.data,
      salt: secret.salt,
      passwordHash: secret.passwordHash,
      revision: randomUUID(),
      mustChangePassword: true,
      temporaryPasswordExpiresAt: new Date(Date.now() + 48 * 60 * 60_000),
      createdAt: now,
      updatedAt: now,
    }
    try {
      const created = await mongo.withSession((session) =>
        session.withTransaction(async () => {
          await db
            .collection<{ _id: string; revision: number }>('admin_employee_limits')
            .updateOne({ _id: 'employees' }, { $inc: { revision: 1 } }, { upsert: true, session })
          if ((await employees.countDocuments({}, { session })) >= 500) return false
          await employees.insertOne(employee, { session })
          return true
        }),
      )
      if (!created)
        return reply.code(409).send(error('EMPLOYEE_LIMIT', 'Достигнут лимит 500 сотрудников'))
    } catch (failure) {
      if ((failure as { code?: number }).code === 11000)
        return reply.code(409).send(error('LOGIN_EXISTS', 'Этот логин уже занят'))
      throw failure
    }
    await audit(request, 'employee.create', employee._id, null, publicEmployee(employee))
    return reply.code(201).send({
      employee: publicEmployee(employee),
      temporaryPassword: secret.temporaryPassword,
      temporaryPasswordExpiresAt: employee.temporaryPasswordExpiresAt,
    })
  })
  app.patch('/api/admin/employees/:id', async (request, reply) => {
    const parsed = z
      .object({ ...fields, revision: revisionSchema })
      .strict()
      .safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(error('INVALID_BODY', 'Проверьте имя и права'))
    const id = (request.params as { id: string }).id
    const { revision, ...data } = parsed.data
    const nextFields = { ...data, revision: randomUUID(), updatedAt: new Date() }
    const before = await employees.findOneAndUpdate(
      { _id: id, revision },
      { $set: nextFields },
      { returnDocument: 'before' },
    )
    if (!before)
      return reply
        .code(409)
        .send(error('EMPLOYEE_CHANGED', 'Запись изменилась. Выберите сотрудника заново'))
    await sessions.deleteMany({ employeeId: id, employeeRevision: revision })
    const after = { ...before, ...nextFields }
    await audit(request, 'employee.update', id, publicEmployee(before), publicEmployee(after))
    return { employee: publicEmployee(after) }
  })
  app.post('/api/admin/employees/:id/reset-password', async (request, reply) => {
    const parsed = z.object({ revision: revisionSchema }).strict().safeParse(request.body)
    if (!parsed.success)
      return reply.code(400).send(error('INVALID_BODY', 'Обновите карточку сотрудника'))
    if (hashing >= 8) return reply.code(503).send(error('ADMIN_LOGIN_BUSY', 'Повторите позже'))
    const id = (request.params as { id: string }).id
    const secret = await temporaryCredential()
    const updated = await employees.findOneAndUpdate(
      { _id: id, revision: parsed.data.revision },
      {
        $set: {
          salt: secret.salt,
          passwordHash: secret.passwordHash,
          mustChangePassword: true,
          temporaryPasswordExpiresAt: new Date(Date.now() + 48 * 60 * 60_000),
          revision: randomUUID(),
          updatedAt: new Date(),
        },
      },
      { returnDocument: 'after' },
    )
    if (!updated)
      return reply
        .code(409)
        .send(error('EMPLOYEE_CHANGED', 'Запись изменилась. Выберите сотрудника заново'))
    await sessions.deleteMany({ employeeId: id, employeeRevision: parsed.data.revision })
    await audit(request, 'employee.password_reset', id, null, { passwordReset: true })
    return {
      employee: publicEmployee(updated),
      temporaryPassword: secret.temporaryPassword,
      temporaryPasswordExpiresAt: updated.temporaryPasswordExpiresAt,
    }
  })
  app.post('/api/admin/password', async (request, reply) => {
    if (request.adminPrincipal?.role !== 'employee')
      return reply.code(403).send(error('ADMIN_FORBIDDEN', 'Действие доступно сотруднику'))
    const parsed = z
      .object({
        currentPassword: z.string().min(1).max(1024),
        newPassword: z.string().min(12).max(128),
      })
      .strict()
      .refine((data) => data.currentPassword !== data.newPassword)
      .safeParse(request.body)
    if (!parsed.success)
      return reply
        .code(400)
        .send(error('INVALID_BODY', 'Новый пароль: 12–128 символов, отличается от текущего'))
    const limited = reserve(request)
    if (limited)
      return reply
        .code(limited)
        .send(error('RATE_LIMITED', 'Слишком много попыток. Повторите позже'))
    // Hold one capacity slot over both hashes and DB reads.
    hashing++
    try {
      const employee = await employees.findOne({ _id: request.adminPrincipal.id })
      const token = tokenOf(request)!
      const currentSession = await sessions.findOne({ tokenHash: hash(token) })
      if (!employee || !employee.active || employee.revision !== currentSession?.employeeRevision)
        return reply.code(401).send(error('ADMIN_UNAUTHORIZED', 'Войдите снова'))
      const candidate = await deriveAdminPassword(
        parsed.data.currentPassword,
        Buffer.from(employee.salt, 'hex'),
      )
      if (!timingSafeEqual(candidate, Buffer.from(employee.passwordHash, 'hex')))
        return reply.code(400).send(error('INVALID_PASSWORD', 'Текущий пароль неверен'))
      const salt = randomBytes(32)
      const passwordHash = await deriveAdminPassword(parsed.data.newPassword, salt)
      const result = await employees.updateOne(
        { _id: employee._id, revision: employee.revision, active: true },
        {
          $set: {
            salt: salt.toString('hex'),
            passwordHash: passwordHash.toString('hex'),
            mustChangePassword: false,
            revision: randomUUID(),
            updatedAt: new Date(),
          },
          $unset: { temporaryPasswordExpiresAt: '' },
        },
      )
      if (!result.matchedCount)
        return reply.code(409).send(error('EMPLOYEE_CHANGED', 'Доступ изменился. Войдите снова'))
      await sessions.deleteMany({ employeeId: employee._id, employeeRevision: employee.revision })
      await audit(request, 'employee.password_changed', employee._id, null, {
        passwordChanged: true,
      })
      releaseSuccessfulAttempt(request)
      reply.header('Set-Cookie', cookie('', 0))
      return { authenticated: false }
    } finally {
      hashing--
    }
  })
}

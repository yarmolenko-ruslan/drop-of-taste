import { randomUUID } from 'node:crypto'
import type { Db, Filter } from 'mongodb'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { can } from '../../../shared/admin-access.ts'
import {
  activitySectionPermissions,
  type AdminActivity,
  type ActivityKind,
  type ActivitySection,
} from '../../../shared/admin-activity.ts'
import { encodeOrdersCursor, parseOrdersCursor } from '../orders/cursor.ts'
import { adminLogCutoff, quietAdminActions } from '../../../shared/admin-log-policy.ts'

type ActivityDoc = Omit<AdminActivity, 'at' | 'completedAt'> & { at: Date; completedAt?: Date }
type ActivityContext = { entry: ActivityDoc; persisted: boolean; unavailable: boolean }
declare module 'fastify' {
  interface FastifyRequest {
    adminActivity: ActivityContext | null
  }
}
const failure = (code: string, message: string) => ({ error: { code, message } })
function operation(route: string, method: string): [string, ActivityKind] | null {
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return null
  const actions: Record<string, [string, ActivityKind]> = {
    'POST /api/admin/login': ['auth.login', 'access'],
    'POST /api/admin/logout': ['auth.logout', 'access'],
    'POST /api/admin/password': ['employee.password_changed', 'access'],
    'PATCH /api/admin/orders/:id/stage': ['order.stage', 'change'],
    'POST /api/admin/employees': ['employee.create', 'change'],
    'PATCH /api/admin/employees/:id': ['employee.update', 'change'],
    'POST /api/admin/employees/:id/reset-password': ['employee.password_reset', 'access'],
    'PATCH /api/admin/content': ['content.save', 'change'],
    'PUT /api/admin/content': ['content.save', 'change'],
    'POST /api/admin/upload': ['image.upload', 'change'],
    'POST /api/admin/iiko/sync': ['iiko.sync', 'change'],
  }
  for (const [path, name, parameter] of [
    ['categories', 'category', 'id'],
    ['products', 'product', 'id'],
    ['bonus-codes', 'bonus_code', 'code'],
  ]) {
    actions[`POST /api/admin/${path}`] = [`${name}.create`, 'change']
    actions[`PUT /api/admin/${path}/:${parameter}`] = [`${name}.update`, 'change']
    actions[`DELETE /api/admin/${path}/:${parameter}`] = [`${name}.delete`, 'change']
  }
  return actions[`${method} ${route}`] ?? ['admin.request', 'change']
}
function actorOf(request: FastifyRequest): AdminActivity['actor'] {
  const principal = request.adminPrincipal
  return principal ? { id: principal.id, name: principal.name, role: principal.role } : null
}
export function noteActivityTarget(
  request: Pick<FastifyRequest, 'adminActivity'>,
  id: string | undefined,
  action?: string,
) {
  if (!request.adminActivity) return
  if (id) request.adminActivity.entry.resourceId = id.slice(0, 150)
  if (action) request.adminActivity.entry.action = action
}

/** Persist the attempt before a handler can change data; finalize without storing bodies or cookies. */
export async function registerAdminActivity(app: FastifyInstance, db: Db) {
  const activities = db.collection<ActivityDoc>('admin_activity')
  let activeWrites = 0
  const persist = async <T>(write: () => Promise<T>): Promise<T> => {
    if (activeWrites >= 64) throw new Error('AUDIT_BUSY')
    activeWrites++
    try {
      return await write()
    } finally {
      activeWrites--
    }
  }
  await activities.createIndex({ at: -1, _id: -1 })
  await activities.createIndex({ 'actor.id': 1, at: -1 })
  await activities.createIndex({ 'actor.role': 1, at: -1 })
  app.decorateRequest('adminActivity', null)
  const initialize = (request: FastifyRequest) => {
    const route = request.routeOptions.url
    if (!route?.startsWith('/api/admin/') || route === '/api/admin/session') return
    let description = operation(route, request.method)
    if (route === '/api/admin/activity' && request.method === 'POST') {
      const type = (request.body as { type?: unknown } | null)?.type
      description =
        type === 'employee.credentials.view' || type === 'employee.credentials.copy'
          ? [type, 'access']
          : null
    }
    if (!description) return
    const [action, kind] = description
    request.adminActivity = {
      entry: {
        _id: randomUUID(),
        at: new Date(),
        actor: null,
        action,
        kind,
        outcome: 'pending',
        method: request.method,
        route,
      },
      persisted: false,
      unavailable: false,
    }
    const params = request.params as { id?: unknown; code?: unknown } | undefined
    const id = params?.id ?? params?.code
    if (typeof id === 'string') noteActivityTarget(request, id)
  }
  app.addHook('onRequest', async (request) => {
    initialize(request)
  })
  app.addHook('preHandler', async (request, reply) => {
    if (!request.adminActivity) initialize(request)
    const context = request.adminActivity
    if (!context) return
    context.entry.actor = actorOf(request)
    try {
      const result = await persist(() => activities.insertOne(context.entry))
      if (!result.acknowledged) throw new Error('AUDIT_WRITE_UNCONFIRMED')
      context.persisted = true
    } catch {
      context.unavailable = true
      app.log.error('Administrative activity storage unavailable')
      // Revoking access must remain possible even if the audit store is unavailable.
      if (context.entry.action === 'auth.logout') return
      return reply
        .code(503)
        .send(failure('AUDIT_UNAVAILABLE', 'Журнал действий недоступен. Повторите позже'))
    }
  })
  app.addHook('onSend', async (request, reply, payload) => {
    if (!request.adminActivity) initialize(request)
    const context = request.adminActivity
    if (!context || context.unavailable) return payload
    const statusCode = reply.statusCode
    let errorCode: string | undefined
    if (statusCode >= 400 && typeof payload === 'string') {
      try {
        const code = JSON.parse(payload)?.error?.code
        if (typeof code === 'string' && /^[A-Z0-9_]{1,80}$/.test(code)) errorCode = code
      } catch {
        /* Non-JSON failures never become raw log content. */
      }
    }
    const outcome =
      statusCode < 400
        ? 'success'
        : [401, 403, 429].includes(statusCode) ||
            ['ADMIN_ACCOUNT_CHANGED', 'ADMIN_SESSION_CHANGED'].includes(errorCode ?? '')
          ? 'denied'
          : 'error'
    const entry: ActivityDoc = {
      ...context.entry,
      actor: actorOf(request),
      statusCode,
      outcome,
      completedAt: new Date(),
      ...(errorCode ? { errorCode } : {}),
    }
    try {
      if (context.persisted) {
        const { _id, ...fields } = entry
        const result = await persist(() => activities.updateOne({ _id }, { $set: fields }))
        if (!result.acknowledged || result.matchedCount !== 1)
          throw new Error('AUDIT_ENTRY_MISSING')
      } else {
        const result = await persist(() => activities.insertOne(entry))
        if (!result.acknowledged) throw new Error('AUDIT_WRITE_UNCONFIRMED')
      }
    } catch {
      app.log.error('Administrative activity outcome could not be confirmed')
      if (context.entry.action === 'auth.logout') return payload
      if (context.entry.action === 'auth.login') reply.removeHeader('Set-Cookie')
      reply.code(503).type('application/json').removeHeader('Content-Length')
      return JSON.stringify(
        failure(
          'AUDIT_UNAVAILABLE',
          'Результат операции не подтверждён журналом. Обновите данные перед повтором',
        ),
      )
    }
    return payload
  })

  app.post('/api/admin/activity', async (request, reply) => {
    const sections = Object.keys(activitySectionPermissions) as [
      ActivitySection,
      ...ActivitySection[],
    ]
    const parsed = z
      .discriminatedUnion('type', [
        z.object({ type: z.literal('section.open'), section: z.enum(sections) }).strict(),
        z.object({ type: z.literal('employee.open'), employeeId: z.uuid() }).strict(),
        z
          .object({
            type: z.enum(['employee.credentials.view', 'employee.credentials.copy']),
            employeeId: z.uuid(),
            revision: z.uuid(),
          })
          .strict(),
      ])
      .safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(failure('INVALID_BODY', 'Проверьте действие'))
    const event = parsed.data
    if (request.adminActivity) {
      request.adminActivity.entry.action = event.type
      request.adminActivity.entry.kind = 'access'
    }
    if (event.type === 'section.open') {
      const permission = activitySectionPermissions[event.section]
      if (
        request.adminPrincipal?.role !== 'owner' &&
        (!permission || !can(request.adminPrincipal, permission))
      )
        return reply.code(403).send(failure('ADMIN_FORBIDDEN', 'Раздел недоступен'))
    } else {
      if (request.adminPrincipal?.role !== 'owner')
        return reply.code(403).send(failure('ADMIN_FORBIDDEN', 'Действие доступно владельцу'))
      noteActivityTarget(request, event.employeeId)
      if (event.type !== 'employee.open') {
        const current = await db
          .collection<{
            _id: string
            revision: string
            mustChangePassword: boolean
            temporaryPasswordExpiresAt?: Date
          }>('admin_employees')
          .findOne(
            {
              _id: event.employeeId,
              revision: event.revision,
              mustChangePassword: true,
              temporaryPasswordExpiresAt: { $gt: new Date() },
            },
            { projection: { _id: 1 } },
          )
        if (!current)
          return reply
            .code(409)
            .send(
              failure(
                'EMPLOYEE_CREDENTIALS_CHANGED',
                'Реквизиты сотрудника устарели. Обновите карточку и при необходимости выдайте новый пароль.',
              ),
            )
      }
    }
    return reply.code(204).send()
  })
  app.get('/api/admin/activity', async (request, reply) => {
    const parsed = z
      .object({
        role: z.enum(['all', 'owner', 'employee', 'anonymous']).default('all'),
        kind: z.enum(['all', 'access', 'view', 'change', 'navigation']).default('all'),
        outcome: z.enum(['all', 'success', 'denied', 'error', 'pending']).default('all'),
        q: z.string().trim().max(100).default(''),
        before: z.string().min(1).max(256).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .strict()
      .safeParse(request.query)
    if (!parsed.success)
      return reply.code(400).send(failure('INVALID_QUERY', 'Проверьте фильтры журнала'))
    const { role, kind, outcome, q, before, limit } = parsed.data
    const cursor = parseOrdersCursor(before)
    if (cursor === 'invalid')
      return reply.code(400).send(failure('INVALID_CURSOR', 'Проверьте страницу журнала'))
    const page = await activities
      .find({
        at: { $gte: adminLogCutoff() },
        method: { $nin: ['GET', 'HEAD', 'OPTIONS'] },
        action: { $nin: [...quietAdminActions] },
        ...(role === 'anonymous' ? { actor: null } : role !== 'all' ? { 'actor.role': role } : {}),
        ...(kind !== 'all' ? { kind } : {}),
        ...(outcome !== 'all' ? { outcome } : {}),
        ...(q
          ? { 'actor.name': { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }
          : {}),
        ...(cursor
          ? {
              $or: cursor.map(({ createdAt, ...rest }) => ({
                at: createdAt,
                ...rest,
              })) as Filter<ActivityDoc>[],
            }
          : {}),
      })
      .sort({ at: -1, _id: -1 })
      .limit(limit + 1)
      .toArray()
    const visible = page.slice(0, limit)
    const last = visible.at(-1)
    return {
      activities: visible,
      nextBefore:
        page.length > limit && last
          ? encodeOrdersCursor({ _id: last._id, createdAt: last.at })
          : null,
    }
  })
}

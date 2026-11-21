import { parseOrdersCursor, encodeOrdersCursor } from '../orders/cursor.ts'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Db, MongoClient } from 'mongodb'
import { z } from 'zod'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { invalidateCatalogCache } from '../catalog/mongo-catalog.ts'
import type { CatalogDoc } from '../catalog/template.ts'
import { getSiteContent } from '../content/service.ts'
import { notifySiteUpdate } from '../content/updates.ts'
import type { SiteContent } from '../../../shared/site-content.ts'
import { noteActivityTarget } from './activity.ts'
import { ensureAdminLogRetention } from './log-retention.ts'
import { adminLogCutoff } from '../../../shared/admin-log-policy.ts'
import { registerAdminAccess } from './access.ts'
import { can } from '../../../shared/admin-access.ts'
import {
  adminContent,
  clientProjection,
  orderContactProjection,
  employeeOrderProjection,
} from './response-access.ts'
import { normalizeBonusCode, type BonusCode } from '../../../shared/bonus-code.ts'
import { siteSettingsSchema } from '../../../shared/validation/site-settings.ts'
import { isInternalPath, isHttpsUrl } from '../../../shared/validation/urls.ts'

const image = z
  .string()
  .max(2048)
  .refine(
    (value) => !value || isInternalPath(value) || isHttpsUrl(value),
    'Укажите адрес изображения https:// или путь /uploads/...',
  )
const text = (max = 500) => z.string().trim().min(1).max(max)
const optionalText = (max = 500) => z.string().trim().max(max)
const optionalDate = z.iso.datetime({ offset: true }).optional()
const internalLink = isInternalPath
const slideSchema = z.object({
  id: text(80),
  badge: optionalText(80),
  title: text(180),
  description: optionalText(500),
  image,
  imageAlt: optionalText(180),
  href: z.string().max(200).refine(internalLink).optional(),
  showText: z.boolean().optional(),
})
const promotionSchema = z
  .object({
    id: text(80),
    category: z.enum(['delivery', 'pickup', 'cafe']),
    badge: text(80),
    title: text(180),
    subtitle: text(200),
    description: text(1000),
    conditions: text(2000),
    action: text(80),
    href: optionalText(200)
      .optional()
      .refine((value) => !value || internalLink(value)),
    theme: z.enum(['red', 'cream', 'burgundy', 'gold', 'green', 'white']),
    startsAt: optionalDate,
    endsAt: optionalDate,
    discountPercent: z
      .number()
      .min(0)
      .max(100)
      .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-7)
      .optional(),
    enabled: z.boolean().optional(),
    syncDiscountText: z.boolean().optional(),
  })
  .refine(
    (promotion) =>
      !promotion.startsAt ||
      !promotion.endsAt ||
      Date.parse(promotion.startsAt) < Date.parse(promotion.endsAt),
    'Окончание акции должно быть позже начала',
  )
const legalPageSchema = z.object({
  title: text(200),
  intro: text(3000),
  sections: z
    .array(z.tuple([text(200), text(5000)]))
    .min(1)
    .max(30),
})
const contentSchema = z.object({
  settings: siteSettingsSchema,
  brandName: text(100),
  siteTitle: text(100),
  browserTitle: text(200),
  brandLogo: image,
  tagline: text(100),
  phone: optionalText(50),
  email: optionalText(150),
  address: text(300),
  hours: text(100),
  mapEmbedUrl: z.url().refine(isHttpsUrl),
  mapBackupEmbedUrl: z.union([z.literal(''), z.url().refine(isHttpsUrl)]),
  mapRouteUrl: z.url().refine(isHttpsUrl),
  footerDescription: text(500),
  legalDetails: text(500),
  legalRevision: text(50),
  legal: z.object({ privacy: legalPageSchema, consent: legalPageSchema }),
  vkUrl: z.union([z.literal(''), z.url().refine(isHttpsUrl)]),
  telegramUrl: z.union([z.literal(''), z.url().refine(isHttpsUrl)]),
  aboutLead: text(250),
  aboutPageTitle: text(150),
  aboutEyebrow: text(150),
  aboutImageAlt: text(200),
  visitTitle: text(150),
  highlightsTitle: text(150),
  mapTitle: text(150),
  aboutParagraphs: z.tuple([text(2000), text(2000)]),
  aboutImage: image,
  homeAboutText: text(1000),
  bonusTitle: text(250),
  bonusText: text(1000),
  bonusSteps: z.tuple([text(160), text(160), text(160)]),
  comboTitle: text(150),
  comboSubtitle: text(500),
  comboBadge: text(150),
  comboNote: text(500),
  saucesSubtitle: text(500),
  aboutHighlights: z.tuple([text(200), text(200), text(200)]),
  benefits: z
    .array(
      z.object({
        icon: z.enum(['clock', 'truck', 'card', 'pin']),
        title: text(100),
        detail: text(200),
        mode: z.enum(['custom', 'delivery', 'pickup', 'payment']).optional(),
      }),
    )
    .length(4),
  promotions: z
    .array(promotionSchema)
    .max(30)
    .refine(
      (items) => new Set(items.map((item) => item.id)).size === items.length,
      'Идентификаторы акций должны быть уникальны',
    ),
  heroSlides: z
    .array(slideSchema)
    .max(12)
    .refine(
      (items) => new Set(items.map((item) => item.id)).size === items.length,
      'Идентификаторы баннеров должны быть уникальны',
    ),
})
const contentPatchSchema = contentSchema.partial().strict()
const categorySchema = z.object({
  title: text(100),
  subtitle: optionalText(300),
  sortOrder: z.number().int().min(0).max(10000),
})
const productSchema = z.object({
  categoryId: text(100),
  sortOrder: z.number().int().min(0).max(10000),
  name: text(160),
  details: optionalText(500),
  description: optionalText(3000),
  image: image,
  imageAlt: optionalText(160),
  badges: z.array(z.enum(['new', 'lenten', 'hit', 'spicy', 'discount'])).max(5),
  action: z.enum(['add', 'choose']),
  measure: z.enum(['г', 'мл']),
  amount: z.number().min(0).max(100000).nullable(),
  calories: z.number().min(0).max(100000).nullable(),
  ingredients: z.array(text(100)).max(50),
  allergenNote: optionalText(1000),
  extras: z.array(text(100)).max(50),
  portions: optionalText(100),
  priceKopecks: z.number().int().min(0).max(100000000),
  available: z.boolean(),
})
const bonusCodeSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(3)
      .max(40)
      .regex(/^[A-Za-zА-Яа-яЁё0-9_-]+$/),
    kind: z.enum(['percent', 'rubles']),
    value: z.number().positive().max(1000000),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    active: z.boolean(),
  })
  .refine(
    (code) =>
      Date.parse(code.startsAt) < Date.parse(code.endsAt) &&
      (code.kind !== 'percent' || code.value <= 100) &&
      Math.abs(code.value * 100 - Math.round(code.value * 100)) < 1e-7,
    'Проверьте величину скидки и время действия',
  )

function changes(
  before: unknown,
  after: unknown,
  prefix = '',
): Array<{ field: string; before: unknown; after: unknown }> {
  if (Array.isArray(before) && Array.isArray(after)) {
    const idOf = (item: unknown) =>
      item && typeof item === 'object' && ('id' in item || '_id' in item)
        ? String('id' in item ? item.id : item._id)
        : null
    const oldIds = before.map(idOf)
    const nextIds = after.map(idOf)
    if (
      oldIds.every(Boolean) &&
      nextIds.every(Boolean) &&
      new Set(oldIds).size === oldIds.length &&
      new Set(nextIds).size === nextIds.length
    ) {
      const oldItems = new Map(oldIds.map((id, index) => [id, before[index]]))
      const nextItems = new Map(nextIds.map((id, index) => [id, after[index]]))
      const itemChanges = [...new Set([...oldIds, ...nextIds])].flatMap((id) =>
        changes(oldItems.get(id), nextItems.get(id), `${prefix}[${id}]`),
      )
      const orderChange =
        JSON.stringify(oldIds) === JSON.stringify(nextIds)
          ? []
          : [{ field: `${prefix}.order`, before: oldIds, after: nextIds }]
      return [...itemChanges, ...orderChange]
    }
  }
  const old =
    before && typeof before === 'object' && !Array.isArray(before)
      ? (before as Record<string, unknown>)
      : null
  const next =
    after && typeof after === 'object' && !Array.isArray(after)
      ? (after as Record<string, unknown>)
      : null
  if (old && next)
    return [...new Set([...Object.keys(old), ...Object.keys(next)])]
      .filter((key) => key !== '_id' && key !== 'writeRevision')
      .flatMap((key) => changes(old[key], next[key], prefix ? `${prefix}.${key}` : key))
  return JSON.stringify(before) === JSON.stringify(after)
    ? []
    : [{ field: prefix, before: before ?? null, after: after ?? null }]
}

const failure = (code: string, message: string) => ({ error: { code, message } })
type CategoryDoc = {
  _id: string
  title: string
  subtitle: string
  sortOrder: number
  writeRevision?: number
}

export async function registerAdminRoutes(
  app: FastifyInstance,
  db: Db,
  origins: readonly string[],
  password: string,
  mongo: MongoClient,
) {
  await ensureAdminLogRetention(db)
  await registerAdminAccess(app, db, origins, password, mongo)
  const audit = db.collection('admin_audit')
  const record = async (
    action: string,
    id: string | undefined,
    before: unknown,
    after: unknown,
    request: Pick<FastifyRequest, 'adminPrincipal' | 'adminActivity'>,
  ) => {
    noteActivityTarget(request, id)
    const diff = changes(before, after)
    if (diff.length)
      await audit.insertOne({
        action,
        id,
        actor: request.adminPrincipal,
        changes: diff,
        at: new Date(),
      })
  }
  await audit.createIndex({ at: -1 })
  const bonusCodes = db.collection<BonusCode>('bonus_codes')
  await bonusCodes.createIndex({ endsAt: 1 })

  app.addContentTypeParser(
    /^image\/(png|jpeg|webp|gif)$/,
    { parseAs: 'buffer', bodyLimit: 5_000_000 },
    (_request, body, done) => done(null, body),
  )
  app.get('/api/admin/dashboard', async (request) => ({
    content: adminContent(await getSiteContent(db), request.adminPrincipal),
    categories: !can(request.adminPrincipal, 'catalog.read')
      ? []
      : await db
          .collection<CategoryDoc>('catalog_categories')
          .find({})
          .sort({ sortOrder: 1 })
          .toArray(),
    products: !can(request.adminPrincipal, 'catalog.read')
      ? []
      : (
          await db
            .collection<CatalogDoc>('catalog')
            .find({})
            .sort({ categoryId: 1, sortOrder: 1 })
            .toArray()
        ).map((product) => ({
          ...product,
          image: product.image ?? '',
          imageAlt: product.imageAlt ?? '',
          allergenNote: product.allergenNote ?? '',
          portions: product.portions ?? '',
        })),
    iikoConfigured:
      request.adminPrincipal?.role === 'owner' &&
      Boolean(
        process.env.IIKO_APP_ID &&
        process.env.IIKO_CLIENT_SECRET &&
        process.env.IIKO_API_KEY &&
        process.env.IIKO_ORGANIZATION_ID &&
        process.env.IIKO_EXTERNAL_MENU_ID,
      ),
  }))
  const orderStages = ['new', 'preparing', 'delivering', 'completed'] as const
  const orders = db.collection<{
    _id: string
    accountId: string
    input: { fulfillment: { mode: string; label: string; details?: unknown } }
    quote: {
      lines: { name: string; quantity: number; lineTotalKopecks: number }[]
      totalKopecks: number
      deliveryKopecks: number
      discountKopecks: number
    }
    payment?: { status: string }
    fulfillmentStatus?: (typeof orderStages)[number] | null
    requiresPayment?: boolean
    canceledAt?: Date
    fulfilledAt?: Date
    status?: string
    createdAt: Date
    completedAt?: Date
  }>('orders')
  const users = db.collection<{
    _id: string
    name?: string
    phone: string
    email?: string
    birthday?: string
    consentAcceptedAt?: Date
  }>('users')
  app.get('/api/admin/orders', async (request, reply) => {
    const parsed = z
      .object({
        stage: z.enum(orderStages).optional(),
        before: z.string().max(256).optional(),
        limit: z.coerce.number().int().min(1).max(1000).default(50),
      })
      .safeParse(request.query)
    if (!parsed.success)
      return reply.code(400).send(failure('INVALID_QUERY', 'Проверьте фильтр заказов'))
    const { stage, before, limit } = parsed.data
    const cursor = parseOrdersCursor(before)
    if (cursor === 'invalid')
      return reply.code(400).send(failure('INVALID_CURSOR', 'Проверьте страницу заказов'))
    const stageFilter =
      stage === 'new'
        ? {
            $or: [
              { fulfillmentStatus: 'new' as const },
              { fulfillmentStatus: null, status: { $ne: 'completed' } },
            ],
          }
        : stage === 'completed'
          ? {
              $or: [
                { fulfillmentStatus: 'completed' as const },
                { fulfillmentStatus: null, status: 'completed' },
              ],
            }
          : stage
            ? { fulfillmentStatus: stage }
            : {}
    const filter = {
      ...stageFilter,
      ...(cursor
        ? {
            $and: [{ $or: cursor }],
          }
        : {}),
    }
    const page = await orders
      .find(
        {
          ...filter,
          canceledAt: { $exists: false },
          $nor: [
            { requiresPayment: true, 'payment.status': { $ne: 'succeeded' } },
            { 'payment.status': { $in: ['creating', 'error', 'pending', 'canceled'] } },
            { 'quote.totalKopecks': 0, status: { $ne: 'completed' } },
          ],
        },
        {
          projection:
            request.adminPrincipal?.role === 'owner' ? undefined : employeeOrderProjection,
        },
      )
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .toArray()
    const visible = page.slice(0, limit)
    const owners = await users
      .find(
        { _id: { $in: [...new Set(visible.map((order) => order.accountId))] } },
        {
          projection:
            request.adminPrincipal?.role === 'owner'
              ? undefined
              : can(request.adminPrincipal, 'clients.read')
                ? clientProjection
                : orderContactProjection,
        },
      )
      .toArray()
    const byId = new Map(owners.map((owner) => [owner._id, owner]))
    return {
      orders: visible.map((order) => ({
        ...order,
        fulfillmentStatus:
          order.fulfillmentStatus ?? (order.status === 'completed' ? 'completed' : 'new'),
        customer: byId.get(order.accountId) ?? null,
      })),
      nextBefore:
        page.length > limit && visible.length ? encodeOrdersCursor(visible.at(-1)!) : null,
    }
  })
  app.patch('/api/admin/orders/:id/stage', async (request, reply) => {
    const parsed = z.object({ stage: z.enum(orderStages) }).safeParse(request.body)
    if (!parsed.success)
      return reply.code(400).send(failure('INVALID_STAGE', 'Выберите этап заказа'))
    const id = (request.params as { id: string }).id
    const index = orderStages.indexOf(parsed.data.stage)
    if (index === 0)
      return reply.code(400).send(failure('INVALID_STAGE', 'Нельзя вернуть заказ в новые'))
    const previous = orderStages[index - 1]
    const result = await orders.findOneAndUpdate(
      {
        _id: id,
        canceledAt: { $exists: false },
        $nor: [
          { requiresPayment: true, 'payment.status': { $ne: 'succeeded' } },
          { 'payment.status': { $in: ['creating', 'error', 'pending', 'canceled'] } },
          { 'quote.totalKopecks': 0, status: { $ne: 'completed' } },
        ],
        ...(previous === 'new'
          ? {
              $or: [
                { fulfillmentStatus: 'new' },
                { fulfillmentStatus: null, status: { $ne: 'completed' } },
              ],
            }
          : { fulfillmentStatus: previous }),
      },
      {
        $set: {
          fulfillmentStatus: parsed.data.stage,
          ...(parsed.data.stage === 'completed' ? { fulfilledAt: new Date() } : {}),
        },
      },
      {
        returnDocument: 'after',
        projection: request.adminPrincipal?.role === 'owner' ? undefined : employeeOrderProjection,
      },
    )
    if (!result)
      return reply
        .code(409)
        .send(failure('STAGE_CHANGED', 'Этап заказа уже изменился. Обновите список'))
    noteActivityTarget(
      request,
      id,
      {
        preparing: 'order.accept',
        delivering: 'order.deliver',
        completed: 'order.complete',
        new: 'order.stage',
      }[parsed.data.stage],
    )
    await record(
      'order.stage',
      id,
      { fulfillmentStatus: previous },
      { fulfillmentStatus: parsed.data.stage },
      request,
    )
    return { order: result }
  })
  app.get('/api/admin/clients', async (request, reply) => {
    const parsed = z
      .object({
        q: z.string().trim().max(100).default(''),
        filter: z.enum(['all', 'ordered', 'without-orders']).default('all'),
        before: z.string().min(1).max(100).optional(),
      })
      .safeParse(request.query)
    if (!parsed.success)
      return reply.code(400).send(failure('INVALID_QUERY', 'Проверьте поиск клиентов'))
    const { q, filter, before } = parsed.data
    const escaped = [...q]
      .map((char) =>
        '.^$*+?()[]{}|'.includes(char) || char.charCodeAt(0) === 92
          ? String.fromCharCode(92) + char
          : char,
      )
      .join('')
    const query = q
      ? {
          $or: [
            { name: { $regex: escaped, $options: 'i' } },
            { phone: { $regex: escaped, $options: 'i' } },
            { email: { $regex: escaped, $options: 'i' } },
          ],
        }
      : {}
    const match = { ...query, ...(before ? { _id: { $lt: before } } : {}) }
    const page =
      filter === 'all'
        ? await users
            .find(match, {
              projection: request.adminPrincipal?.role === 'owner' ? undefined : clientProjection,
            })
            .sort({ _id: -1 })
            .limit(51)
            .toArray()
        : await users
            .aggregate<{
              _id: string
              name?: string
              phone: string
              email?: string
              birthday?: string
              consentAcceptedAt?: Date
            }>([
              { $match: match },
              { $sort: { _id: -1 } },
              {
                $lookup: {
                  from: 'orders',
                  localField: '_id',
                  foreignField: 'accountId',
                  pipeline: [{ $limit: 1 }],
                  as: 'orderMatch',
                },
              },
              { $match: { 'orderMatch.0': { $exists: filter === 'ordered' } } },
              {
                $project:
                  request.adminPrincipal?.role === 'owner' ? { orderMatch: 0 } : clientProjection,
              },
              { $limit: 51 },
            ])
            .toArray()
    return { clients: page.slice(0, 50), nextBefore: page.length > 50 ? page[49]?._id : null }
  })
  app.get('/api/admin/clients/:id', async (request, reply) => {
    const { before } = request.query as { before?: string }
    const cursor = parseOrdersCursor(before)
    if (cursor === 'invalid')
      return reply.code(400).send(failure('INVALID_CURSOR', 'Проверьте страницу заказов'))
    const limit = 50
    const id = (request.params as { id: string }).id
    const client = await users.findOne(
      { _id: id },
      { projection: request.adminPrincipal?.role === 'owner' ? undefined : clientProjection },
    )
    if (!client) return reply.code(404).send(failure('NOT_FOUND', 'Клиент не найден'))
    const [history, addresses] = await Promise.all([
      orders
        .find(
          { accountId: id, ...(cursor && { $or: cursor }) },
          {
            projection:
              request.adminPrincipal?.role === 'owner' ? undefined : employeeOrderProjection,
          },
        )
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit + 1)
        .toArray(),
      db
        .collection<{ accountId: string; label: string }>('addresses')
        .find({ accountId: id })
        .toArray(),
    ])
    return {
      client,
      addresses: addresses.map((address) => address.label),
      nextBefore: history.length > limit ? encodeOrdersCursor(history[limit - 1]!) : null,
      orders: history.slice(0, limit).map((order) => ({
        ...order,
        fulfillmentStatus:
          order.fulfillmentStatus ?? (order.status === 'completed' ? 'completed' : 'new'),
      })),
    }
  })
  app.get('/api/admin/logs', async () => {
    const cutoff = adminLogCutoff()
    const [changes, events, orders] = await Promise.all([
      audit
        .find({ at: { $gte: cutoff } })
        .sort({ at: -1 })
        .limit(100)
        .toArray(),
      db
        .collection('payment_events')
        .find({ at: { $gte: cutoff } })
        .sort({ at: -1 })
        .limit(100)
        .toArray(),
      db
        .collection<{
          _id: string
          quote: { totalKopecks: number }
          payment?: { status: string; id?: string; updatedAt: Date }
        }>('orders')
        .find({ 'payment.updatedAt': { $gte: cutoff } })
        .sort({ 'payment.updatedAt': -1 })
        .limit(100)
        .toArray(),
    ])
    const loggedIds = new Set(events.map((event) => event.orderId))
    const legacy = orders
      .filter((order) => !loggedIds.has(order._id) && order.payment)
      .map((order) => ({
        _id: `legacy-${order._id}`,
        orderId: order._id,
        from: 'unpaid',
        status: order.payment!.status,
        paymentId: order.payment!.id,
        amountKopecks: order.quote.totalKopecks,
        at: order.payment!.updatedAt,
      }))
    return {
      changes,
      payments: [...events, ...legacy]
        .sort((a, b) => new Date(b.at as Date).getTime() - new Date(a.at as Date).getTime())
        .slice(0, 100),
    }
  })
  app.get('/api/admin/bonus-codes', async () => ({
    codes: await bonusCodes.find({}).sort({ startsAt: -1 }).toArray(),
  }))
  app.post('/api/admin/bonus-codes', async (request, reply) => {
    const parsed = bonusCodeSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(failure('INVALID_BODY', 'Проверьте бонус-код'))
    const { code, ...fields } = parsed.data
    const item: BonusCode = { _id: normalizeBonusCode(code), ...fields }
    try {
      await bonusCodes.insertOne(item)
    } catch (error) {
      if ((error as { code?: number }).code === 11000)
        return reply.code(409).send(failure('CODE_EXISTS', 'Такой код уже есть'))
      throw error
    }
    await record('bonus_code.create', item._id, null, item, request)
    return reply.code(201).send({ code: item })
  })
  app.put('/api/admin/bonus-codes/:code', async (request, reply) => {
    const parsed = bonusCodeSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(failure('INVALID_BODY', 'Проверьте бонус-код'))
    const id = normalizeBonusCode((request.params as { code: string }).code)
    if (normalizeBonusCode(parsed.data.code) !== id)
      return reply
        .code(400)
        .send(failure('CODE_RENAME', 'Название существующего кода изменить нельзя'))
    const before = await bonusCodes.findOne({ _id: id })
    if (!before) return reply.code(404).send(failure('NOT_FOUND', 'Код не найден'))
    const { code: _code, ...fields } = parsed.data
    void _code
    const item: BonusCode = { _id: id, ...fields }
    await bonusCodes.replaceOne({ _id: id }, item)
    await record('bonus_code.update', id, before, item, request)
    return { code: item }
  })
  app.delete('/api/admin/bonus-codes/:code', async (request, reply) => {
    const id = normalizeBonusCode((request.params as { code: string }).code)
    const before = await bonusCodes.findOneAndDelete({ _id: id })
    if (!before) return reply.code(404).send(failure('NOT_FOUND', 'Код не найден'))
    await record('bonus_code.delete', id, before, null, request)
    return reply.code(204).send()
  })
  app.put('/api/admin/content', { bodyLimit: 1_000_000 }, async (request, reply) => {
    const parsed = contentSchema.safeParse(request.body)
    if (!parsed.success)
      return reply.code(400).send(failure('INVALID_BODY', 'Проверьте поля сайта'))
    const before = await getSiteContent(db)
    await db
      .collection<SiteContent & { _id: string }>('site_content')
      .updateOne(
        { _id: 'public' },
        { $set: { ...parsed.data, contentVersion: 1 } },
        { upsert: true },
      )
    await record('content.update', undefined, before, parsed.data, request)
    notifySiteUpdate(app, 'content')
    return { content: adminContent(parsed.data, request.adminPrincipal) }
  })
  app.patch('/api/admin/content', { bodyLimit: 1_000_000 }, async (request, reply) => {
    const parsed = contentPatchSchema.safeParse(request.body)
    if (!parsed.success)
      return reply.code(400).send(failure('INVALID_BODY', 'Проверьте поля сайта'))
    const before = await getSiteContent(db)
    const content = contentSchema.safeParse({ ...before, ...parsed.data })
    if (!content.success)
      return reply.code(400).send(failure('INVALID_BODY', 'Проверьте поля сайта'))
    if (Object.keys(parsed.data).length > 0) {
      // Однократно фиксируем прежнюю миграцию текстов. После сохранения
      // авторские значения больше не подменяются шаблонными при чтении.
      await db
        .collection<SiteContent & { _id: string; contentVersion?: number }>('site_content')
        .updateOne(
          { _id: 'public', contentVersion: { $ne: 1 } },
          { $set: { ...before, contentVersion: 1 } },
        )
      await db
        .collection<SiteContent & { _id: string }>('site_content')
        .updateOne(
          { _id: 'public' },
          { $set: { ...parsed.data, contentVersion: 1 } },
          { upsert: true },
        )
      await record('content.update', undefined, before, content.data, request)
      notifySiteUpdate(app, 'content')
    }
    return { content: adminContent(content.data, request.adminPrincipal) }
  })
  app.post('/api/admin/categories', async (request, reply) => {
    const parsed = categorySchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(failure('INVALID_BODY', 'Проверьте категорию'))
    const category = { _id: `cat-${randomUUID()}`, ...parsed.data }
    await db.collection<CategoryDoc>('catalog_categories').insertOne(category)
    invalidateCatalogCache(db)
    await record('category.create', category._id, null, category, request)
    notifySiteUpdate(app, 'catalog')
    return reply.code(201).send({ category })
  })
  app.put('/api/admin/categories/:id', async (request, reply) => {
    const parsed = categorySchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(failure('INVALID_BODY', 'Проверьте категорию'))
    const id = (request.params as { id: string }).id
    const before = await db.collection<CategoryDoc>('catalog_categories').findOne({ _id: id })
    const result = await db
      .collection<CategoryDoc>('catalog_categories')
      .updateOne({ _id: id }, { $set: parsed.data })
    if (!result.matchedCount)
      return reply.code(404).send(failure('NOT_FOUND', 'Категория не найдена'))
    invalidateCatalogCache(db)
    await record('category.update', id, before, { _id: id, ...parsed.data }, request)
    notifySiteUpdate(app, 'catalog')
    return { category: { _id: id, ...parsed.data } }
  })
  app.delete('/api/admin/categories/:id', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const result = await mongo.withSession((session) =>
      session.withTransaction(async () => {
        // Запись общей категории конфликтует с сохранением товара и импортом.
        // После повтора транзакция заново проверяет наличие её товаров.
        const categories = db.collection<CategoryDoc>('catalog_categories')
        const before = await categories.findOneAndUpdate(
          { _id: id },
          { $inc: { writeRevision: 1 } },
          { session, returnDocument: 'before' },
        )
        if (!before) return { error: 'NOT_FOUND' as const }
        if (await db.collection('catalog').countDocuments({ categoryId: id }, { session }))
          return { error: 'CATEGORY_NOT_EMPTY' as const }
        const content = await getSiteContent(db)
        if (
          [...content.promotions, ...content.heroSlides].some(
            (item) => item.href?.split(/[?#]/)[0] === `/menu/${id}`,
          )
        )
          return { error: 'CATEGORY_IN_PROMOTION' as const }
        await categories.deleteOne({ _id: id }, { session })
        return { before }
      }),
    )
    if (result.error) {
      const messages = {
        NOT_FOUND: 'Категория не найдена',
        CATEGORY_NOT_EMPTY: 'Сначала переместите или удалите товары категории',
        CATEGORY_IN_PROMOTION: 'Сначала измените ссылку акции на этот раздел',
      }
      return reply
        .code(result.error === 'NOT_FOUND' ? 404 : 409)
        .send(failure(result.error, messages[result.error]))
    }
    const { before } = result
    invalidateCatalogCache(db)
    await record('category.delete', id, before, null, request)
    notifySiteUpdate(app, 'catalog')
    return reply.code(204).send()
  })
  const saveProduct = async (
    request: Pick<FastifyRequest, 'body' | 'adminPrincipal' | 'adminActivity'>,
    reply: FastifyReply,
    id?: string,
  ) => {
    const parsed = productSchema.safeParse(request.body)
    if (!parsed.success)
      return reply.code(400).send(failure('INVALID_BODY', 'Проверьте карточку товара'))
    const product: CatalogDoc = { _id: id ?? `manual-${randomUUID()}`, ...parsed.data }
    const result = await mongo.withSession((session) =>
      session.withTransaction(async () => {
        const category = await db
          .collection<CategoryDoc>('catalog_categories')
          .findOneAndUpdate(
            { _id: product.categoryId },
            { $inc: { writeRevision: 1 } },
            { session },
          )
        if (!category) return { error: 'INVALID_CATEGORY' as const }
        const products = db.collection<CatalogDoc>('catalog')
        const before = id ? await products.findOne({ _id: id }, { session }) : null
        if (id && !before) return { error: 'NOT_FOUND' as const }
        if (id) await products.replaceOne({ _id: id }, product, { session })
        else await products.insertOne(product, { session })
        return { before }
      }),
    )
    if (result.error)
      return reply
        .code(result.error === 'NOT_FOUND' ? 404 : 400)
        .send(
          failure(
            result.error,
            result.error === 'NOT_FOUND' ? 'Товар не найден' : 'Категория не найдена',
          ),
        )
    const { before } = result
    invalidateCatalogCache(db)
    await record(id ? 'product.update' : 'product.create', product._id, before, product, request)
    notifySiteUpdate(app, 'catalog')
    return reply.code(id ? 200 : 201).send({ product })
  }
  app.post('/api/admin/products', async (request, reply) => saveProduct(request, reply))
  app.put('/api/admin/products/:id', async (request, reply) =>
    saveProduct(request, reply, (request.params as { id: string }).id),
  )
  app.delete('/api/admin/products/:id', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const before = await db.collection<CatalogDoc>('catalog').findOneAndDelete({ _id: id })
    if (!before) return reply.code(404).send(failure('NOT_FOUND', 'Товар не найден'))
    invalidateCatalogCache(db)
    await record('product.delete', id, before, null, request)
    notifySiteUpdate(app, 'catalog')
    return reply.code(204).send()
  })
  app.post('/api/admin/upload', { bodyLimit: 5_000_000 }, async (request, reply) => {
    const body = request.body
    if (!Buffer.isBuffer(body) || body.length > 5_000_000 || body.length < 12)
      return reply.code(400).send(failure('INVALID_IMAGE', 'Выберите изображение до 5 МБ'))
    const png = body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    const jpeg = body[0] === 255 && body[1] === 216 && body[2] === 255
    const webp = body.toString('ascii', 0, 4) === 'RIFF' && body.toString('ascii', 8, 12) === 'WEBP'
    const gif = body.toString('ascii', 0, 6).startsWith('GIF8')
    const ext = png ? 'png' : jpeg ? 'jpg' : webp ? 'webp' : gif ? 'gif' : null
    if (!ext)
      return reply.code(400).send(failure('INVALID_IMAGE', 'Поддерживаются PNG, JPEG, WebP и GIF'))
    const directory = join(process.cwd(), 'public', 'uploads')
    await mkdir(directory, { recursive: true })
    const filename = `${randomUUID()}.${ext}`
    await writeFile(join(directory, filename), body, { flag: 'wx' })
    await record('image.upload', filename, null, { url: `/uploads/${filename}` }, request)
    return reply.code(201).send({ url: `/uploads/${filename}` })
  })
}

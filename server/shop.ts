import { randomUUID } from 'node:crypto'
import type { Db, MongoClient } from 'mongodb'
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import type { AuthService } from './auth/service.ts'
import { readSessionToken } from './auth/session-cookie.ts'
import type { CatalogDoc } from './catalog/template.ts'
import { addressDetailsSchema } from '../shared/validation/address.ts'
import { createOriginChecker } from './origins.ts'

const lineSchema = z
  .object({
    productId: z.string().min(1).max(100),
    quantity: z.number().int().min(1).max(99),
    extras: z.array(z.object({ name: z.string(), quantity: z.number().int().min(1) })).default([]),
  })
  .strict()
const cafeAddress = 'г. Красноярск, улица Петра Подзолкова, 3и'
const fulfillmentSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('pickup'), label: z.literal(cafeAddress) }).strict(),
  z
    .object({
      mode: z.literal('delivery'),
      label: z.string().min(5).max(300),
      details: addressDetailsSchema,
    })
    .strict(),
])
const checkoutSchema = z
  .object({ lines: z.array(lineSchema).min(1).max(100), fulfillment: fulfillmentSchema })
  .strict()
const orderSchema = checkoutSchema.extend({ expectedTotalKopecks: z.number().int().min(0) })
type Checkout = z.infer<typeof checkoutSchema>
type OrderDoc = {
  _id: string
  accountId: string
  idempotencyKey: string
  input: Checkout
  quote: Awaited<ReturnType<typeof calculateQuote>>
  status: 'test' | 'completed'
  completedAt?: Date
  createdAt: Date
}

function publicOrder(order: OrderDoc) {
  return {
    _id: order._id,
    input: order.input,
    quote: order.quote,
    status: order.status,
    createdAt: order.createdAt,
    ...(order.completedAt && { completedAt: order.completedAt }),
  }
}

function failure(code: string, message: string) {
  return { error: { code, message } }
}

const PAGE_SIZE = 50

type OrdersQuery = { accountId: string; $or?: Array<Record<string, unknown>> }

function parseOrdersCursor(cursor: string | undefined): OrdersQuery['$or'] | 'invalid' | undefined {
  if (!cursor) return undefined
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as {
      d?: string
      i?: string
    }
    const date = new Date(decoded.d ?? '')
    // i обязан быть строкой: нестроковое значение молча дало бы пустую страницу.
    if (typeof decoded.i !== 'string' || Number.isNaN(date.getTime())) return 'invalid'
    // Курсор по (createdAt, _id): берём записи «ниже» последней показанной,
    // с разрешением ничьих по дате через сравнение _id.
    return [{ createdAt: { $lt: date } }, { createdAt: date, _id: { $lt: decoded.i } }]
  } catch {
    return 'invalid'
  }
}

function encodeOrdersCursor(order: OrderDoc): string {
  return Buffer.from(JSON.stringify({ d: order.createdAt.toISOString(), i: order._id })).toString(
    'base64url',
  )
}

function quoteError(error: unknown) {
  if (error instanceof Error && ['PRODUCT_UNAVAILABLE', 'EXTRAS_UNPRICED'].includes(error.message))
    return failure(error.message, 'Состав корзины изменился. Проверьте позиции.')
  throw error
}

export async function calculateQuote(db: Db, input: Checkout) {
  const ids = [...new Set(input.lines.map((line) => line.productId))]
  const products = await db
    .collection<CatalogDoc>('catalog')
    .find({ _id: { $in: ids } })
    .toArray()
  const byId = new Map(products.map((item) => [item._id, item]))
  const lines = input.lines.map((line) => {
    const product = byId.get(line.productId)
    if (!product || !product.available) throw new Error('PRODUCT_UNAVAILABLE')
    if (line.extras.length > 0) throw new Error('EXTRAS_UNPRICED')
    return {
      productId: product._id,
      name: product.name,
      quantity: line.quantity,
      unitPriceKopecks: product.priceKopecks,
      lineTotalKopecks: product.priceKopecks * line.quantity,
    }
  })
  const subtotalKopecks = lines.reduce((sum, line) => sum + line.lineTotalKopecks, 0)
  const discountKopecks = input.fulfillment.mode === 'pickup' ? Math.round(subtotalKopecks / 10) : 0
  const deliveryKopecks =
    input.fulfillment.mode === 'delivery' && subtotalKopecks < 150_000 ? 25_000 : 0
  return {
    lines,
    subtotalKopecks,
    discountKopecks,
    deliveryKopecks,
    totalKopecks: subtotalKopecks - discountKopecks + deliveryKopecks,
    eligible: input.fulfillment.mode === 'pickup' || subtotalKopecks >= 50_000,
    testMode: true,
  }
}

export async function ensureShopIndexes(db: Db) {
  await db
    .collection<OrderDoc>('orders')
    .createIndex({ accountId: 1, idempotencyKey: 1 }, { unique: true })
  // Лента заказов: find({ accountId }).sort({ createdAt: -1, _id: -1 }) — без этого
  // индекса сортировка уходит в блокировку и сортировку в памяти по мере роста истории.
  await db.collection<OrderDoc>('orders').createIndex({ accountId: 1, createdAt: -1, _id: -1 })
  await db.collection('addresses').createIndex({ accountId: 1 })
}

export function registerShopRoutes(
  app: FastifyInstance,
  db: Db,
  _mongo: MongoClient,
  auth: AuthService,
  origins: readonly string[] = ['http://localhost:5173', 'http://127.0.0.1:5173'],
  secureCookies = false,
) {
  const isOriginAllowed = createOriginChecker(origins)
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/checkout/') && !request.url.startsWith('/api/orders')) return
    reply.header('Cache-Control', 'no-store')
    if (request.method === 'POST' && !isOriginAllowed(request.headers.origin))
      return reply.code(403).send(failure('INVALID_ORIGIN', 'Запрос отклонён'))
    const expectedAccountId = request.headers['x-account-id']
    if (request.url.startsWith('/api/orders') && expectedAccountId !== undefined) {
      const account = await auth.getAccount(readSessionToken(request.headers.cookie, secureCookies))
      if (!account) return reply.code(401).send(failure('UNAUTHENTICATED', 'Необходимо войти'))
      if (expectedAccountId !== account.id)
        return reply
          .code(409)
          .send(failure('ACCOUNT_CHANGED', 'Аккаунт изменился. Обновите страницу.'))
    }
  })
  app.post('/api/checkout/quote', async (request, reply) => {
    const parsed = checkoutSchema.safeParse(request.body)
    if (!parsed.success)
      return reply.code(400).send(failure('INVALID_BODY', 'Проверьте корзину и способ получения'))
    try {
      return await calculateQuote(db, parsed.data)
    } catch (error) {
      return reply.code(400).send(quoteError(error))
    }
  })
  app.post('/api/orders', async (request, reply) => {
    const user = await auth.getAccount(readSessionToken(request.headers.cookie, secureCookies))
    if (!user) return reply.code(401).send(failure('UNAUTHENTICATED', 'Войдите для оформления'))
    const parsed = orderSchema.safeParse(request.body)
    if (!parsed.success)
      return reply.code(400).send(failure('INVALID_BODY', 'Проверьте корзину и способ получения'))
    const key = request.headers['idempotency-key']
    if (typeof key !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(key))
      return reply.code(400).send(failure('INVALID_KEY', 'Не удалось подтвердить заказ'))
    const orders = db.collection<OrderDoc>('orders')
    const input = { lines: parsed.data.lines, fulfillment: parsed.data.fulfillment }
    const existing = await orders.findOne({ accountId: user.id, idempotencyKey: key })
    if (existing)
      return JSON.stringify(existing.input) === JSON.stringify(input)
        ? { order: publicOrder(existing) }
        : reply.code(409).send(failure('KEY_REUSED', 'Этот запрос уже использован'))
    if (input.fulfillment.mode === 'delivery') {
      const account = await db
        .collection<{ _id: string; selectedAddressId?: string | null }>('users')
        .findOne({ _id: user.id })
      const selected = account?.selectedAddressId
        ? await db
            .collection<{
              _id: string
              accountId: string
              label: string
              details: z.infer<typeof addressDetailsSchema>
            }>('addresses')
            .findOne({ _id: account.selectedAddressId, accountId: user.id })
        : null
      const details = input.fulfillment.details
      if (
        !selected ||
        selected.label !== input.fulfillment.label ||
        selected.details.street !== details.street ||
        selected.details.entrance !== details.entrance ||
        selected.details.floor !== details.floor ||
        selected.details.flat !== details.flat ||
        selected.details.comment !== details.comment ||
        selected.details.isHouse !== details.isHouse
      ) {
        return reply
          .code(409)
          .send(failure('ADDRESS_CHANGED', 'Адрес доставки изменился. Выберите его заново.'))
      }
    }
    let quote: Awaited<ReturnType<typeof calculateQuote>>
    try {
      quote = await calculateQuote(db, input)
    } catch (error) {
      return reply.code(400).send(quoteError(error))
    }
    if (!quote.eligible)
      return reply.code(400).send(failure('MINIMUM_ORDER', 'Для доставки нужно минимум 500 ₽ блюд'))
    if (quote.totalKopecks !== parsed.data.expectedTotalKopecks)
      return reply
        .code(409)
        .send(failure('PRICE_CHANGED', 'Цена изменилась. Рассчитайте заказ повторно.'))
    const order: OrderDoc = {
      _id: randomUUID(),
      accountId: user.id,
      idempotencyKey: key,
      input,
      quote,
      status: 'test',
      createdAt: new Date(),
    }
    try {
      await orders.insertOne(order)
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error
      const duplicate = await orders.findOne({ accountId: user.id, idempotencyKey: key })
      if (duplicate && JSON.stringify(duplicate.input) === JSON.stringify(input))
        return { order: publicOrder(duplicate) }
      return reply.code(409).send(failure('KEY_REUSED', 'Этот запрос уже использован'))
    }
    return reply.code(201).send({ order: publicOrder(order) })
  })
  app.get('/api/orders', async (request, reply) => {
    const user = await auth.getAccount(readSessionToken(request.headers.cookie, secureCookies))
    if (!user) return reply.code(401).send(failure('UNAUTHENTICATED', 'Необходимо войти'))
    const { cursor } = request.query as { cursor?: string }
    const or = parseOrdersCursor(cursor)
    if (or === 'invalid')
      return reply.code(400).send(failure('INVALID_CURSOR', 'Проверьте параметры запроса'))
    const query: OrdersQuery = { accountId: user.id }
    if (or) query.$or = or
    const found = await db
      .collection<OrderDoc>('orders')
      .find(query)
      .sort({ createdAt: -1, _id: -1 })
      .limit(PAGE_SIZE + 1) // +1, чтобы понять, есть ли следующая страница
      .toArray()
    const page = found.slice(0, PAGE_SIZE)
    const last = page.at(-1)
    const nextCursor = found.length > PAGE_SIZE && last ? encodeOrdersCursor(last) : null
    return { orders: page.map(publicOrder), nextCursor }
  })
  app.post('/api/orders/:id/complete', async (request, reply) => {
    const user = await auth.getAccount(readSessionToken(request.headers.cookie, secureCookies))
    if (!user) return reply.code(401).send(failure('UNAUTHENTICATED', 'Необходимо войти'))
    const id = (request.params as { id: string }).id
    const result = await db
      .collection<OrderDoc>('orders')
      .findOneAndUpdate(
        { _id: id, accountId: user.id, status: 'test' },
        { $set: { status: 'completed', completedAt: new Date() } },
        { returnDocument: 'after' },
      )
    if (!result) return reply.code(404).send(failure('NOT_FOUND', 'Заказ не найден'))
    return { order: publicOrder(result) }
  })
}

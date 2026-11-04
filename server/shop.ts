import { randomUUID } from 'node:crypto'
import type { Db, MongoClient } from 'mongodb'
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import type { AuthService } from './auth/service.ts'
import type { CatalogDoc } from './catalog/template.ts'
import { addressDetailsSchema } from '../shared/validation/address.ts'

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

function cookie(header: string | undefined) {
  return header
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('dev_session='))
    ?.slice('dev_session='.length)
}
function failure(code: string, message: string) {
  return { error: { code, message } }
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
  await db.collection('addresses').createIndex({ accountId: 1 })
}

export function registerShopRoutes(
  app: FastifyInstance,
  db: Db,
  _mongo: MongoClient,
  auth: AuthService,
  origins: readonly string[] = ['http://localhost:5173', 'http://127.0.0.1:5173'],
) {
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/checkout/') && !request.url.startsWith('/api/orders')) return
    reply.header('Cache-Control', 'no-store')
    if (request.method === 'POST' && !origins.includes(request.headers.origin ?? ''))
      return reply.code(403).send(failure('INVALID_ORIGIN', 'Запрос отклонён'))
  })
  app.post('/api/checkout/quote', async (request, reply) => {
    const parsed = checkoutSchema.safeParse(request.body)
    if (!parsed.success)
      return reply.code(400).send(failure('INVALID_BODY', 'Проверьте корзину и способ получения'))
    try {
      return await calculateQuote(db, parsed.data)
    } catch (error) {
      return reply
        .code(400)
        .send(failure((error as Error).message, 'Состав корзины изменился. Проверьте позиции.'))
    }
  })
  app.post('/api/orders', async (request, reply) => {
    const user = await auth.getAccount(cookie(request.headers.cookie))
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
        ? { order: existing }
        : reply.code(409).send(failure('KEY_REUSED', 'Этот запрос уже использован'))
    let quote: Awaited<ReturnType<typeof calculateQuote>>
    try {
      quote = await calculateQuote(db, input)
    } catch (error) {
      return reply
        .code(400)
        .send(failure((error as Error).message, 'Состав корзины изменился. Проверьте позиции.'))
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
        return { order: duplicate }
      return reply.code(409).send(failure('KEY_REUSED', 'Этот запрос уже использован'))
    }
    return reply.code(201).send({ order })
  })
  app.get('/api/orders', async (request, reply) => {
    const user = await auth.getAccount(cookie(request.headers.cookie))
    if (!user) return reply.code(401).send(failure('UNAUTHENTICATED', 'Необходимо войти'))
    const orders = await db
      .collection<OrderDoc>('orders')
      .find({ accountId: user.id })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray()
    return { orders }
  })
  app.post('/api/orders/:id/complete', async (request, reply) => {
    const user = await auth.getAccount(cookie(request.headers.cookie))
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
    return { order: result }
  })
}

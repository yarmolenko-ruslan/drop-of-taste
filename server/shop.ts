import { randomUUID } from 'node:crypto'
import type { Db, MongoClient } from 'mongodb'
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import type { AuthService } from './auth/service.ts'
import { readSessionToken } from './auth/session-cookie.ts'
import type { CatalogDoc } from './catalog/template.ts'
import { addressDetailsSchema } from '../shared/validation/address.ts'
import { createOriginChecker } from './origins.ts'
import { getSiteContent } from './site-content.ts'
import type { PaymentGateway, YooPayment } from './yookassa.ts'
import { bonusCodeDiscount, normalizeBonusCode, type BonusCode } from '../shared/bonus-code.ts'
import { pickupDiscountPercent } from '../shared/promotion.ts'

const lineSchema = z
  .object({
    productId: z.string().min(1).max(100),
    quantity: z.number().int().min(1).max(99),
    extras: z.array(z.object({ name: z.string(), quantity: z.number().int().min(1) })).default([]),
  })
  .strict()
const fulfillmentSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('pickup'), label: z.string().min(1).max(300) }).strict(),
  z
    .object({
      mode: z.literal('delivery'),
      label: z.string().min(5).max(300),
      details: addressDetailsSchema,
    })
    .strict(),
])
const checkoutSchema = z
  .object({
    lines: z.array(lineSchema).min(1).max(100),
    fulfillment: fulfillmentSchema,
    promoCode: z.string().trim().max(40).optional(),
  })
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
  fulfillmentStatus?: 'new' | 'preparing' | 'delivering' | 'completed'
  requiresPayment?: boolean
  fulfilledAt?: Date
  completedAt?: Date
  createdAt: Date
  payment?: {
    status: 'creating' | 'error' | 'pending' | 'succeeded' | 'canceled'
    attemptKey: string
    id?: string
    confirmationUrl?: string
    createdAt: Date
    updatedAt: Date
  }
}

function publicOrder(order: OrderDoc) {
  return {
    _id: order._id,
    input: order.input,
    quote: order.quote,
    status: order.status,
    fulfillmentStatus:
      order.fulfillmentStatus ?? (order.status === 'completed' ? 'completed' : 'new'),
    ...(order.fulfilledAt && { fulfilledAt: order.fulfilledAt }),
    createdAt: order.createdAt,
    ...(order.completedAt && { completedAt: order.completedAt }),
    paymentStatus: order.payment?.status ?? 'unpaid',
  }
}

function checkedPayment(payment: YooPayment, totalKopecks: number) {
  if (
    payment.amount.currency !== 'RUB' ||
    !/^\d+\.\d{2}$/.test(payment.amount.value) ||
    Number(payment.amount.value.replace('.', '')) !== totalKopecks ||
    !payment.test ||
    (payment.status === 'succeeded' && !payment.paid) ||
    (payment.status === 'canceled' && payment.paid)
  )
    throw new Error('PAYMENT_MISMATCH')
  return payment.status === 'succeeded' && payment.paid
    ? 'succeeded'
    : payment.status === 'canceled'
      ? 'canceled'
      : 'pending'
}

function safeConfirmationUrl(value: string | undefined) {
  if (!value) return undefined
  const url = new URL(value)
  if (url.protocol !== 'https:' || !/(^|\.)(yoomoney\.ru|yookassa\.ru)$/.test(url.hostname))
    throw new Error('INVALID_CONFIRMATION_URL')
  return url.toString()
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
  if (error instanceof Error && error.message === 'INVALID_PROMO_CODE')
    return failure('INVALID_PROMO_CODE', 'Бонус-код не найден или срок его действия истёк')
  if (error instanceof Error && error.message === 'PROMO_NOT_APPLICABLE')
    return failure('PROMO_NOT_APPLICABLE', 'Бонус-код не действует на комбо и наборы')
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
  const discountableSubtotalKopecks = lines.reduce(
    (sum, line) =>
      sum + (byId.get(line.productId)?.categoryId === 'combo' ? 0 : line.lineTotalKopecks),
    0,
  )
  const pickupPercent =
    input.fulfillment.mode === 'pickup'
      ? pickupDiscountPercent((await getSiteContent(db)).promotions)
      : 0
  const pickupDiscountKopecks = Math.round((discountableSubtotalKopecks * pickupPercent) / 100)
  const promoCode = input.promoCode ? normalizeBonusCode(input.promoCode) : undefined
  let promoDiscountKopecks = 0
  if (promoCode) {
    const code = await db.collection<BonusCode>('bonus_codes').findOne({ _id: promoCode })
    const discount = code && bonusCodeDiscount(code, discountableSubtotalKopecks)
    if (discount === null || discount === undefined) throw new Error('INVALID_PROMO_CODE')
    if (discountableSubtotalKopecks === 0) throw new Error('PROMO_NOT_APPLICABLE')
    promoDiscountKopecks = discount
  }
  const discountKopecks = promoDiscountKopecks >= pickupDiscountKopecks ? 0 : pickupDiscountKopecks
  if (discountKopecks) promoDiscountKopecks = 0
  const deliveryKopecks =
    input.fulfillment.mode === 'delivery' && subtotalKopecks < 150_000 ? 25_000 : 0
  return {
    lines,
    subtotalKopecks,
    discountableSubtotalKopecks,
    discountKopecks,
    promoCode,
    promoDiscountKopecks,
    deliveryKopecks,
    totalKopecks: subtotalKopecks - discountKopecks - promoDiscountKopecks + deliveryKopecks,
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
  await db
    .collection<OrderDoc>('orders')
    .createIndex({ fulfillmentStatus: 1, createdAt: -1, _id: -1 })
  await db.collection('addresses').createIndex({ accountId: 1 })
  await db.collection('payment_events').createIndex({ at: -1 })
}

export function registerShopRoutes(
  app: FastifyInstance,
  db: Db,
  _mongo: MongoClient,
  auth: AuthService,
  origins: readonly string[] = ['http://localhost:5173', 'http://127.0.0.1:5173'],
  secureCookies = false,
  gateway?: PaymentGateway,
) {
  const isOriginAllowed = createOriginChecker(origins)
  const paymentEvents = db.collection('payment_events')
  const logPayment = async (order: OrderDoc, status: string, paymentId?: string) => {
    const previous = order.payment?.status ?? 'unpaid'
    if (previous !== status) {
      try {
        await paymentEvents.insertOne({
          orderId: order._id,
          from: previous,
          status,
          paymentId,
          amountKopecks: order.quote.totalKopecks,
          at: new Date(),
        })
      } catch (error) {
        app.log.error({ error, orderId: order._id }, 'Cannot record payment event')
      }
    }
  }
  const updateVerifiedPayment = async (
    order: OrderDoc,
    status: 'pending' | 'succeeded' | 'canceled',
    paymentId: string,
  ) => {
    if (order.payment?.status === status) return status
    const result = await db.collection<OrderDoc>('orders').updateOne(
      {
        _id: order._id,
        accountId: order.accountId,
        'payment.id': paymentId,
        'payment.status': order.payment?.status,
      },
      { $set: { 'payment.status': status, 'payment.updatedAt': new Date() } },
    )
    if (result.matchedCount) {
      await logPayment(order, status, paymentId)
      return status
    }
    const latest = await db
      .collection<OrderDoc>('orders')
      .findOne({ _id: order._id, accountId: order.accountId })
    return latest?.payment?.status ?? status
  }
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
    if (
      parsed.data.fulfillment.mode === 'pickup' &&
      parsed.data.fulfillment.label !== (await getSiteContent(db)).address
    )
      return reply
        .code(409)
        .send(failure('ADDRESS_CHANGED', 'Адрес кафе изменился. Обновите страницу.'))
    try {
      return await calculateQuote(db, parsed.data)
    } catch (error) {
      return reply.code(400).send(quoteError(error))
    }
  })
  app.get('/api/checkout/config', async () => ({ testPaymentEnabled: Boolean(gateway) }))
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
    const input: Checkout = {
      lines: parsed.data.lines,
      fulfillment: parsed.data.fulfillment,
      ...(parsed.data.promoCode && { promoCode: normalizeBonusCode(parsed.data.promoCode) }),
    }
    const existing = await orders.findOne({ accountId: user.id, idempotencyKey: key })
    if (existing)
      return JSON.stringify(existing.input) === JSON.stringify(input)
        ? { order: publicOrder(existing) }
        : reply.code(409).send(failure('KEY_REUSED', 'Этот запрос уже использован'))
    if (
      input.fulfillment.mode === 'pickup' &&
      input.fulfillment.label !== (await getSiteContent(db)).address
    )
      return reply
        .code(409)
        .send(failure('ADDRESS_CHANGED', 'Адрес кафе изменился. Обновите страницу.'))
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
      fulfillmentStatus: 'new',
      requiresPayment: Boolean(gateway && quote.totalKopecks > 0),
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
  app.post('/api/orders/:id/pay', async (request, reply) => {
    if (!gateway)
      return reply
        .code(503)
        .send(failure('PAYMENT_NOT_CONFIGURED', 'Онлайн-оплата сейчас недоступна'))
    const user = await auth.getAccount(readSessionToken(request.headers.cookie, secureCookies))
    if (!user) return reply.code(401).send(failure('UNAUTHENTICATED', 'Войдите для оплаты'))
    const id = (request.params as { id: string }).id
    const orders = db.collection<OrderDoc>('orders')
    const order = await orders.findOne({ _id: id, accountId: user.id })
    if (!order) return reply.code(404).send(failure('NOT_FOUND', 'Заказ не найден'))
    if (order.quote.totalKopecks === 0)
      return reply.code(409).send(failure('PAYMENT_NOT_REQUIRED', 'Заказ не требует оплаты'))
    if (order.status !== 'test')
      return reply.code(409).send(failure('ORDER_FINISHED', 'Заказ уже завершён'))
    if (order.payment?.status === 'pending' && order.payment.confirmationUrl && order.payment.id) {
      try {
        const payment = await gateway.get(order.payment.id)
        if (payment.id !== order.payment.id) throw new Error('PAYMENT_MISMATCH')
        const status = checkedPayment(payment, order.quote.totalKopecks)
        const currentStatus = await updateVerifiedPayment(order, status, payment.id)
        return currentStatus === 'pending'
          ? { status: currentStatus, confirmationUrl: order.payment.confirmationUrl }
          : { status: currentStatus }
      } catch {
        return reply
          .code(502)
          .send(failure('PAYMENT_STATUS_UNAVAILABLE', 'Не удалось проверить оплату'))
      }
    }
    if (order.payment?.status === 'succeeded' || order.payment?.status === 'canceled')
      return reply.code(409).send(failure('PAYMENT_FINISHED', 'Для этого заказа оплата завершена'))
    if (
      order.payment?.status === 'creating' &&
      Date.now() - order.payment.updatedAt.getTime() < 30_000
    )
      return reply
        .code(409)
        .send(failure('PAYMENT_STARTING', 'Платёж создаётся. Повторите через несколько секунд'))
    if (
      order.payment &&
      Date.now() - (order.payment.createdAt ?? order.payment.updatedAt).getTime() >
        23 * 60 * 60 * 1000
    )
      return reply
        .code(409)
        .send(
          failure(
            'PAYMENT_RETRY_EXPIRED',
            'Время для повторной оплаты истекло. Оформите новый заказ',
          ),
        )
    const now = new Date()
    const createdAt = order.payment?.createdAt ?? now
    const claim = await orders.findOneAndUpdate(
      {
        _id: id,
        accountId: user.id,
        status: 'test',
        ...(order.payment
          ? { 'payment.status': order.payment.status, 'payment.updatedAt': order.payment.updatedAt }
          : { payment: { $exists: false } }),
      },
      { $set: { payment: { status: 'creating', attemptKey: id, createdAt, updatedAt: now } } },
      { returnDocument: 'after' },
    )
    if (!claim) return reply.code(409).send(failure('PAYMENT_STARTING', 'Платёж уже создаётся'))
    await logPayment(order, 'creating')
    try {
      const returnUrl = new URL(
        `/payment/return?orderId=${encodeURIComponent(id)}`,
        request.headers.origin ?? origins[0],
      ).toString()
      const payment = await gateway.create(id, order.quote.totalKopecks, returnUrl)
      const status = checkedPayment(payment, order.quote.totalKopecks)
      const confirmationUrl = safeConfirmationUrl(payment.confirmation?.confirmation_url)
      if (status === 'pending' && !confirmationUrl) throw new Error('INVALID_CONFIRMATION_URL')
      const updated = await orders.updateOne(
        { _id: id, accountId: user.id, 'payment.status': 'creating' },
        {
          $set: {
            payment: {
              status,
              attemptKey: id,
              id: payment.id,
              confirmationUrl,
              createdAt,
              updatedAt: new Date(),
            },
          },
        },
      )
      if (updated.matchedCount) await logPayment(claim, status, payment.id)
      return { status, confirmationUrl }
    } catch {
      const failed = await orders.updateOne(
        { _id: id, accountId: user.id, 'payment.status': 'creating' },
        { $set: { 'payment.status': 'error', 'payment.updatedAt': new Date() } },
      )
      if (failed.matchedCount) await logPayment(claim, 'error')
      return reply
        .code(502)
        .send(failure('PAYMENT_UNAVAILABLE', 'Не удалось начать оплату. Попробуйте ещё раз'))
    }
  })
  app.get('/api/orders/:id/payment', async (request, reply) => {
    const user = await auth.getAccount(readSessionToken(request.headers.cookie, secureCookies))
    if (!user)
      return reply.code(401).send(failure('UNAUTHENTICATED', 'Войдите для просмотра оплаты'))
    const id = (request.params as { id: string }).id
    const orders = db.collection<OrderDoc>('orders')
    const order = await orders.findOne({ _id: id, accountId: user.id })
    if (!order) return reply.code(404).send(failure('NOT_FOUND', 'Заказ не найден'))
    if (order.payment?.status === 'succeeded' || order.payment?.status === 'canceled')
      return { status: order.payment.status }
    if (!order.payment?.id || !gateway) return { status: order.payment?.status ?? 'unpaid' }
    try {
      const payment = await gateway.get(order.payment.id)
      if (payment.id !== order.payment.id) throw new Error('PAYMENT_MISMATCH')
      const status = checkedPayment(payment, order.quote.totalKopecks)
      return { status: await updateVerifiedPayment(order, status, payment.id) }
    } catch {
      return reply
        .code(502)
        .send(failure('PAYMENT_STATUS_UNAVAILABLE', 'Не удалось проверить оплату. Повторите позже'))
    }
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
    if (gateway) {
      const order = await db.collection<OrderDoc>('orders').findOne({ _id: id, accountId: user.id })
      if (!order) return reply.code(404).send(failure('NOT_FOUND', 'Заказ не найден'))
      if (order.quote.totalKopecks > 0 && order.payment?.status !== 'succeeded')
        return reply.code(409).send(failure('PAYMENT_REQUIRED', 'Сначала завершите оплату'))
    }
    const result = await db
      .collection<OrderDoc>('orders')
      .findOneAndUpdate(
        { _id: id, accountId: user.id, status: 'test' },
        { $set: { status: 'completed', completedAt: new Date() } },
        { returnDocument: 'after' },
      )
    if (!result) {
      const previous = await db
        .collection<OrderDoc>('orders')
        .findOne({ _id: id, accountId: user.id })
      if (previous?.status === 'completed' && previous.quote.totalKopecks === 0)
        return { order: publicOrder(previous) }
      return reply.code(404).send(failure('NOT_FOUND', 'Заказ не найден'))
    }
    return { order: publicOrder(result) }
  })
}

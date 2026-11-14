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
import { isPromotionActive } from '../shared/promotion.ts'
import { createPaymentReader, createPaymentStarter } from './payment-reader.ts'
import { paymentDeadline, PAYMENT_WINDOW_MS } from '../shared/order-payment.ts'
import { birthdayCelebrationYear } from '../shared/birthday.ts'

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
    birthdayDiscount: z.boolean().optional(),
  })
  .strict()
const orderSchema = checkoutSchema.extend({ expectedTotalKopecks: z.number().int().min(0) })
const orderStatusesSchema = z.object({
  ids: z.array(z.string().min(1).max(100)).min(1).max(200),
})
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
  canceledAt?: Date
  paymentCheckedAt?: Date
  birthdayClaimReleased?: boolean
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
    capturedAt?: Date
  }
}
type BirthdayClaim = {
  _id: string
  accountId: string
  year: number
  orderId: string
  state: 'reserved' | 'used'
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
    paymentExpiresAt: paymentDeadline(order),
    canceledAt: order.canceledAt ?? null,
    ...(order.completedAt && { completedAt: order.completedAt }),
    paymentStatus: order.payment?.status ?? 'unpaid',
    ...(order.payment?.capturedAt && { paymentCapturedAt: order.payment.capturedAt }),
  }
}

function checkedPayment(
  payment: YooPayment,
  totalKopecks: number,
): 'succeeded' | 'pending' | 'canceled' {
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
const MIN_DELIVERY_SUBTOTAL_KOPECKS = 50_000
const FREE_DELIVERY_SUBTOTAL_KOPECKS = 150_000
const DELIVERY_FEE_KOPECKS = 25_000

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
  if (error instanceof Error && error.message.startsWith('BIRTHDAY_')) {
    const messages: Record<string, string> = {
      BIRTHDAY_UNAVAILABLE: 'Скидка ко дню рождения сейчас недоступна',
      BIRTHDAY_DATE_REQUIRED: 'Укажите дату рождения в личном кабинете',
      BIRTHDAY_OUTSIDE_WINDOW: 'Скидка доступна за 3 дня до и 3 дня после дня рождения',
      BIRTHDAY_ALREADY_USED: 'Скидка этого года уже использована или ожидает оплаты',
      BIRTHDAY_NOT_APPLICABLE: 'Скидка не действует на комбо и наборы',
    }
    return failure(error.message, messages[error.message] ?? 'Скидка недоступна')
  }
  throw error
}

export async function calculateQuote(db: Db, input: Checkout, accountId?: string) {
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
  const promotions = (await getSiteContent(db)).promotions
  const pickupPercent = input.fulfillment.mode === 'pickup' ? pickupDiscountPercent(promotions) : 0
  const pickupDiscountKopecks = Math.round((discountableSubtotalKopecks * pickupPercent) / 100)
  let birthdayYear: number | undefined
  let birthdayPercent = 0
  let birthdayDiscountKopecks = 0
  if (input.birthdayDiscount) {
    const promotion = promotions.find((item) => item.id === 'birthday')
    if (!promotion || !isPromotionActive(promotion) || !(promotion.discountPercent ?? 10))
      throw new Error('BIRTHDAY_UNAVAILABLE')
    if (!accountId) throw new Error('BIRTHDAY_DATE_REQUIRED')
    const user = await db
      .collection<{ _id: string; birthday?: string }>('users')
      .findOne({ _id: accountId })
    if (!user?.birthday) throw new Error('BIRTHDAY_DATE_REQUIRED')
    const year = birthdayCelebrationYear(user.birthday)
    if (year === null) throw new Error('BIRTHDAY_OUTSIDE_WINDOW')
    if (discountableSubtotalKopecks === 0) throw new Error('BIRTHDAY_NOT_APPLICABLE')
    birthdayPercent = promotion.discountPercent ?? 10
    birthdayDiscountKopecks = Math.round((discountableSubtotalKopecks * birthdayPercent) / 100)
    birthdayYear = year
  }
  const promoCode = input.promoCode ? normalizeBonusCode(input.promoCode) : undefined
  let promoDiscountKopecks = 0
  if (promoCode) {
    const code = await db.collection<BonusCode>('bonus_codes').findOne({ _id: promoCode })
    const discount = code && bonusCodeDiscount(code, discountableSubtotalKopecks)
    if (discount === null || discount === undefined) throw new Error('INVALID_PROMO_CODE')
    if (discountableSubtotalKopecks === 0) throw new Error('PROMO_NOT_APPLICABLE')
    promoDiscountKopecks = discount
  }
  const best = Math.max(pickupDiscountKopecks, promoDiscountKopecks, birthdayDiscountKopecks)
  const useBirthday = birthdayDiscountKopecks > 0 && birthdayDiscountKopecks === best
  if (
    useBirthday &&
    accountId &&
    (await db
      .collection<BirthdayClaim>('birthday_claims')
      .findOne({ _id: `${accountId}:${birthdayYear}` }))
  )
    throw new Error('BIRTHDAY_ALREADY_USED')
  const discountKopecks =
    best === pickupDiscountKopecks && !useBirthday && best > promoDiscountKopecks ? best : 0
  if (discountKopecks || useBirthday) promoDiscountKopecks = 0
  const deliveryKopecks =
    input.fulfillment.mode === 'delivery' && subtotalKopecks < FREE_DELIVERY_SUBTOTAL_KOPECKS
      ? DELIVERY_FEE_KOPECKS
      : 0
  const adjustments: { label: string; amountKopecks: number }[] = []
  if (discountKopecks > 0)
    adjustments.push({
      label: `Скидка за самовывоз (${pickupPercent}%)`,
      amountKopecks: -discountKopecks,
    })
  if (promoDiscountKopecks > 0)
    adjustments.push({ label: `Бонус-код ${promoCode}`, amountKopecks: -promoDiscountKopecks })
  if (useBirthday)
    adjustments.push({
      label: `Скидка ко дню рождения (${birthdayPercent}%)`,
      amountKopecks: -birthdayDiscountKopecks,
    })
  if (input.fulfillment.mode === 'delivery')
    adjustments.push({ label: 'Доставка', amountKopecks: deliveryKopecks })
  return {
    lines,
    subtotalKopecks,
    discountableSubtotalKopecks,
    discountKopecks,
    promoCode,
    promoDiscountKopecks,
    birthdayDiscountKopecks: useBirthday ? birthdayDiscountKopecks : 0,
    ...(useBirthday && { birthdayYear, birthdayPercent }),
    deliveryKopecks,
    adjustments,
    totalKopecks:
      subtotalKopecks -
      discountKopecks -
      promoDiscountKopecks -
      (useBirthday ? birthdayDiscountKopecks : 0) +
      deliveryKopecks,
    eligible:
      input.fulfillment.mode === 'pickup' || subtotalKopecks >= MIN_DELIVERY_SUBTOTAL_KOPECKS,
    minimumOrderMessage: `Для доставки нужно минимум ${MIN_DELIVERY_SUBTOTAL_KOPECKS / 100} ₽ блюд.`,
    deliveryTerms: `Минимум ${MIN_DELIVERY_SUBTOTAL_KOPECKS / 100} ₽ и бесплатная доставка от ${(FREE_DELIVERY_SUBTOTAL_KOPECKS / 100).toLocaleString('ru-RU')} ₽ считаются по стоимости блюд до скидок.`,
    testMode: true,
  }
}

async function processOrderBatch(
  orders: AsyncIterable<OrderDoc>,
  action: (order: OrderDoc) => Promise<void>,
) {
  // Запрос ограничен 100/200 документами; закрываем курсор до изменений этих документов.
  const found: OrderDoc[] = []
  for await (const order of orders) found.push(order)
  for (let index = 0; index < found.length; index += 4) {
    const results = await Promise.allSettled(found.slice(index, index + 4).map(action))
    const failed = results.find((result) => result.status === 'rejected')
    if (failed?.status === 'rejected') throw failed.reason
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
  await db
    .collection<OrderDoc>('orders')
    .createIndex({ canceledAt: 1, status: 1, createdAt: 1, _id: 1 })
  await db
    .collection<OrderDoc>('orders')
    .createIndex({ 'payment.status': 1, paymentCheckedAt: 1, _id: 1 })
  await db.collection('addresses').createIndex({ accountId: 1 })
  await db.collection('payment_events').createIndex({ at: -1 })
  await db
    .collection<BirthdayClaim>('birthday_claims')
    .createIndex({ accountId: 1, year: 1 }, { unique: true })
}

export function registerShopRoutes(
  app: FastifyInstance,
  db: Db,
  mongo: MongoClient,
  auth: AuthService,
  origins: readonly string[] = ['http://localhost:5173', 'http://127.0.0.1:5173'],
  secureCookies = false,
  gateway?: PaymentGateway,
) {
  const readPayment = gateway ? createPaymentReader(gateway) : undefined
  const startPayment = gateway ? createPaymentStarter(gateway) : undefined
  const requiresOnlinePayment = (order: OrderDoc) =>
    order.quote.totalKopecks > 0 && (order.requiresPayment ?? Boolean(order.payment || gateway))
  const paymentExpired = (order: OrderDoc) =>
    requiresOnlinePayment(order) &&
    order.status === 'test' &&
    (!order.fulfillmentStatus || order.fulfillmentStatus === 'new') &&
    !['succeeded', 'canceled'].includes(order.payment?.status ?? '') &&
    order.createdAt.getTime() + PAYMENT_WINDOW_MS <= Date.now()
  const isOriginAllowed = createOriginChecker(origins)
  const paymentEvents = db.collection('payment_events')
  const syncBirthdayClaim = async (
    order: OrderDoc,
    status: 'succeeded' | 'canceled' | 'pending',
  ) => {
    if (order.quote.birthdayYear === undefined) return
    const filter = { _id: `${order.accountId}:${order.quote.birthdayYear}`, orderId: order._id }
    const claims = db.collection<BirthdayClaim>('birthday_claims')
    if (status === 'succeeded') await claims.updateOne(filter, { $set: { state: 'used' } })
    if (status === 'canceled') {
      await claims.deleteOne({ ...filter, state: 'reserved' })
      await db
        .collection<OrderDoc>('orders')
        .updateOne({ _id: order._id }, { $set: { birthdayClaimReleased: true } })
    }
  }
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
    capturedAt?: string,
  ) => {
    if (order.payment?.status === 'succeeded' || order.payment?.status === 'canceled') {
      await syncBirthdayClaim(order, order.payment.status)
      return order.payment.status
    }
    if (order.payment?.status === status) {
      await syncBirthdayClaim(order, status)
      return status
    }
    const deadline = paymentDeadline(order)
    const knownCapture = status === 'succeeded' && capturedAt && deadline
    const timely = Boolean(knownCapture && Date.parse(capturedAt!) < Date.parse(deadline!))
    const late = Boolean(
      knownCapture &&
      !timely &&
      order.status === 'test' &&
      (!order.fulfillmentStatus || order.fulfillmentStatus === 'new'),
    )
    const result = await db.collection<OrderDoc>('orders').findOneAndUpdate(
      {
        _id: order._id,
        accountId: order.accountId,
        'payment.id': paymentId,
        'payment.status': order.payment?.status,
      },
      {
        $set: {
          'payment.status': status,
          'payment.updatedAt': new Date(),
          ...(knownCapture && { 'payment.capturedAt': new Date(capturedAt!) }),
          ...(late && { canceledAt: new Date(deadline!) }),
        },
        // Задержка получения ответа не превращает оплату вовремя в позднюю.
        ...(timely && { $unset: { canceledAt: '' as const } }),
      },
      { returnDocument: 'after' },
    )
    if (result) {
      await logPayment(order, status, paymentId)
      if (result.canceledAt && status === 'succeeded')
        app.log.error(
          { orderId: order._id, paymentId },
          'Payment succeeded after order cancellation; refund review required',
        )
      await syncBirthdayClaim(order, status)
      return status
    }
    const latest = await db
      .collection<OrderDoc>('orders')
      .findOne({ _id: order._id, accountId: order.accountId })
    return latest?.payment?.status ?? status
  }
  // Отмена заказа не подменяет фактический статус платежа в ЮKassa.
  const expireUnpaidOrders = async (accountId?: string, ids?: readonly string[]) => {
    const orders = db.collection<OrderDoc>('orders')
    const candidates = orders.find(
      {
        ...(accountId && { accountId }),
        ...(ids && { _id: { $in: [...ids] } }),
        status: 'test',
        fulfillmentStatus: { $nin: ['preparing', 'delivering', 'completed'] },
        canceledAt: { $exists: false },
        'quote.totalKopecks': { $gt: 0 },
        'payment.status': { $nin: ['succeeded', 'canceled'] },
        createdAt: { $lte: new Date(Date.now() - PAYMENT_WINDOW_MS) },
        ...(gateway
          ? { requiresPayment: { $ne: false } }
          : {
              $or: [
                { requiresPayment: true },
                { requiresPayment: { $exists: false }, payment: { $exists: true } },
              ],
            }),
      },
      { limit: ids ? ids.length : 100, sort: { createdAt: 1, _id: 1 } },
    )
    await processOrderBatch(candidates, async (order) => {
      if (order.payment?.id && gateway) {
        try {
          const payment = await readPayment!(order.payment.id)
          if (payment.id !== order.payment.id) throw new Error('PAYMENT_MISMATCH')
          const status = await updateVerifiedPayment(
            order,
            checkedPayment(payment, order.quote.totalKopecks),
            payment.id,
            payment.captured_at,
          )
          if (status === 'succeeded' || status === 'canceled') return
        } catch (error) {
          // При недоступности провайдера заказ отменяем, но сохраняем платёж для сверки.
          app.log.warn({ error, orderId: order._id }, 'Cannot verify expiring payment')
        }
      }
      const result = await orders.updateOne(
        {
          _id: order._id,
          status: 'test',
          canceledAt: { $exists: false },
          fulfillmentStatus: { $nin: ['preparing', 'delivering', 'completed'] },
          'payment.status': { $nin: ['succeeded', 'canceled'] },
          ...(order.payment
            ? { 'payment.updatedAt': order.payment.updatedAt }
            : { payment: { $exists: false } }),
        },
        { $set: { canceledAt: new Date(paymentDeadline(order)!) } },
      )
      if (result.modifiedCount) {
        if (!order.payment) await syncBirthdayClaim(order, 'canceled')
        await logPayment(order, 'order_canceled', order.payment?.id)
      }
    })
  }
  const reconcileCanceledPayments = async () => {
    if (!gateway) return
    await processOrderBatch(
      db.collection<OrderDoc>('orders').find(
        {
          canceledAt: { $exists: true },
          'payment.id': { $exists: true },
          'payment.status': { $in: ['creating', 'error', 'pending'] },
        },
        { limit: 100, sort: { paymentCheckedAt: 1, _id: 1 } },
      ),
      async (order) => {
        try {
          const payment = await readPayment!(order.payment!.id!)
          if (payment.id !== order.payment!.id) throw new Error('PAYMENT_MISMATCH')
          await updateVerifiedPayment(
            order,
            checkedPayment(payment, order.quote.totalKopecks),
            payment.id,
            payment.captured_at,
          )
        } catch (error) {
          app.log.warn({ error, orderId: order._id }, 'Cannot reconcile canceled order payment')
        } finally {
          await db
            .collection<OrderDoc>('orders')
            .updateOne({ _id: order._id }, { $set: { paymentCheckedAt: new Date() } })
        }
      },
    )
  }
  // Повторяем освобождение после сбоя БД между отменой заказа и удалением резерва.
  const releaseCanceledBirthdayClaims = async () => {
    await processOrderBatch(
      db.collection<OrderDoc>('orders').find(
        {
          'quote.birthdayYear': { $exists: true },
          birthdayClaimReleased: { $ne: true },
          $or: [
            { 'payment.status': 'canceled' },
            { canceledAt: { $exists: true }, payment: { $exists: false } },
          ],
        },
        { limit: 100 },
      ),
      async (order) => {
        await syncBirthdayClaim(order, 'canceled')
      },
    )
  }
  const expirationRuns = new Map<string, Promise<void>>()
  const expireOrders = (accountId?: string, ids?: readonly string[]) => {
    const key = JSON.stringify([accountId, ids ? [...ids].sort() : null])
    const running = expirationRuns.get(key)
    if (running) return running
    const run = expireUnpaidOrders(accountId, ids).finally(() => {
      expirationRuns.delete(key)
    })
    expirationRuns.set(key, run)
    return run
  }
  let expirationTimer: ReturnType<typeof setInterval> | undefined
  let backgroundRun: Promise<void> | undefined
  const runBackground = () => {
    backgroundRun ??= expireOrders()
      .then(reconcileCanceledPayments)
      .then(releaseCanceledBirthdayClaims)
      .catch((error) => app.log.error({ error }, 'Cannot expire unpaid orders'))
      .finally(() => {
        backgroundRun = undefined
      })
  }
  app.addHook('onReady', async () => {
    runBackground()
    expirationTimer = setInterval(runBackground, 5_000)
    expirationTimer.unref()
  })
  app.addHook('onClose', async () => {
    clearInterval(expirationTimer)
    await backgroundRun
    await Promise.allSettled(expirationRuns.values())
  })
  // Администратор уже проверен в onRequest. Не сканируем все заказы при чтении истории.
  app.addHook('preHandler', async (request) => {
    if (request.method === 'GET' && request.routeOptions.url === '/api/admin/clients/:id')
      await expireOrders((request.params as { id: string }).id)
  })
  const expireBirthdayReservations = async (accountId: string) => {
    const claims = await db
      .collection<BirthdayClaim>('birthday_claims')
      .find({ accountId, state: 'reserved' })
      .toArray()
    for (const claim of claims) {
      const order = await db
        .collection<OrderDoc>('orders')
        .findOne({ _id: claim.orderId, accountId })
      if (!order || Date.now() - order.createdAt.getTime() < 23 * 60 * 60 * 1000) continue
      if (order.payment?.status === 'canceled' || order.payment?.status === 'succeeded') {
        await syncBirthdayClaim(order, order.payment.status)
      } else if (
        !order.payment &&
        (!order.fulfillmentStatus || order.fulfillmentStatus === 'new')
      ) {
        const result = await db.collection<OrderDoc>('orders').updateOne(
          {
            _id: order._id,
            accountId,
            payment: { $exists: false },
            status: 'test',
            fulfillmentStatus: { $nin: ['preparing', 'delivering', 'completed'] },
          },
          {
            $set: {
              payment: {
                status: 'canceled',
                attemptKey: order._id,
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            },
          },
        )
        if (result.matchedCount) await syncBirthdayClaim(order, 'canceled')
      } else if (order.payment?.id && gateway) {
        try {
          const payment = await readPayment!(order.payment.id)
          if (payment.id !== order.payment.id) continue
          const status = checkedPayment(payment, order.quote.totalKopecks)
          await updateVerifiedPayment(order, status, order.payment.id, payment.captured_at)
        } catch (error) {
          app.log.warn({ error, orderId: order._id }, 'Cannot expire birthday reservation')
        }
      }
      // Неизвестный результат создания платежа остаётся заблокированным до проверки.
    }
  }
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/checkout/') && !request.url.startsWith('/api/orders')) return
    reply.header('Cache-Control', 'no-store')
    if (request.method === 'POST' && !isOriginAllowed(request.headers.origin))
      return reply.code(403).send(failure('INVALID_ORIGIN', 'Запрос отклонён'))
    const expectedAccountId = request.headers['x-account-id']
    if (expectedAccountId !== undefined) {
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
      const user = await auth.getAccount(readSessionToken(request.headers.cookie, secureCookies))
      if (parsed.data.birthdayDiscount && user) {
        await expireOrders(user.id)
        await expireBirthdayReservations(user.id)
      }
      return await calculateQuote(db, parsed.data, user?.id)
    } catch (error) {
      return reply.code(400).send(quoteError(error))
    }
  })
  app.get('/api/checkout/config', async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    const account = await auth.getAccount(readSessionToken(request.headers.cookie, secureCookies))
    const user = account
      ? await db
          .collection<{ _id: string; birthday?: string }>('users')
          .findOne({ _id: account.id })
      : null
    const promotion = (await getSiteContent(db)).promotions.find((item) => item.id === 'birthday')
    return {
      testPaymentEnabled: Boolean(gateway),
      birthdayAvailable: Boolean(
        user?.birthday &&
        promotion &&
        isPromotionActive(promotion) &&
        (promotion.discountPercent ?? 10) > 0 &&
        birthdayCelebrationYear(user.birthday) !== null,
      ),
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
    if (parsed.data.birthdayDiscount) {
      await expireOrders(user.id)
      await expireBirthdayReservations(user.id)
    }
    const input: Checkout = {
      lines: parsed.data.lines,
      fulfillment: parsed.data.fulfillment,
      ...(parsed.data.promoCode && { promoCode: normalizeBonusCode(parsed.data.promoCode) }),
      ...(parsed.data.birthdayDiscount && { birthdayDiscount: true }),
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
      quote = await calculateQuote(db, input, user.id)
    } catch (error) {
      return reply
        .code(error instanceof Error && error.message === 'BIRTHDAY_ALREADY_USED' ? 409 : 400)
        .send(quoteError(error))
    }
    if (!quote.eligible)
      return reply.code(400).send(failure('MINIMUM_ORDER', quote.minimumOrderMessage))
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
      if (quote.birthdayYear !== undefined) {
        await mongo.withSession((session) =>
          session.withTransaction(async () => {
            const storedUser = await db
              .collection<{ _id: string; birthday?: string }>('users')
              .findOne({ _id: user.id }, { session })
            const currentPromotion = (await getSiteContent(db)).promotions.find(
              (promotion) => promotion.id === 'birthday',
            )
            if (
              !storedUser?.birthday ||
              birthdayCelebrationYear(storedUser.birthday) !== quote.birthdayYear ||
              !currentPromotion ||
              !isPromotionActive(currentPromotion) ||
              (currentPromotion.discountPercent ?? 10) !== quote.birthdayPercent
            )
              throw new Error('BIRTHDAY_CHANGED')
            // Уникальный _id гарантирует единственного владельца права даже при двух запросах.
            await db.collection<BirthdayClaim>('birthday_claims').insertOne(
              {
                _id: `${user.id}:${quote.birthdayYear}`,
                accountId: user.id,
                year: quote.birthdayYear!,
                orderId: order._id,
                state: 'reserved',
              },
              { session },
            )
            await orders.insertOne(order, { session })
          }),
        )
      } else await orders.insertOne(order)
    } catch (error) {
      if (error instanceof Error && error.message === 'BIRTHDAY_CHANGED')
        return reply
          .code(409)
          .send(
            failure('BIRTHDAY_CHANGED', 'Условия акции изменились. Рассчитайте заказ повторно.'),
          )
      if ((error as { code?: number }).code !== 11000) throw error
      const duplicate = await orders.findOne({ accountId: user.id, idempotencyKey: key })
      if (duplicate && JSON.stringify(duplicate.input) === JSON.stringify(input))
        return { order: publicOrder(duplicate) }
      if (quote.birthdayYear !== undefined)
        return reply.code(409).send(quoteError(new Error('BIRTHDAY_ALREADY_USED')))
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
    await expireOrders(user.id, [id])
    const order = await orders.findOne({ _id: id, accountId: user.id })
    if (!order) return reply.code(404).send(failure('NOT_FOUND', 'Заказ не найден'))
    if (order.canceledAt || paymentExpired(order))
      return reply.code(409).send(failure('ORDER_CANCELED', 'Время оплаты истекло. Заказ отменён'))
    if (order.requiresPayment === false || order.quote.totalKopecks === 0)
      return reply.code(409).send(failure('PAYMENT_NOT_REQUIRED', 'Заказ не требует оплаты'))
    if (order.status !== 'test' || (order.fulfillmentStatus && order.fulfillmentStatus !== 'new'))
      return reply.code(409).send(failure('ORDER_FINISHED', 'Заказ уже завершён'))
    if (
      order.quote.birthdayYear !== undefined &&
      Date.now() - order.createdAt.getTime() >= 23 * 60 * 60 * 1000
    )
      return reply
        .code(409)
        .send(failure('PAYMENT_RETRY_EXPIRED', 'Время оплаты истекло. Оформите новый заказ'))
    const refuseExpiredPayment = async () => {
      await expireOrders(user.id, [id])
      const latest = await orders.findOne({ _id: id, accountId: user.id })
      return !latest || Boolean(latest.canceledAt) || paymentExpired(latest)
    }
    if (order.payment?.status === 'pending' && order.payment.id && !order.payment.confirmationUrl) {
      try {
        const payment = await readPayment!(order.payment.id)
        if (payment.id !== order.payment.id) throw new Error('PAYMENT_MISMATCH')
        const status = await updateVerifiedPayment(
          order,
          checkedPayment(payment, order.quote.totalKopecks),
          payment.id,
          payment.captured_at,
        )
        if (await refuseExpiredPayment())
          return reply
            .code(409)
            .send(failure('ORDER_CANCELED', 'Время оплаты истекло. Заказ отменён'))
        return status === 'pending'
          ? reply
              .code(502)
              .send(
                failure(
                  'PAYMENT_CONFIRMATION_UNAVAILABLE',
                  'Страница оплаты недоступна. Проверьте статус заказа позже.',
                ),
              )
          : { status }
      } catch {
        return reply
          .code(502)
          .send(failure('PAYMENT_STATUS_UNAVAILABLE', 'Не удалось проверить оплату'))
      }
    }
    if (order.payment?.status === 'pending' && order.payment.confirmationUrl && order.payment.id) {
      try {
        const payment = await readPayment!(order.payment.id)
        if (payment.id !== order.payment.id) throw new Error('PAYMENT_MISMATCH')
        const status = checkedPayment(payment, order.quote.totalKopecks)
        const currentStatus = await updateVerifiedPayment(
          order,
          status,
          payment.id,
          payment.captured_at,
        )
        if (await refuseExpiredPayment())
          return reply
            .code(409)
            .send(failure('ORDER_CANCELED', 'Время оплаты истекло. Заказ отменён'))
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
        canceledAt: { $exists: false },
        createdAt: { $gt: new Date(Date.now() - PAYMENT_WINDOW_MS) },
        fulfillmentStatus: { $nin: ['preparing', 'delivering', 'completed'] },
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
        origins[0],
      ).toString()
      const payment = await startPayment!(id, order.quote.totalKopecks, returnUrl)
      const status = checkedPayment(payment, order.quote.totalKopecks)
      let confirmationUrl: string | undefined
      if (status === 'pending') {
        try {
          confirmationUrl = safeConfirmationUrl(payment.confirmation?.confirmation_url)
        } catch {
          /* сохраняем ID платежа для последующей проверки */
        }
      }
      const updated = await orders.updateOne(
        { _id: id, accountId: user.id, 'payment.status': 'creating', 'payment.updatedAt': now },
        {
          $set: {
            payment: {
              status,
              attemptKey: id,
              id: payment.id,
              confirmationUrl,
              createdAt,
              updatedAt: new Date(),
              ...(payment.captured_at && { capturedAt: new Date(payment.captured_at) }),
            },
            ...(status === 'succeeded' &&
              payment.captured_at &&
              Date.parse(payment.captured_at) >= Date.parse(paymentDeadline(order)!) && {
                canceledAt: new Date(paymentDeadline(order)!),
              }),
          },
          ...(status === 'succeeded' &&
            payment.captured_at &&
            Date.parse(payment.captured_at) < Date.parse(paymentDeadline(order)!) && {
              $unset: { canceledAt: '' as const },
            }),
        },
      )
      if (!updated.matchedCount) {
        // Ответ старой попытки не меняет новую, но известный ID нельзя потерять:
        // по нему сервер сможет сверить списание даже при отказе следующего create.
        await orders.updateOne(
          {
            _id: id,
            accountId: user.id,
            'payment.status': { $in: ['creating', 'error'] },
            'payment.id': { $exists: false },
          },
          {
            $set: {
              'payment.id': payment.id,
              ...(confirmationUrl && { 'payment.confirmationUrl': confirmationUrl }),
            },
          },
        )
        return reply
          .code(409)
          .send(
            failure(
              'PAYMENT_STARTING',
              'Статус оплаты обновляется. Проверьте заказ в личном кабинете',
            ),
          )
      }
      if (updated.matchedCount) {
        await logPayment(claim, status, payment.id)
        try {
          await syncBirthdayClaim(claim, status)
        } catch (error) {
          // Платёж уже записан; его статус нельзя затирать ошибкой синхронизации акции.
          app.log.error({ error, orderId: id }, 'Cannot synchronize birthday claim')
        }
      }
      await expireOrders(user.id, [id])
      const latest = await orders.findOne({ _id: id, accountId: user.id })
      if (latest?.canceledAt)
        return reply
          .code(409)
          .send(failure('ORDER_CANCELED', 'Время оплаты истекло. Заказ отменён'))
      if (status === 'pending' && !confirmationUrl)
        return reply
          .code(502)
          .send(
            failure(
              'PAYMENT_CONFIRMATION_UNAVAILABLE',
              'Страница оплаты недоступна. Проверьте статус заказа позже.',
            ),
          )
      return { status, confirmationUrl }
    } catch (error) {
      if (error instanceof Error && error.message === 'PAYMENT_CREATION_BUSY') {
        // Этот create не отправлялся провайдеру. Восстанавливаем прежнее состояние,
        // не превращая отсутствие платежа в неизвестный результат и вечный резерв.
        const restored = await orders.updateOne(
          { _id: id, accountId: user.id, 'payment.status': 'creating', 'payment.updatedAt': now },
          order.payment
            ? { $set: { 'payment.status': order.payment.status, 'payment.updatedAt': now } }
            : { $unset: { payment: '' } },
        )
        if (restored.matchedCount) await logPayment(claim, order.payment?.status ?? 'unpaid')
        return reply
          .header('Retry-After', '1')
          .code(503)
          .send(failure('PAYMENT_BUSY', 'Сервис оплаты занят. Повторите через несколько секунд'))
      }
      const failed = await orders.updateOne(
        { _id: id, accountId: user.id, 'payment.status': 'creating', 'payment.updatedAt': now },
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
    await expireOrders(user.id, [id])
    const order = await orders.findOne({ _id: id, accountId: user.id })
    if (!order) return reply.code(404).send(failure('NOT_FOUND', 'Заказ не найден'))
    if (order.payment?.status === 'succeeded' || order.payment?.status === 'canceled') {
      await syncBirthdayClaim(order, order.payment.status)
      return {
        status: order.payment.status,
        ...(order.payment.capturedAt && { paymentCapturedAt: order.payment.capturedAt }),
        ...(order.canceledAt && { orderCanceled: true, canceledAt: order.canceledAt }),
      }
    }
    if (!order.payment?.id || !gateway)
      return {
        status: order.canceledAt ? 'canceled' : (order.payment?.status ?? 'unpaid'),
        ...(order.canceledAt && { orderCanceled: true, canceledAt: order.canceledAt }),
      }
    try {
      const payment = await readPayment!(order.payment.id)
      if (payment.id !== order.payment.id) throw new Error('PAYMENT_MISMATCH')
      const status = checkedPayment(payment, order.quote.totalKopecks)
      const verifiedStatus = await updateVerifiedPayment(
        order,
        status,
        payment.id,
        payment.captured_at,
      )
      await expireOrders(user.id, [id])
      const latest = await orders.findOne({ _id: id, accountId: user.id })
      return {
        status: verifiedStatus,
        ...(latest?.payment?.capturedAt && { paymentCapturedAt: latest.payment.capturedAt }),
        ...(latest?.canceledAt && { orderCanceled: true, canceledAt: latest.canceledAt }),
      }
    } catch {
      return reply
        .code(502)
        .send(failure('PAYMENT_STATUS_UNAVAILABLE', 'Не удалось проверить оплату. Повторите позже'))
    }
  })
  app.post('/api/orders/:id/cancel', async (request, reply) => {
    const user = await auth.getAccount(readSessionToken(request.headers.cookie, secureCookies))
    if (!user) return reply.code(401).send(failure('UNAUTHENTICATED', 'Необходимо войти'))
    const id = (request.params as { id: string }).id
    await expireOrders(user.id, [id])
    const order = await db.collection<OrderDoc>('orders').findOne({
      _id: id,
      accountId: user.id,
    })
    if (!order) return reply.code(404).send(failure('NOT_FOUND', 'Заказ не найден'))
    if (order.status !== 'test' || order.payment?.status === 'succeeded')
      return reply.code(409).send(failure('ORDER_FINISHED', 'Оплаченный заказ нельзя отменить'))
    if (order.payment?.status === 'canceled') {
      await syncBirthdayClaim(order, 'canceled')
      return { status: 'canceled' }
    }
    if (order.payment?.id && gateway) {
      try {
        const payment = await readPayment!(order.payment.id)
        if (payment.id !== order.payment.id) throw new Error('PAYMENT_MISMATCH')
        const status = checkedPayment(payment, order.quote.totalKopecks)
        const verifiedStatus = await updateVerifiedPayment(
          order,
          status,
          order.payment.id,
          payment.captured_at,
        )
        if (verifiedStatus === 'pending')
          return reply
            .code(409)
            .send(
              failure(
                'PAYMENT_PENDING',
                'Платёж ещё ожидает завершения. Скидка пока зарезервирована.',
              ),
            )
        if (verifiedStatus !== 'canceled')
          return reply.code(409).send(failure('PAYMENT_FINISHED', 'Заказ уже оплачен'))
        return { status: verifiedStatus }
      } catch {
        return reply
          .code(502)
          .send(failure('PAYMENT_STATUS_UNAVAILABLE', 'Не удалось проверить платёж'))
      }
    }
    // При неизвестном результате создания платежа освобождать резерв нельзя.
    if (order.payment)
      return reply
        .code(409)
        .send(failure('PAYMENT_STATUS_UNAVAILABLE', 'Статус оплаты нужно уточнить'))
    if (order.fulfillmentStatus && order.fulfillmentStatus !== 'new')
      return reply.code(409).send(failure('ORDER_FINISHED', 'Заказ уже готовится'))
    const result = await db.collection<OrderDoc>('orders').updateOne(
      {
        _id: order._id,
        accountId: user.id,
        payment: { $exists: false },
        status: 'test',
        fulfillmentStatus: { $nin: ['preparing', 'delivering', 'completed'] },
      },
      {
        $set: {
          payment: {
            status: 'canceled',
            attemptKey: order._id,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
      },
    )
    if (!result.matchedCount)
      return reply.code(409).send(failure('PAYMENT_STARTING', 'Статус заказа изменился'))
    await syncBirthdayClaim(order, 'canceled')
    return { status: 'canceled' }
  })
  app.get('/api/orders', async (request, reply) => {
    const user = await auth.getAccount(readSessionToken(request.headers.cookie, secureCookies))
    if (!user) return reply.code(401).send(failure('UNAUTHENTICATED', 'Необходимо войти'))
    const { cursor } = request.query as { cursor?: string }
    const or = parseOrdersCursor(cursor)
    if (or === 'invalid')
      return reply.code(400).send(failure('INVALID_CURSOR', 'Проверьте параметры запроса'))
    await expireOrders(user.id)
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
  app.post('/api/orders/statuses', async (request, reply) => {
    const user = await auth.getAccount(readSessionToken(request.headers.cookie, secureCookies))
    if (!user) return reply.code(401).send(failure('UNAUTHENTICATED', 'Необходимо войти'))
    const parsed = orderStatusesSchema.safeParse(request.body)
    if (!parsed.success)
      return reply.code(400).send(failure('INVALID_BODY', 'Проверьте список заказов'))
    await expireOrders(user.id, [...new Set(parsed.data.ids)])
    const orders = await db
      .collection<OrderDoc>('orders')
      .find({ accountId: user.id, _id: { $in: [...new Set(parsed.data.ids)] } })
      .project<OrderDoc>({
        _id: 1,
        status: 1,
        fulfillmentStatus: 1,
        payment: 1,
        completedAt: 1,
        fulfilledAt: 1,
        canceledAt: 1,
      })
      .toArray()
    return {
      statuses: orders.map((order) => ({
        _id: order._id,
        status: order.status,
        fulfillmentStatus:
          order.fulfillmentStatus ?? (order.status === 'completed' ? 'completed' : 'new'),
        paymentStatus: order.payment?.status ?? 'unpaid',
        ...(order.payment?.capturedAt && { paymentCapturedAt: order.payment.capturedAt }),
        canceledAt: order.canceledAt ?? null,
        completedAt: order.completedAt ?? null,
        fulfilledAt: order.fulfilledAt ?? null,
      })),
    }
  })
  app.post('/api/orders/:id/complete', async (request, reply) => {
    const user = await auth.getAccount(readSessionToken(request.headers.cookie, secureCookies))
    if (!user) return reply.code(401).send(failure('UNAUTHENTICATED', 'Необходимо войти'))
    const id = (request.params as { id: string }).id
    await expireOrders(user.id, [id])
    const existing = await db
      .collection<OrderDoc>('orders')
      .findOne({ _id: id, accountId: user.id })
    if (!existing) return reply.code(404).send(failure('NOT_FOUND', 'Заказ не найден'))
    if (existing.canceledAt || existing.payment?.status === 'canceled')
      return reply.code(409).send(failure('ORDER_CANCELED', 'Заказ отменён'))
    if (requiresOnlinePayment(existing)) {
      if (existing.payment?.status !== 'succeeded')
        return reply.code(409).send(failure('PAYMENT_REQUIRED', 'Сначала завершите оплату'))
    }
    const result = await db.collection<OrderDoc>('orders').findOneAndUpdate(
      {
        _id: id,
        accountId: user.id,
        status: 'test',
        canceledAt: { $exists: false },
        ...(requiresOnlinePayment(existing)
          ? { 'payment.status': 'succeeded' }
          : { payment: { $exists: false } }),
      },
      { $set: { status: 'completed', completedAt: new Date() } },
      { returnDocument: 'after' },
    )
    if (!result) {
      const previous = await db
        .collection<OrderDoc>('orders')
        .findOne({ _id: id, accountId: user.id })
      if (previous?.status === 'completed' && previous.quote.totalKopecks === 0) {
        await syncBirthdayClaim(previous, 'succeeded')
        return { order: publicOrder(previous) }
      }
      return reply.code(404).send(failure('NOT_FOUND', 'Заказ не найден'))
    }
    if (result.quote.birthdayYear !== undefined) await syncBirthdayClaim(result, 'succeeded')
    return { order: publicOrder(result) }
  })
}

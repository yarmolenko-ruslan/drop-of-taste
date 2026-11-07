import { randomUUID } from 'node:crypto'
import type { Db, MongoClient } from 'mongodb'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AuthService } from './auth/service.ts'
import { readSessionToken } from './auth/session-cookie.ts'
import { addressDetailsSchema } from '../shared/validation/address.ts'
import {
  birthdayStringSchema,
  emailSchema,
  isRealBirthday,
  nameSchema,
} from '../shared/validation/profile.ts'
import { createOriginChecker } from './origins.ts'

const notificationSchema = z
  .object({ push: z.boolean(), email: z.boolean(), sms: z.boolean() })
  .strict()
const profileSchema = z
  .object({
    name: nameSchema,
    email: emailSchema,
    birthday: birthdayStringSchema,
    notifications: notificationSchema,
  })
  .strict()
const addressSchema = z
  .object({ label: z.string().trim().min(5).max(300), details: addressDetailsSchema })
  .strict()
const selectionSchema = z.object({ addressId: z.string().min(1).max(100).nullable() }).strict()
type Profile = z.infer<typeof profileSchema>
type AddressDoc = {
  _id: string
  accountId: string
  label: string
  details: z.infer<typeof addressDetailsSchema>
}
type UserDoc = Profile & {
  _id: string
  id: string
  phone: string
  selectedAddressId?: string | null
}
const defaults: Profile = {
  name: '',
  email: '',
  birthday: '',
  notifications: { push: false, email: false, sms: false },
}
const err = (code: string, message: string) => ({ error: { code, message } })
export function registerProfileRoutes(
  app: FastifyInstance,
  db: Db,
  mongo: MongoClient,
  auth: AuthService,
  origins: readonly string[] = ['http://localhost:5173', 'http://127.0.0.1:5173'],
  secureCookies = false,
) {
  const users = db.collection<UserDoc>('users')
  const addresses = db.collection<AddressDoc>('addresses')
  const isOriginAllowed = createOriginChecker(origins)
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/profile') && !request.url.startsWith('/api/addresses')) return
    reply.header('Cache-Control', 'no-store')
    if (
      ['POST', 'PUT', 'DELETE'].includes(request.method) &&
      !isOriginAllowed(request.headers.origin)
    )
      return reply.code(403).send(err('INVALID_ORIGIN', 'Запрос отклонён'))
    const expectedAccountId = request.headers['x-account-id']
    if (expectedAccountId !== undefined) {
      const account = await auth.getAccount(readSessionToken(request.headers.cookie, secureCookies))
      if (!account) return reply.code(401).send(err('UNAUTHENTICATED', 'Необходимо войти'))
      if (expectedAccountId !== account.id)
        return reply.code(409).send(err('ACCOUNT_CHANGED', 'Аккаунт изменился. Обновите страницу.'))
    }
  })
  app.get('/api/profile', async (request, reply) => {
    const account = await auth.getAccount(readSessionToken(request.headers.cookie, secureCookies))
    if (!account) return reply.code(401).send(err('UNAUTHENTICATED', 'Необходимо войти'))
    const doc = await users.findOne({ _id: account.id })
    return {
      profile: {
        ...defaults,
        name: doc?.name ?? '',
        email: doc?.email ?? '',
        birthday: doc?.birthday ?? '',
        notifications: doc?.notifications ?? defaults.notifications,
        phone: account.phone,
        selectedAddressId: doc?.selectedAddressId ?? null,
      },
    }
  })
  app.put('/api/profile', async (request, reply) => {
    const account = await auth.getAccount(readSessionToken(request.headers.cookie, secureCookies))
    if (!account) return reply.code(401).send(err('UNAUTHENTICATED', 'Необходимо войти'))
    const parsed = profileSchema.safeParse(request.body)
    if (!parsed.success)
      return reply.code(400).send(err('INVALID_PROFILE', 'Проверьте данные профиля'))
    if (parsed.data.birthday && !isRealBirthday(parsed.data.birthday)) {
      return reply.code(400).send(err('INVALID_BIRTHDAY', 'Проверьте дату рождения'))
    }
    if (parsed.data.notifications.email && !parsed.data.email)
      return reply.code(400).send(err('EMAIL_REQUIRED', 'Укажите почту для уведомлений по email'))
    await users.updateOne({ _id: account.id }, { $set: parsed.data })
    return { profile: { ...parsed.data, phone: account.phone } }
  })
  app.put('/api/profile/notifications', async (request, reply) => {
    const account = await auth.getAccount(readSessionToken(request.headers.cookie, secureCookies))
    if (!account) return reply.code(401).send(err('UNAUTHENTICATED', 'Необходимо войти'))
    const parsed = notificationSchema.safeParse(request.body)
    if (!parsed.success)
      return reply.code(400).send(err('INVALID_NOTIFICATIONS', 'Проверьте настройки'))
    if (parsed.data.email && !(await users.findOne({ _id: account.id }))?.email)
      return reply
        .code(400)
        .send(err('EMAIL_REQUIRED', 'Сначала сохраните адрес электронной почты'))
    await users.updateOne({ _id: account.id }, { $set: { notifications: parsed.data } })
    return { notifications: parsed.data }
  })
  app.put('/api/profile/delivery-selection', async (request, reply) => {
    const account = await auth.getAccount(readSessionToken(request.headers.cookie, secureCookies))
    if (!account) return reply.code(401).send(err('UNAUTHENTICATED', 'Необходимо войти'))
    const parsed = selectionSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(err('INVALID_SELECTION', 'Проверьте данные'))
    const { addressId } = parsed.data
    const found = await mongo.withSession((session) =>
      session.withTransaction(async () => {
        if (addressId !== null) {
          const address = await addresses.findOne(
            { _id: addressId, accountId: account.id },
            { session },
          )
          if (!address) return false
        }
        await users.updateOne(
          { _id: account.id },
          { $set: { selectedAddressId: addressId } },
          { session },
        )
        return true
      }),
    )
    if (!found) return reply.code(404).send(err('NOT_FOUND', 'Адрес не найден'))
    return { selectedAddressId: addressId }
  })
  app.get('/api/addresses', async (request, reply) => {
    const account = await auth.getAccount(readSessionToken(request.headers.cookie, secureCookies))
    if (!account) return reply.code(401).send(err('UNAUTHENTICATED', 'Необходимо войти'))
    const items = await addresses.find({ accountId: account.id }).toArray()
    return {
      addresses: items.map(({ _id, label, details }) => ({
        id: _id,
        mode: 'delivery',
        label,
        details,
      })),
    }
  })
  app.post('/api/addresses', async (request, reply) => {
    const account = await auth.getAccount(readSessionToken(request.headers.cookie, secureCookies))
    if (!account) return reply.code(401).send(err('UNAUTHENTICATED', 'Необходимо войти'))
    const parsed = addressSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(err('INVALID_ADDRESS', 'Проверьте адрес'))
    const doc: AddressDoc = { _id: randomUUID(), accountId: account.id, ...parsed.data }
    await addresses.insertOne(doc)
    return reply.code(201).send({ address: { id: doc._id, mode: 'delivery', ...parsed.data } })
  })
  app.put('/api/addresses/:id', async (request, reply) => {
    const account = await auth.getAccount(readSessionToken(request.headers.cookie, secureCookies))
    if (!account) return reply.code(401).send(err('UNAUTHENTICATED', 'Необходимо войти'))
    const parsed = addressSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(err('INVALID_ADDRESS', 'Проверьте адрес'))
    const id = (request.params as { id: string }).id
    const result = await addresses.updateOne(
      { _id: id, accountId: account.id },
      { $set: parsed.data },
    )
    return result.matchedCount
      ? { address: { id, mode: 'delivery', ...parsed.data } }
      : reply.code(404).send(err('NOT_FOUND', 'Адрес не найден'))
  })
  app.delete('/api/addresses/:id', async (request, reply) => {
    const account = await auth.getAccount(readSessionToken(request.headers.cookie, secureCookies))
    if (!account) return reply.code(401).send(err('UNAUTHENTICATED', 'Необходимо войти'))
    const id = (request.params as { id: string }).id
    const deleted = await mongo.withSession((session) =>
      session.withTransaction(async () => {
        const result = await addresses.deleteOne({ _id: id, accountId: account.id }, { session })
        if (!result.deletedCount) return false
        await users.updateOne(
          { _id: account.id, selectedAddressId: id },
          { $set: { selectedAddressId: null } },
          { session },
        )
        return true
      }),
    )
    return deleted
      ? reply.code(204).send()
      : reply.code(404).send(err('NOT_FOUND', 'Адрес не найден'))
  })
}

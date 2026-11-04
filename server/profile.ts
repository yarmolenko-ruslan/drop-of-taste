import { randomUUID } from 'node:crypto'
import type { Db } from 'mongodb'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AuthService } from './auth/service.ts'
import { addressDetailsSchema } from '../shared/validation/address.ts'
import {
  birthdayStringSchema,
  emailSchema,
  isRealBirthday,
  nameSchema,
} from '../shared/validation/profile.ts'

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
function token(header: string | undefined) {
  return header
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('dev_session='))
    ?.slice(12)
}

export function registerProfileRoutes(
  app: FastifyInstance,
  db: Db,
  auth: AuthService,
  origins: readonly string[] = ['http://localhost:5173', 'http://127.0.0.1:5173'],
) {
  const users = db.collection<UserDoc>('users')
  const addresses = db.collection<AddressDoc>('addresses')
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/profile') && !request.url.startsWith('/api/addresses')) return
    reply.header('Cache-Control', 'no-store')
    if (
      ['POST', 'PUT', 'DELETE'].includes(request.method) &&
      !origins.includes(request.headers.origin ?? '')
    )
      return reply.code(403).send(err('INVALID_ORIGIN', 'Запрос отклонён'))
  })
  app.get('/api/profile', async (request, reply) => {
    const account = await auth.getAccount(token(request.headers.cookie))
    if (!account) return reply.code(401).send(err('UNAUTHENTICATED', 'Необходимо войти'))
    const doc = await users.findOne({ id: account.id })
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
    const account = await auth.getAccount(token(request.headers.cookie))
    if (!account) return reply.code(401).send(err('UNAUTHENTICATED', 'Необходимо войти'))
    const parsed = profileSchema.safeParse(request.body)
    if (!parsed.success)
      return reply.code(400).send(err('INVALID_PROFILE', 'Проверьте данные профиля'))
    if (parsed.data.birthday && !isRealBirthday(parsed.data.birthday)) {
      return reply.code(400).send(err('INVALID_BIRTHDAY', 'Проверьте дату рождения'))
    }
    await users.updateOne({ id: account.id }, { $set: parsed.data })
    return { profile: { ...parsed.data, phone: account.phone } }
  })
  app.put('/api/profile/notifications', async (request, reply) => {
    const account = await auth.getAccount(token(request.headers.cookie))
    if (!account) return reply.code(401).send(err('UNAUTHENTICATED', 'Необходимо войти'))
    const parsed = notificationSchema.safeParse(request.body)
    if (!parsed.success)
      return reply.code(400).send(err('INVALID_NOTIFICATIONS', 'Проверьте настройки'))
    if (parsed.data.email && !(await users.findOne({ id: account.id }))?.email)
      return reply
        .code(400)
        .send(err('EMAIL_REQUIRED', 'Сначала сохраните адрес электронной почты'))
    await users.updateOne({ id: account.id }, { $set: { notifications: parsed.data } })
    return { notifications: parsed.data }
  })
  app.put('/api/profile/delivery-selection', async (request, reply) => {
    const account = await auth.getAccount(token(request.headers.cookie))
    if (!account) return reply.code(401).send(err('UNAUTHENTICATED', 'Необходимо войти'))
    const parsed = selectionSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(err('INVALID_SELECTION', 'Проверьте данные'))
    const { addressId } = parsed.data
    if (addressId !== null) {
      const found = await addresses.findOne({ _id: addressId, accountId: account.id })
      if (!found) return reply.code(404).send(err('NOT_FOUND', 'Адрес не найден'))
    }
    await users.updateOne({ id: account.id }, { $set: { selectedAddressId: addressId } })
    return { selectedAddressId: addressId }
  })
  app.get('/api/addresses', async (request, reply) => {
    const account = await auth.getAccount(token(request.headers.cookie))
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
    const account = await auth.getAccount(token(request.headers.cookie))
    if (!account) return reply.code(401).send(err('UNAUTHENTICATED', 'Необходимо войти'))
    const parsed = addressSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send(err('INVALID_ADDRESS', 'Проверьте адрес'))
    const doc: AddressDoc = { _id: randomUUID(), accountId: account.id, ...parsed.data }
    await addresses.insertOne(doc)
    return reply.code(201).send({ address: { id: doc._id, mode: 'delivery', ...parsed.data } })
  })
  app.put('/api/addresses/:id', async (request, reply) => {
    const account = await auth.getAccount(token(request.headers.cookie))
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
    const account = await auth.getAccount(token(request.headers.cookie))
    if (!account) return reply.code(401).send(err('UNAUTHENTICATED', 'Необходимо войти'))
    const id = (request.params as { id: string }).id
    const result = await addresses.deleteOne({ _id: id, accountId: account.id })
    return result.deletedCount
      ? reply.code(204).send()
      : reply.code(404).send(err('NOT_FOUND', 'Адрес не найден'))
  })
}

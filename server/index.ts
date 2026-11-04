import { MongoClient } from 'mongodb'
import { createApp } from './app.ts'
import { createMongoAuthStore, ensureAuthIndexes } from './auth/mongo-store.ts'
import { createAuthService } from './auth/service.ts'
import { getCatalog, seedCatalog } from './catalog/mongo-catalog.ts'
import { ensureShopIndexes, registerShopRoutes } from './shop.ts'
import { registerProfileRoutes } from './profile.ts'

if (process.env.NODE_ENV === 'production') {
  throw new Error('Production requires a real SMS sender and deployment configuration')
}

const origin = new URL(process.env.APP_ORIGIN ?? 'http://localhost:5173').origin
const port = Number(process.env.API_PORT ?? 3001)
const developmentCode = process.env.DEV_OTP_CODE ?? '123456'
const mongoUri = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/?replicaSet=testset'

const originUrl = new URL(origin)
if (!['localhost', '127.0.0.1'].includes(originUrl.hostname) || originUrl.protocol !== 'http:') {
  throw new Error('The stub API accepts only a local HTTP origin')
}
if (!originUrl.port) throw new Error('APP_ORIGIN must include the local Vite port')
if (!/^\d{6}$/.test(developmentCode)) throw new Error('DEV_OTP_CODE must be six digits')
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid API_PORT')

const mongo = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 3_000 })
await mongo.connect()
const db = mongo.db('drop_of_taste')
await ensureAuthIndexes(db)
await seedCatalog(db)
await ensureShopIndexes(db)

const auth = createAuthService({
  store: createMongoAuthStore(mongo, db),
  sender: { async send() {} },
  secret: process.env.AUTH_HMAC_SECRET ?? 'local-development-only-hmac-secret',
  developmentCode,
})

const alternateHost = originUrl.hostname === 'localhost' ? '127.0.0.1' : 'localhost'
const alternateOrigin = `http://${alternateHost}${originUrl.port ? `:${originUrl.port}` : ''}`
const app = createApp(auth, { origins: [origin, alternateOrigin], secureCookies: false })
app.get('/api/catalog', async () => getCatalog(db))
registerShopRoutes(app, db, mongo, auth, [origin, alternateOrigin])
registerProfileRoutes(app, db, auth, [origin, alternateOrigin])
app.addHook('onClose', async () => mongo.close())
await app.listen({ host: '127.0.0.1', port })
process.stdout.write(`Local API ready at http://127.0.0.1:${port}\n`)

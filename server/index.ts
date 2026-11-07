import { MongoClient } from 'mongodb'
import { randomBytes } from 'node:crypto'
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
const mongoUri = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/?replicaSet=testset'

const originUrl = new URL(origin)
if (!['localhost', '127.0.0.1'].includes(originUrl.hostname) || originUrl.protocol !== 'http:') {
  throw new Error('The stub API accepts only a local HTTP origin')
}
if (!originUrl.port) throw new Error('APP_ORIGIN must include the local Vite port')
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid API_PORT')

const mongo = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 3_000 })
await mongo.connect()
const db = mongo.db('drop_of_taste')
await ensureAuthIndexes(db)
await seedCatalog(db)
await ensureShopIndexes(db)

const auth = createAuthService({
  store: createMongoAuthStore(mongo, db),
  sender: {
    async send(phone, code) {
      process.stdout.write(`Local sign-in code for ****${phone.slice(-4)}: ${code}\n`)
    },
  },
  secret: process.env.AUTH_HMAC_SECRET ?? randomBytes(32).toString('hex'),
})

const alternateHost = originUrl.hostname === 'localhost' ? '127.0.0.1' : 'localhost'
const alternateOrigin = `http://${alternateHost}${originUrl.port ? `:${originUrl.port}` : ''}`
const app = createApp(auth, { origins: [origin, alternateOrigin], secureCookies: false })
app.get('/api/catalog', async (_request, reply) => {
  reply.header('Cache-Control', 'public, max-age=30')
  return getCatalog(db)
})
registerShopRoutes(app, db, mongo, auth, [origin, alternateOrigin])
registerProfileRoutes(app, db, mongo, auth, [origin, alternateOrigin])
app.addHook('onClose', async () => mongo.close())
await app.listen({ host: '127.0.0.1', port })
process.stdout.write(`Local API ready at http://127.0.0.1:${port}\n`)

let shuttingDown = false
async function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  process.stdout.write(`Received ${signal}, closing the API…\n`)
  try {
    await app.close() // onClose закрывает MongoDB
  } finally {
    process.exit(0)
  }
}
process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))

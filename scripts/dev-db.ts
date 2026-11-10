import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MongoMemoryReplSet } from 'mongodb-memory-server'

const dataDir = fileURLToPath(new URL('../data/mongodb', import.meta.url))
await mkdir(dataDir, { recursive: true })

const replica = await MongoMemoryReplSet.create({
  binary: { downloadDir: join(tmpdir(), 'drop-of-taste-mongodb') },
  instanceOpts: [{ port: 27017, dbPath: dataDir }],
  replSet: { count: 1, storageEngine: 'wiredTiger' },
})

const uri = replica.getUri()
if (new URL(uri).port !== '27017') {
  await replica.stop({ doCleanup: false, force: false })
  throw new Error('Port 27017 is already in use; stop the other MongoDB instance first')
}

process.stdout.write(`Persistent local MongoDB: ${uri}\n`)
process.stdout.write(`Data directory: ${dataDir}\nPress Ctrl+C to stop.\n`)

await new Promise<void>((resolve) => {
  process.once('SIGINT', () => resolve())
  process.once('SIGTERM', () => resolve())
})
await replica.stop({ doCleanup: false, force: false })

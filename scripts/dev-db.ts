import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MongoMemoryReplSet } from 'mongodb-memory-server'

const replica = await MongoMemoryReplSet.create({
  binary: { downloadDir: join(tmpdir(), 'drop-of-taste-mongodb') },
  instanceOpts: [{ port: 27017 }],
  replSet: { count: 1 },
})

process.stdout.write(`Temporary local MongoDB: ${replica.getUri()}\n`)
process.stdout.write('Data stays available while this process is running. Press Ctrl+C to stop.\n')

await new Promise<void>((resolve) => {
  process.once('SIGINT', () => resolve())
  process.once('SIGTERM', () => resolve())
})
await replica.stop()

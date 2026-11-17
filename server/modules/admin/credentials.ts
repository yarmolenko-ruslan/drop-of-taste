import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto'
import type { Db } from 'mongodb'

type Credential = { _id: string; salt: string; passwordHash: string; version: string }
export const deriveAdminPassword = (password: string, salt: Buffer) =>
  new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 64, (error, key) => (error ? reject(error) : resolve(key)))
  })

/** Persist a salted verifier and a revocation version, never the configured password. */
export async function loadAdminCredentials(db: Db, password: string) {
  const collection = db.collection<Credential>('admin_credentials')
  for (let attempt = 0; attempt < 5; attempt++) {
    const saved = await collection.findOne({ _id: 'primary' })
    if (saved) {
      if (
        !/^[a-f0-9]{64}$/.test(saved.salt) ||
        !/^[a-f0-9]{128}$/.test(saved.passwordHash) ||
        !saved.version
      )
        throw new Error('Invalid administrator credential record')
      const salt = Buffer.from(saved.salt, 'hex')
      const candidate = await deriveAdminPassword(password, salt)
      if (timingSafeEqual(candidate, Buffer.from(saved.passwordHash, 'hex')))
        return { salt, passwordHash: candidate, version: saved.version }
    }
    const salt = randomBytes(32)
    const passwordHash = await deriveAdminPassword(password, salt)
    const version = randomUUID()
    const next = {
      _id: 'primary',
      salt: salt.toString('hex'),
      passwordHash: passwordHash.toString('hex'),
      version,
    }
    if (saved) {
      const result = await collection.replaceOne({ _id: 'primary', version: saved.version }, next)
      if (result.matchedCount) return { salt, passwordHash, version }
    } else {
      try {
        await collection.insertOne(next)
        return { salt, passwordHash, version }
      } catch (failure) {
        if ((failure as { code?: number }).code !== 11000) throw failure
      }
    }
  }
  throw new Error('Administrator credentials changed concurrently')
}

export async function isAdminCredentialCurrent(db: Db, version: string) {
  return Boolean(
    await db
      .collection<Credential>('admin_credentials')
      .findOne({ _id: 'primary', version }, { projection: { _id: 1 } }),
  )
}

import type { Db } from 'mongodb'
import { ADMIN_LOG_RETENTION_SECONDS } from '../../../shared/admin-log-policy.ts'

export async function ensureAdminLogRetention(db: Db) {
  for (const name of ['admin_activity', 'admin_audit', 'payment_events']) {
    await db
      .collection(name)
      .createIndex(
        { at: 1 },
        { name: 'logs_retention', expireAfterSeconds: ADMIN_LOG_RETENTION_SECONDS },
      )
  }
}

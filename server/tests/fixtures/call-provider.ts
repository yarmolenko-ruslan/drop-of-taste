import { randomUUID } from 'node:crypto'
import type { CallProvider } from '../../modules/auth/types.ts'

/** Isolated fake: never uses fetch or contacts SMS.ru. */
export function createTestCallProvider(): CallProvider {
  const checks = new Set<string>()
  return {
    async start() {
      const checkId = randomUUID()
      checks.add(checkId)
      return { checkId, callPhone: '+78005008275' }
    },
    async status(checkId) {
      return checks.has(checkId) ? 'verified' : 'expired'
    },
  }
}

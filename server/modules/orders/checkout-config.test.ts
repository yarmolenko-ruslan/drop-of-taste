// @vitest-environment node
import Fastify from 'fastify'
import type { Db, MongoClient } from 'mongodb'
import { registerShopRoutes } from './routes.ts'
import type { AuthService } from '../auth/service.ts'
import { defaultSiteContent } from '../../../shared/site-content.ts'
import { getSiteContent } from '../content/service.ts'

vi.mock('../content/service.ts', () => ({ getSiteContent: vi.fn() }))

afterEach(() => vi.useRealTimers())

test.each([
  ['гость', false, '1990-11-11', '2026-11-11T05:00:00Z', true, false],
  ['дата не заполнена', true, '', '2026-11-11T05:00:00Z', true, false],
  ['до окна', true, '1990-11-11', '2026-11-07T16:59:59Z', true, false],
  ['начало окна', true, '1990-11-11', '2026-11-07T17:00:00Z', true, true],
  ['день рождения', true, '1990-11-11', '2026-11-11T05:00:00Z', true, true],
  ['конец окна', true, '1990-11-11', '2026-11-14T16:59:59Z', true, true],
  ['после окна', true, '1990-11-11', '2026-11-14T17:00:00Z', true, false],
  ['акция выключена', true, '1990-11-11', '2026-11-11T05:00:00Z', false, false],
])('доступность плашки: %s', async (_label, loggedIn, birthday, now, enabled, expected) => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(now))
  vi.mocked(getSiteContent).mockResolvedValue({
    ...defaultSiteContent,
    promotions: defaultSiteContent.promotions.map((item) =>
      item.id === 'birthday' ? { ...item, enabled } : item,
    ),
  })
  const auth = {
    getAccount: vi.fn(async () => (loggedIn ? { id: 'u1' } : null)),
  } as unknown as AuthService
  const db = {
    collection: () => ({
      findOne: async () => ({ birthday }),
      find: () => ({ async *[Symbol.asyncIterator]() {} }),
    }),
  } as unknown as Db
  const app = Fastify()
  registerShopRoutes(app, db, {} as MongoClient, auth)
  try {
    const response = await app.inject({ method: 'GET', url: '/api/checkout/config' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ testPaymentEnabled: false, birthdayAvailable: expected })
    expect(response.headers['cache-control']).toBe('no-store')
  } finally {
    await app.close()
  }
})

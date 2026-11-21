import {
  completeAdminLogout,
  parseAdminLogout,
  pendingLogoutKey,
  persistAdminLogout,
  readAdminLogout,
} from './adminLogoutState'
beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())
const older = { id: 'first-intent', accountId: 'owner', sessionId: 'old-session' }
const newer = { id: 'second-intent', accountId: 'owner', sessionId: 'new-session' }

test('a late completion never clears another tab’s newer logout intent', () => {
  persistAdminLogout(older)
  persistAdminLogout(newer)
  expect(completeAdminLogout(older)).toEqual(newer)
  expect(readAdminLogout()).toEqual(newer)
  expect(completeAdminLogout(newer)).toBeNull()
  expect(localStorage.getItem(pendingLogoutKey)).toBeNull()
})

test('legacy and damaged flags stay fail-closed and extra fields are never retained', () => {
  for (const raw of ['1', '{broken', 'null', '[]'])
    expect(parseAdminLogout(raw)).toEqual({ id: 'legacy', accountId: null, sessionId: null })
  const parsed = parseAdminLogout(JSON.stringify({ ...older, password: 'must-not-retain' }))
  expect(parsed).toEqual(older)
  persistAdminLogout({ ...older, password: 'must-not-store' } as typeof older)
  expect(localStorage.getItem(pendingLogoutKey)).not.toContain('must-not-store')
})

test('storage failures do not prevent finishing a server-confirmed revocation', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked')
  })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked')
  })
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
    throw new Error('blocked')
  })
  expect(() => persistAdminLogout(older)).not.toThrow()
  expect(readAdminLogout()).toBeNull()
  expect(completeAdminLogout(older)).toBeNull()
})

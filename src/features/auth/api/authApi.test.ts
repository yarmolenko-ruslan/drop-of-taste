import { apiRequest } from './authApi'

afterEach(() => vi.unstubAllGlobals())

test('сообщает панели об истечении административной сессии', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({ error: { code: 'ADMIN_UNAUTHORIZED', message: 'Войдите' } }, { status: 401 }),
    ),
  )
  const expire = vi.fn()
  window.addEventListener('drop-of-taste:admin-session-expired', expire, { once: true })
  await expect(apiRequest('/admin/content')).rejects.toMatchObject({ code: 'ADMIN_UNAUTHORIZED' })
  expect(expire).toHaveBeenCalledOnce()
})

test('передаёт идентификатор аккаунта и сообщает о смене сессии', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: 'ACCOUNT_CHANGED', message: 'Аккаунт изменился' } }),
        { status: 409, headers: { 'Content-Type': 'application/json' } },
      ),
    )
  vi.stubGlobal('fetch', fetchMock)
  const changed = vi.fn()
  window.addEventListener('drop-of-taste:account-changed', changed, { once: true })
  await expect(
    apiRequest('/profile', { headers: new Headers({ 'X-Account-Id': 'expected-user' }) }),
  ).rejects.toMatchObject({ code: 'ACCOUNT_CHANGED' })
  expect(new Headers(fetchMock.mock.calls[0]![1].headers).get('X-Account-Id')).toBe('expected-user')
  expect(changed).toHaveBeenCalledOnce()
})

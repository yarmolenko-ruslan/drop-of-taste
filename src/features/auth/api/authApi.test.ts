import { apiRequest, setAdminRequestIdentity } from './authApi'

beforeEach(() => setAdminRequestIdentity(null))
afterEach(() => {
  setAdminRequestIdentity(null)
  vi.unstubAllGlobals()
})

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

test('admin working requests are bound to the initiating account and customer requests stay independent', async () => {
  const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ ok: true }))
  vi.stubGlobal('fetch', fetchMock)
  setAdminRequestIdentity('expected-employee')
  for (const path of ['/admin/dashboard', '/admin/orders?stage=new', '/admin/password']) {
    await apiRequest(path)
    expect(new Headers(fetchMock.mock.calls.at(-1)![1]!.headers).get('X-Admin-Account-Id')).toBe(
      'expected-employee',
    )
  }
  for (const path of [
    '/admin/login',
    '/admin/session',
    '/admin/logout',
    '/auth/me',
    '/orders',
    '/profile',
  ]) {
    await apiRequest(path)
    expect(new Headers(fetchMock.mock.calls.at(-1)![1]!.headers).has('X-Admin-Account-Id')).toBe(
      false,
    )
  }
})

test.each([200, 401])(
  'a late %s admin response cannot restore old data or expire the new account',
  async (status) => {
    let finish!: (response: Response) => void
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve
          }),
      ),
    )
    const expired = vi.fn()
    window.addEventListener('drop-of-taste:admin-session-expired', expired)
    try {
      setAdminRequestIdentity('old-account')
      const result = apiRequest('/admin/dashboard')
      setAdminRequestIdentity('new-account')
      finish(
        Response.json(
          status === 200 ? { secret: 'old-data' } : { error: { code: 'ADMIN_UNAUTHORIZED' } },
          { status },
        ),
      )
      await expect(result).rejects.toMatchObject({ code: 'ADMIN_REQUEST_SUPERSEDED' })
      expect(expired).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('drop-of-taste:admin-session-expired', expired)
    }
  },
)

test('account changes during JSON parsing also discard the stale body', async () => {
  let finish!: (body: unknown) => void
  const json = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json })),
  )
  const result = apiRequest('/admin/employees')
  await vi.waitFor(() => expect(json).toHaveBeenCalled())
  setAdminRequestIdentity('new-account')
  finish({ employees: [{ temporaryPassword: 'must-never-render' }] })
  await expect(result).rejects.toMatchObject({ code: 'ADMIN_REQUEST_SUPERSEDED' })
})

test('server identity mismatch clears the admin interface without triggering customer account changes', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json(
        { error: { code: 'ADMIN_ACCOUNT_CHANGED', message: 'Аккаунт изменился' } },
        { status: 409 },
      ),
    ),
  )
  const expired = vi.fn()
  const customerChanged = vi.fn()
  window.addEventListener('drop-of-taste:admin-session-expired', expired, { once: true })
  window.addEventListener('drop-of-taste:account-changed', customerChanged)
  try {
    await expect(apiRequest('/admin/dashboard')).rejects.toMatchObject({
      code: 'ADMIN_ACCOUNT_CHANGED',
    })
    expect(expired).toHaveBeenCalledOnce()
    expect(customerChanged).not.toHaveBeenCalled()
  } finally {
    window.removeEventListener('drop-of-taste:account-changed', customerChanged)
  }
})

test('an administrative account switch does not discard an independent customer response', async () => {
  let finish!: (response: Response) => void
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve
        }),
    ),
  )
  const result = apiRequest('/profile')
  setAdminRequestIdentity('owner')
  finish(Response.json({ name: 'Покупатель' }))
  await expect(result).resolves.toEqual({ name: 'Покупатель' })
})

test('session identity is sent only with admin working requests, and changes notify only the administrative screen', async () => {
  const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ ok: true }))
  vi.stubGlobal('fetch', fetchMock)
  setAdminRequestIdentity('owner', 'public-session-marker')
  await apiRequest('/admin/dashboard')
  expect(new Headers(fetchMock.mock.calls[0]![1]!.headers).get('X-Admin-Session-Id')).toBe(
    'public-session-marker',
  )
  for (const path of ['/profile', '/orders', '/admin/session', '/admin/login']) {
    await apiRequest(path)
    expect(new Headers(fetchMock.mock.calls.at(-1)![1]!.headers).has('X-Admin-Session-Id')).toBe(
      false,
    )
  }
  const expired = vi.fn()
  const customer = vi.fn()
  window.addEventListener('drop-of-taste:admin-session-expired', expired)
  window.addEventListener('drop-of-taste:account-changed', customer)
  try {
    fetchMock.mockImplementation(async () =>
      Response.json(
        { error: { code: 'ADMIN_SESSION_CHANGED', message: 'Сессия изменилась' } },
        { status: 409 },
      ),
    )
    await expect(apiRequest('/admin/dashboard')).rejects.toMatchObject({
      code: 'ADMIN_SESSION_CHANGED',
    })
    expect(expired).toHaveBeenCalledOnce()
    expect(customer).not.toHaveBeenCalled()
  } finally {
    window.removeEventListener('drop-of-taste:admin-session-expired', expired)
    window.removeEventListener('drop-of-taste:account-changed', customer)
  }
})

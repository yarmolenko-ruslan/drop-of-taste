// @vitest-environment node
import { createSmsRuCallProvider } from './sms-ru.ts'
import { CallProviderError } from './types.ts'
const phone = '+79991234567'
const ip = '203.0.113.10'
const accepted = {
  status: 'OK',
  status_code: 100,
  check_id: '201737-542',
  call_phone: '78005008275',
}
beforeEach(() =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('External network disabled')
    }),
  ),
)
afterEach(() => vi.unstubAllGlobals())
function response(body: unknown, code = 200) {
  const fetch = vi.fn(async () => Response.json(body, { status: code }))
  vi.stubGlobal('fetch', fetch)
  return fetch
}
test('registers exactly once via POST callcheck/add with real user IP and private API key in the body', async () => {
  const fetch = response({ ...accepted, call_phone_html: '<script>bad</script>' })
  const provider = createSmsRuCallProvider('private-api-key')
  expect(await provider.start(phone, ip)).toEqual({
    checkId: accepted.check_id,
    callPhone: '+78005008275',
  })
  expect(fetch).toHaveBeenCalledTimes(1)
  const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0]!
  expect(url).toBe('https://sms.ru/callcheck/add')
  expect(init?.method).toBe('POST')
  expect(init?.redirect).toBe('error')
  expect(init?.signal).toBeInstanceOf(AbortSignal)
  expect(Object.fromEntries(init?.body as URLSearchParams)).toEqual({
    api_id: 'private-api-key',
    phone: '79991234567',
    ip,
    json: '1',
  })
})
test.each(['127.0.0.1', '::1', '::ffff:127.0.0.1'])(
  'local mode omits the optional user IP: %s',
  async (local) => {
    response(accepted)
    await createSmsRuCallProvider('key', { allowLocalIp: true }).start(phone, local)
    const params = vi.mocked(globalThis.fetch).mock.calls[0]![1]?.body as URLSearchParams
    expect(params.has('ip')).toBe(false)
  },
)
test('invalid settings, phone or local IP fail before network access', async () => {
  expect(() => createSmsRuCallProvider(' ')).toThrow('SMS_RU_API_ID')
  const provider = createSmsRuCallProvider('key')
  for (const [number, address] of [
    [phone, '127.0.0.1'],
    [phone, 'not-ip'],
    ['+12025550123', ip],
  ]) {
    await expect(provider.start(number!, address!)).rejects.toBeInstanceOf(CallProviderError)
  }
  expect(globalThis.fetch).not.toHaveBeenCalled()
})
test.each(['400', 400, '401', 401, '402', 402])(
  'parses check_status %s inside the successful API envelope',
  async (value) => {
    response({ status: 'OK', status_code: 100, check_status: value })
    const result = await createSmsRuCallProvider('key').status('201737-542')
    expect(result).toBe(
      String(value) === '400' ? 'waiting' : String(value) === '401' ? 'verified' : 'expired',
    )
    const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0]!
    expect(url).toBe('https://sms.ru/callcheck/status')
    expect(Object.fromEntries(init?.body as URLSearchParams)).toEqual({
      api_id: 'key',
      check_id: '201737-542',
      json: '1',
    })
  },
)
test.each([
  { status: 'OK', status_code: 401, check_status: '401' },
  { status: 'ERROR', status_code: 100, check_status: '401' },
  { status: 'OK', status_code: 100, check_status: '100' },
  { status: 'OK', status_code: 100 },
])('an API error or missing status cannot confirm authorization: %j', async (body) => {
  response(body)
  await expect(createSmsRuCallProvider('key').status('201737-542')).rejects.toBeInstanceOf(
    CallProviderError,
  )
  expect(globalThis.fetch).toHaveBeenCalledTimes(1)
})
test.each([
  { ...accepted, call_phone: 'javascript:alert(1)' },
  { ...accepted, check_id: 'bad\ncheck' },
  { ...accepted, check_id: '' },
  { status: 'OK', code: '1234' },
])('rejects malformed registration responses without retrying: %j', async (body) => {
  response(body)
  await expect(createSmsRuCallProvider('key').start(phone, ip)).rejects.toMatchObject({
    definitelyRejected: false,
  })
  expect(globalThis.fetch).toHaveBeenCalledTimes(1)
})
test.each([202, 507, 508, 509, 550])(
  'definite provider rejection %s permits releasing the reservation',
  async (status_code) => {
    response({ status: 'ERROR', status_code })
    await expect(createSmsRuCallProvider('key').start(phone, ip)).rejects.toMatchObject({
      definitelyRejected: true,
    })
  },
)
test('unknown rejection or a response containing check_id retains the registration budget', async () => {
  for (const body of [
    { status: 'ERROR', status_code: 500 },
    { status: 'ERROR', status_code: 202, check_id: 'maybe-created' },
  ]) {
    response(body)
    await expect(createSmsRuCallProvider('key').start(phone, ip)).rejects.toMatchObject({
      definitelyRejected: false,
    })
  }
})
test.each(['network', 'bad-json', 'http'])(
  'does not retry after %s failure or reveal upstream details',
  async (kind) => {
    const fetch = vi.fn(async () => {
      if (kind === 'network') throw new Error('private-api-key')
      return kind === 'http'
        ? new Response('private-api-key', { status: 503 })
        : new Response('{broken')
    })
    vi.stubGlobal('fetch', fetch)
    const onDiagnostic = vi.fn()
    const provider = createSmsRuCallProvider('private-api-key', { onDiagnostic })
    await expect(provider.start(phone, ip)).rejects.toMatchObject({ definitelyRejected: false })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(onDiagnostic.mock.calls)).not.toContain('private-api-key')
  },
)
test('diagnostics whitelist safe fields and omit raw provider HTML, phone and API key', async () => {
  response({
    ...accepted,
    secret: 'private-api-key',
    call_phone_html: '<script>raw</script>',
    cost: 0.1,
  })
  const record = vi.fn()
  await createSmsRuCallProvider('private-api-key', { onDiagnostic: record }).start(phone, ip)
  expect(record).toHaveBeenCalledWith(
    expect.objectContaining({
      operation: 'start',
      outcome: 'accepted',
      phoneMasked: '+7***4567',
      checkId: accepted.check_id,
    }),
  )
  const text = JSON.stringify(record.mock.calls)
  for (const forbidden of [phone, 'private-api-key', '<script>', 'raw'])
    expect(text).not.toContain(forbidden)
})
test.each(['throw', 'reject', 'never'])(
  'diagnostic sink %s cannot block or alter authentication',
  async (kind) => {
    response(accepted)
    const onDiagnostic = () => {
      if (kind === 'throw') throw new Error('sink')
      return kind === 'reject' ? Promise.reject(new Error('sink')) : new Promise<void>(() => {})
    }
    expect((await createSmsRuCallProvider('key', { onDiagnostic }).start(phone, ip)).checkId).toBe(
      accepted.check_id,
    )
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  },
)

test.each([
  ['78005008275', '+78005008275'],
  ['+78005008275', '+78005008275'],
  [78005008275, '+78005008275'],
  ['88005008275', '+78005008275'],
  [88005008275, '+78005008275'],
  ['+7 (800) 500-82-75', '+78005008275'],
  ['8 (800) 500-82-75', '+78005008275'],
])('normalizes a valid SMS.ru call phone representation %j', async (value, expected) => {
  const fetch = response({ ...accepted, call_phone: value })
  expect(await createSmsRuCallProvider('key').start(phone, ip)).toEqual({
    checkId: accepted.check_id,
    callPhone: expected,
  })
  expect(fetch).toHaveBeenCalledTimes(1)
})

test('supports the call_number field used in the official PHP example', async () => {
  response({
    status: 'OK',
    status_code: 100,
    check_id: accepted.check_id,
    call_number: '+7 (800) 500-82-75',
  })
  expect((await createSmsRuCallProvider('key').start(phone, ip)).callPhone).toBe('+78005008275')
})

test('invalid and missing numbers are diagnosed without leaking provider response or private data', async () => {
  for (const [body, reason] of [
    [{ ...accepted, call_phone: 'tel:private-api-key' }, 'call_phone_invalid'],
    [{ status: 'OK', status_code: 100, check_id: accepted.check_id }, 'call_phone_missing'],
    [{ ...accepted, check_id: '' }, 'check_id_invalid'],
    [{ ...accepted, call_number: '74995555555' }, 'call_phone_conflict'],
  ] as const) {
    response(body)
    const record = vi.fn()
    await expect(
      createSmsRuCallProvider('private-api-key', { onDiagnostic: record }).start(phone, ip),
    ).rejects.toMatchObject({ definitelyRejected: false })
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'invalid_response', invalidResponseReason: reason }),
    )
    expect(JSON.stringify(record.mock.calls)).not.toContain('private-api-key')
    expect(JSON.stringify(record.mock.calls)).not.toContain(phone)
  }
})
test.each([
  null,
  {},
  [],
  true,
  -78005008275,
  78005008275.5,
  '+88005008275',
  '78005008275 ext 123',
  '7\n8005008275',
  'tel:+78005008275',
  '//78005008275',
])('rejects unsafe call phone values: %j', async (value) => {
  response({ ...accepted, call_phone: value, call_phone_pretty: '+7 (800) 500-82-75' })
  await expect(createSmsRuCallProvider('key').start(phone, ip)).rejects.toMatchObject({
    definitelyRejected: false,
  })
})

test.each([
  { call_phone: '+7 (800) 500-82-75' },
  { call_phone: 88005008275 },
  { call_number: '78005008275' },
])(
  'normalized provider number reaches the browser through the real auth routes: %j',
  async (fields) => {
    const { createApp } = await import('../../app.ts')
    const { createAuthService } = await import('./service.ts')
    const { createMemoryAuthStore } = await import('./memory-store.ts')
    const fetch = response({
      status: 'OK',
      status_code: 100,
      check_id: accepted.check_id,
      ...fields,
    })
    const auth = createAuthService({
      store: createMemoryAuthStore(),
      provider: createSmsRuCallProvider('key', { allowLocalIp: true }),
    })
    const app = createApp(auth, { origins: ['http://localhost:5173'], secureCookies: false })
    const start = () =>
      app.inject({
        method: 'POST',
        url: '/api/auth/call/start',
        headers: { origin: 'http://localhost:5173' },
        payload: { phone, consent: true },
      })
    try {
      const registered = await start()
      expect(registered.statusCode).toBe(202)
      expect(registered.json()).toMatchObject({ status: 'accepted', callPhone: '+78005008275' })
      expect(registered.json().attemptToken).toHaveLength(43)
      expect(registered.headers['set-cookie']).toBeUndefined()
      expect((await start()).statusCode).toBe(429)
      expect(fetch).toHaveBeenCalledTimes(1)
    } finally {
      await app.close()
    }
  },
)
test('equivalent call_phone and call_number fields are allowed without guessing a fallback', async () => {
  response({ ...accepted, call_number: '8 (800) 500-82-75' })
  expect((await createSmsRuCallProvider('key').start(phone, ip)).callPhone).toBe('+78005008275')
})

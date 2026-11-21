// @vitest-environment node
import { restrictStressFetch } from './stress-network.ts'
import { createServer } from 'node:http'
import { once } from 'node:events'

afterEach(() => vi.unstubAllGlobals())

test('blocks external providers and unrelated local services without contacting the network', async () => {
  const nativeFetch = vi.fn().mockResolvedValue(Response.json({ status: 'ok' }))
  vi.stubGlobal('fetch', nativeFetch)
  const guard = restrictStressFetch()
  try {
    guard.allowLocalOrigin('http://127.0.0.1:12345')
    for (const url of [
      'https://sms.ru/callcheck/add',
      'https://sms.ru/callcheck/status',
      'https://sms.ru/sms/send',
      'https://api.yookassa.ru/v3/payments',
      'http://127.0.0.1:3001/api/auth/call/start',
    ])
      await expect(fetch(url)).rejects.toThrow('blocked')
    expect(nativeFetch).not.toHaveBeenCalled()
    expect(guard.blockedRequests).toBe(5)
    await fetch('http://127.0.0.1:12345/api/health')
    expect(nativeFetch).toHaveBeenCalledTimes(1)
  } finally {
    guard.restore()
  }
})

test('does not permit adding an external origin to a stress run', () => {
  const guard = restrictStressFetch()
  try {
    for (const origin of [
      'https://sms.ru',
      'http://localhost@evil.example',
      'http://127.0.0.1.evil.example',
    ])
      expect(() => guard.allowLocalOrigin(origin)).toThrow()
  } finally {
    guard.restore()
  }
})

test('a local redirect cannot bypass the stress network restriction', async () => {
  let redirectedRequests = 0
  const target = createServer((_request, response) => {
    redirectedRequests++
    response.end('unexpected')
  })
  target.listen(0, '127.0.0.1')
  await once(target, 'listening')
  const targetAddress = target.address()
  if (!targetAddress || typeof targetAddress === 'string') throw new Error('No test target address')
  const source = createServer((_request, response) => {
    response.writeHead(302, { Location: `http://127.0.0.1:${targetAddress.port}` })
    response.end()
  })
  source.listen(0, '127.0.0.1')
  await once(source, 'listening')
  const sourceAddress = source.address()
  if (!sourceAddress || typeof sourceAddress === 'string') throw new Error('No test source address')
  const guard = restrictStressFetch()
  try {
    guard.allowLocalOrigin(`http://127.0.0.1:${sourceAddress.port}`)
    await expect(fetch(`http://127.0.0.1:${sourceAddress.port}`)).rejects.toThrow()
    expect(redirectedRequests).toBe(0)
  } finally {
    guard.restore()
    await Promise.all([
      new Promise<void>((resolve) => source.close(() => resolve())),
      new Promise<void>((resolve) => target.close(() => resolve())),
    ])
  }
})

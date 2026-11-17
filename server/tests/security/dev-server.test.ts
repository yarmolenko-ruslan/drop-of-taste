// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createServer, type ViteDevServer } from 'vite'

let server: ViteDevServer
let base: string
const folder = `security-audit-${randomUUID()}`
const directory = resolve('data', folder)
const marker = 'SYNTHETIC_PRIVATE_DATA_DO_NOT_SERVE'
beforeAll(async () => {
  await mkdir(directory, { recursive: true })
  await writeFile(resolve(directory, 'private.txt'), marker)
  server = await createServer({
    configFile: resolve('vite.config.ts'),
    envFile: false,
    logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0, strictPort: false },
  })
  await server.listen()
  const address = server.httpServer!.address()
  if (!address || typeof address === 'string') throw new Error('No HTTP address')
  base = `http://127.0.0.1:${address.port}`
}, 20000)
afterAll(async () => {
  await server?.close()
  await rm(directory, { recursive: true, force: true })
})

test('dev server never serves private database files, including filesystem and case aliases', async () => {
  for (const path of [
    `/data/${folder}/private.txt`,
    `/DATA/${folder}/private.txt`,
    `/@fs/${directory}/private.txt`,
    `/data/${folder}/private.txt?raw`,
    '/server/modules/auth/service.ts',
    '/server/modules/auth/service.ts?raw',
    '/scripts/dev-db.ts',
  ]) {
    const response = await fetch(`${base}${path}`)
    const body = await response.text()
    expect([403, 404], path).toContain(response.status)
    expect(body).not.toContain(marker)
  }
})

test('unrelated localhost applications cannot read source through permissive CORS', async () => {
  const response = await fetch(`${base}/shared/promotion.ts`, {
    headers: { origin: 'http://localhost:9000' },
  })
  expect(response.status).toBe(200)
  expect(response.headers.get('access-control-allow-origin')).toBeNull()
})

test('frontend entry, shared modules and public images remain available', async () => {
  for (const path of ['/', '/src/main.tsx', '/shared/promotion.ts', '/brand-emblem.png']) {
    const response = await fetch(`${base}${path}`)
    expect(response.status, path).toBe(200)
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('x-frame-options')).toBe('DENY')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    await response.arrayBuffer()
  }
})

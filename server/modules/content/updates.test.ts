// @vitest-environment node
import Fastify from 'fastify'
import type { ServerResponse } from 'node:http'
import { notifySiteUpdate, registerSiteUpdateRoutes } from './updates.ts'

test('медленный подписчик отключается при заполнении буфера, обновления не копятся', async () => {
  const app = Fastify()
  let raw: ServerResponse | undefined
  app.addHook('onRequest', async (_request, reply) => {
    raw = reply.raw
  })
  registerSiteUpdateRoutes(app)
  await app.listen({ host: '127.0.0.1', port: 0 })
  const controller = new AbortController()
  try {
    const response = await fetch(`${app.listeningOrigin}/api/site-updates`, {
      signal: controller.signal,
    })
    await response.body!.getReader().read()
    const write = vi.spyOn(raw!, 'write').mockReturnValue(false)
    notifySiteUpdate(app, 'catalog')
    expect(raw!.destroyed).toBe(true)
    notifySiteUpdate(app, 'content')
    expect(write).toHaveBeenCalledTimes(1)
  } finally {
    controller.abort()
    await app.close()
  }
})

test('лавина подписок ограничена, отключение клиентов освобождает места', async () => {
  const app = Fastify()
  registerSiteUpdateRoutes(app)
  await app.listen({ host: '127.0.0.1', port: 0 })
  const controllers = Array.from({ length: 101 }, () => new AbortController())
  const replacement = new AbortController()
  try {
    const responses = await Promise.all(
      controllers.map((controller) =>
        fetch(`${app.listeningOrigin}/api/site-updates`, { signal: controller.signal }),
      ),
    )
    expect(responses.filter((response) => response.status === 200)).toHaveLength(100)
    expect(responses.filter((response) => response.status === 503)).toHaveLength(1)
    controllers.forEach((controller) => controller.abort())
    await vi.waitFor(async () => {
      const response = await fetch(`${app.listeningOrigin}/api/site-updates`, {
        signal: replacement.signal,
      })
      expect(response.status).toBe(200)
    })
  } finally {
    controllers.forEach((controller) => controller.abort())
    replacement.abort()
    await app.close()
  }
})

test('открытая страница получает обновление после сохранения', async () => {
  const app = Fastify()
  registerSiteUpdateRoutes(app)
  await app.listen({ host: '127.0.0.1', port: 0 })
  const controller = new AbortController()
  try {
    const response = await fetch(`${app.listeningOrigin}/api/site-updates`, {
      signal: controller.signal,
    })
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const reader = response.body!.getReader()
    await reader.read() // Подписка открылась, начальный комментарий получен.
    notifySiteUpdate(app, 'content')
    const update = await reader.read()
    expect(new TextDecoder().decode(update.value)).toContain('event: content')
  } finally {
    controller.abort()
    await app.close()
  }
})

test('сервер завершает поток при остановке без отключения клиента', async () => {
  const app = Fastify()
  registerSiteUpdateRoutes(app)
  await app.listen({ host: '127.0.0.1', port: 0 })
  const controller = new AbortController()
  try {
    const response = await fetch(`${app.listeningOrigin}/api/site-updates`, {
      signal: controller.signal,
    })
    const body = response.text()
    await app.close()
    expect(await body).toContain(': connected')
  } finally {
    controller.abort()
    await app.close()
  }
})

test('обновления изолированы между экземплярами сервера', async () => {
  const first = Fastify()
  const second = Fastify()
  registerSiteUpdateRoutes(first)
  registerSiteUpdateRoutes(second)
  await first.listen({ host: '127.0.0.1', port: 0 })
  await second.listen({ host: '127.0.0.1', port: 0 })
  const controller = new AbortController()
  try {
    const a = await fetch(`${first.listeningOrigin}/api/site-updates`, {
      signal: controller.signal,
    })
    const b = await fetch(`${second.listeningOrigin}/api/site-updates`, {
      signal: controller.signal,
    })
    const firstBody = a.text()
    const secondBody = b.text()
    notifySiteUpdate(first, 'catalog')
    await first.close()
    await second.close()
    expect(await firstBody).toContain('event: catalog')
    expect(await secondBody).not.toContain('event: catalog')
  } finally {
    controller.abort()
    await first.close()
    await second.close()
  }
})

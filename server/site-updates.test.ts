// @vitest-environment node
import Fastify from 'fastify'
import { notifySiteUpdate, registerSiteUpdateRoutes } from './site-updates.ts'

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
    notifySiteUpdate('content')
    const update = await reader.read()
    expect(new TextDecoder().decode(update.value)).toContain('event: content')
  } finally {
    controller.abort()
    await app.close()
  }
})

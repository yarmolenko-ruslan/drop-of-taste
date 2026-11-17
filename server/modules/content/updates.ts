import type { ServerResponse } from 'node:http'
import type { FastifyInstance } from 'fastify'
import { securityHeaders } from '../../../shared/http-security.ts'

type UpdateKind = 'content' | 'catalog'
const subscribersByApp = new WeakMap<FastifyInstance, Set<ServerResponse>>()
const MAX_SUBSCRIBERS = 100

function writeUpdate(subscribers: Set<ServerResponse>, response: ServerResponse, data: string) {
  if (response.destroyed || response.writableEnded) {
    subscribers.delete(response)
  } else if (!response.write(data)) {
    // SSE передаёт только сигнал перечитать данные. Медленный клиент переподключится,
    // поэтому очередь сигналов в памяти не нужна.
    subscribers.delete(response)
    response.destroy()
  }
}

export function notifySiteUpdate(app: FastifyInstance, kind: UpdateKind) {
  const subscribers = subscribersByApp.get(app)
  if (!subscribers) return
  for (const response of subscribers) {
    writeUpdate(subscribers, response, `event: ${kind}\ndata: updated\n\n`)
  }
}

export function registerSiteUpdateRoutes(app: FastifyInstance) {
  const subscribers = new Set<ServerResponse>()
  subscribersByApp.set(app, subscribers)
  // preClose выполняется до ожидания завершения активных HTTP-соединений.
  app.addHook('preClose', async () => {
    for (const response of subscribers) response.end()
    subscribers.clear()
    subscribersByApp.delete(app)
  })
  app.get('/api/site-updates', (_request, reply) => {
    if (subscribers.size >= MAX_SUBSCRIBERS)
      return reply
        .header('Retry-After', '5')
        .code(503)
        .send({
          error: { code: 'UPDATES_BUSY', message: 'Повторите подключение позже' },
        })
    reply.hijack()
    reply.raw.writeHead(200, {
      ...securityHeaders,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    subscribers.add(reply.raw)
    const heartbeat = setInterval(() => {
      writeUpdate(subscribers, reply.raw, ': keepalive\n\n')
    }, 25_000)
    heartbeat.unref()
    reply.raw.on('close', () => {
      clearInterval(heartbeat)
      subscribers.delete(reply.raw)
    })
    writeUpdate(subscribers, reply.raw, ': connected\n\n')
  })
}

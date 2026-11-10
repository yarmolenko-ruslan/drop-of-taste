import type { ServerResponse } from 'node:http'
import type { FastifyInstance } from 'fastify'

type UpdateKind = 'content' | 'catalog'
const subscribers = new Set<ServerResponse>()

export function notifySiteUpdate(kind: UpdateKind) {
  for (const response of subscribers) {
    if (response.destroyed) subscribers.delete(response)
    else response.write(`event: ${kind}\ndata: updated\n\n`)
  }
}

export function registerSiteUpdateRoutes(app: FastifyInstance) {
  app.get('/api/site-updates', (_request, reply) => {
    reply.hijack()
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    reply.raw.write(': connected\n\n')
    subscribers.add(reply.raw)
    const heartbeat = setInterval(() => {
      if (!reply.raw.destroyed) reply.raw.write(': keepalive\n\n')
    }, 25_000)
    reply.raw.on('close', () => {
      clearInterval(heartbeat)
      subscribers.delete(reply.raw)
    })
  })
}

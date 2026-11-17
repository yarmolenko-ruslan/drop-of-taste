import { subscribeSiteUpdate } from './siteUpdates'

test('восстановление соединения обновляет данные, последняя отписка закрывает ресурсы', () => {
  const streams: EventTarget[] = []
  const closeStream = vi.fn()
  const closeChannel = vi.fn()
  vi.stubGlobal(
    'EventSource',
    class extends EventTarget {
      constructor() {
        super()
        streams.push(this)
      }
      close = closeStream
    },
  )
  vi.stubGlobal(
    'BroadcastChannel',
    class extends EventTarget {
      postMessage() {}
      close = closeChannel
    },
  )
  const catalog = vi.fn()
  const content = vi.fn()
  const stopCatalog = subscribeSiteUpdate('catalog', catalog)
  const stopContent = subscribeSiteUpdate('content', content)
  try {
    const stream = streams[0]!
    stream.dispatchEvent(new Event('open'))
    expect(catalog).not.toHaveBeenCalled()
    stream.dispatchEvent(new Event('error'))
    stream.dispatchEvent(new Event('open'))
    expect(catalog).toHaveBeenCalledOnce()
    expect(content).toHaveBeenCalledOnce()
    stream.dispatchEvent(new Event('catalog'))
    expect(catalog).toHaveBeenCalledTimes(2)
    stopCatalog()
    expect(closeStream).not.toHaveBeenCalled()
    stopContent()
    stopContent()
    expect(closeStream).toHaveBeenCalledOnce()
    expect(closeChannel).toHaveBeenCalledOnce()
  } finally {
    stopCatalog()
    stopContent()
    vi.unstubAllGlobals()
  }
})

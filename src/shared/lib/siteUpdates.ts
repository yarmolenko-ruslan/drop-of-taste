type SiteUpdate = 'content' | 'catalog'

const eventName = 'drop-of-taste:site-update'
const channelName = 'drop-of-taste:site-updates'
let channel: BroadcastChannel | null = null
let stream: EventSource | null = null
let subscriptions = 0

function emitUpdate(kind: SiteUpdate) {
  window.dispatchEvent(new CustomEvent<SiteUpdate>(eventName, { detail: kind }))
}

function getChannel() {
  if (typeof BroadcastChannel === 'undefined') return null
  channel ??= new BroadcastChannel(channelName)
  return channel
}

function getStream() {
  if (typeof EventSource === 'undefined') return null
  if (!stream) {
    stream = new EventSource('/api/site-updates')
    let interrupted = false
    stream.addEventListener('error', () => {
      interrupted = true
    })
    stream.addEventListener('open', () => {
      if (!interrupted) return
      interrupted = false
      emitUpdate('content')
      emitUpdate('catalog')
    })
    for (const kind of ['content', 'catalog'] as const) {
      stream.addEventListener(kind, () => emitUpdate(kind))
    }
  }
  return stream
}

export function publishSiteUpdate(kind: SiteUpdate) {
  emitUpdate(kind)
  getChannel()?.postMessage(kind)
}

export function subscribeSiteUpdate(kind: SiteUpdate, refresh: () => void) {
  subscriptions++
  const local = (event: Event) => {
    if ((event as CustomEvent<SiteUpdate>).detail === kind) refresh()
  }
  const remote = (event: MessageEvent<SiteUpdate>) => {
    if (event.data === kind) refresh()
  }
  window.addEventListener(eventName, local)
  getStream()
  const updates = getChannel()
  updates?.addEventListener('message', remote)
  let active = true
  return () => {
    if (!active) return
    active = false
    window.removeEventListener(eventName, local)
    updates?.removeEventListener('message', remote)
    if (--subscriptions === 0) {
      stream?.close()
      stream = null
      channel?.close()
      channel = null
    }
  }
}

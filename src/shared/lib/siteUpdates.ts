export type SiteUpdate = 'content' | 'catalog'

const eventName = 'drop-of-taste:site-update'
const channelName = 'drop-of-taste:site-updates'
let channel: BroadcastChannel | null = null
let stream: EventSource | null = null

function getChannel() {
  if (typeof BroadcastChannel === 'undefined') return null
  channel ??= new BroadcastChannel(channelName)
  return channel
}

function getStream() {
  if (typeof EventSource === 'undefined') return null
  if (!stream) {
    stream = new EventSource('/api/site-updates')
    for (const kind of ['content', 'catalog'] as const) {
      stream.addEventListener(kind, () =>
        window.dispatchEvent(new CustomEvent<SiteUpdate>(eventName, { detail: kind })),
      )
    }
  }
  return stream
}

export function publishSiteUpdate(kind: SiteUpdate) {
  window.dispatchEvent(new CustomEvent<SiteUpdate>(eventName, { detail: kind }))
  getChannel()?.postMessage(kind)
}

export function subscribeSiteUpdate(kind: SiteUpdate, refresh: () => void) {
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
  return () => {
    window.removeEventListener(eventName, local)
    updates?.removeEventListener('message', remote)
  }
}

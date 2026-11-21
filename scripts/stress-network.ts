/** Restrict the stress process to its own local HTTP server, even if a real provider is wired by mistake. */
export function restrictStressFetch() {
  const original = globalThis.fetch
  const allowedOrigins = new Set<string>()
  let blocked = 0
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    if (!allowedOrigins.has(url.origin)) {
      blocked++
      throw new Error('Stress test blocked an external HTTP request')
    }
    return original(input, { ...init, redirect: 'error' })
  }
  return {
    allowLocalOrigin(origin: string) {
      const url = new URL(origin)
      if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
        throw new Error('Stress test only permits a local HTTP origin')
      allowedOrigins.add(url.origin)
    },
    get blockedRequests() {
      return blocked
    },
    restore() {
      globalThis.fetch = original
    },
  }
}

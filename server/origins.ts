/**
 * Проверка Origin для мутаирующих запросов локального stub-API.
 * Точное совпадение с разрешённым списком плюс любой http-origin с локального
 * хоста: vite в dev может подняться на любом свободном порте, и фиксированный
 * APP_ORIGIN тогда отклонял бы все запросы с фронта (симптомы выглядели бы как
 * «бэкенд не работает»).
 */
export function createOriginChecker(origins: readonly string[]) {
  const allowed = new Set(origins)
  return (origin: string | undefined): boolean => {
    if (!origin) return false
    if (allowed.has(origin)) return true
    try {
      const url = new URL(origin)
      return url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)
    } catch {
      return false
    }
  }
}

/** Схема, хост и порт должны точно совпадать с конфигурацией приложения. */
export function createOriginChecker(origins: readonly string[]) {
  const allowed = new Set(origins)
  return (origin: string | undefined): boolean => origin !== undefined && allowed.has(origin)
}

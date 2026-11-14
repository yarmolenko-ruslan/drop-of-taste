import type { PaymentGateway, YooPayment } from './yookassa.ts'

// Одинаковые проверки из вкладок и фонового задания используют один запрос.
// Лимит защищает провайдера и API от лавины разных платежей; очередь не накапливается.
export function createPaymentReader(gateway: PaymentGateway) {
  const inFlight = new Map<string, Promise<YooPayment>>()
  return (id: string): Promise<YooPayment> => {
    const running = inFlight.get(id)
    if (running) return running
    if (inFlight.size >= 8) return Promise.reject(new Error('PAYMENT_CHECK_BUSY'))
    const request = Promise.resolve()
      .then(() => gateway.get(id))
      .finally(() => {
        inFlight.delete(id)
      })
    inFlight.set(id, request)
    return request
  }
}

// Создание разных платежей тоже ограничено: один клиент не должен занять все соединения ЮKassa.
export function createPaymentStarter(gateway: PaymentGateway): PaymentGateway['create'] {
  let active = 0
  return async (...args) => {
    if (active >= 4) throw new Error('PAYMENT_CREATION_BUSY')
    active++
    try {
      return await gateway.create(...args)
    } finally {
      active--
    }
  }
}

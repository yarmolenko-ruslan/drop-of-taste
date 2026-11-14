// @vitest-environment node
import { createPaymentReader } from './payment-reader.ts'
import type { YooPayment } from './yookassa.ts'

const payment = (id: string): YooPayment => ({
  id,
  status: 'pending',
  paid: false,
  test: true,
  amount: { value: '324.00', currency: 'RUB' },
})

test('1000 параллельных проверок одного платежа вызывают провайдера один раз', async () => {
  let release!: (value: YooPayment) => void
  const get = vi.fn(
    () =>
      new Promise<YooPayment>((resolve) => {
        release = resolve
      }),
  )
  const read = createPaymentReader({ create: vi.fn(), get })
  const checks = Array.from({ length: 1000 }, () => read('same-payment'))
  await Promise.resolve()
  expect(get).toHaveBeenCalledTimes(1)
  release(payment('same-payment'))
  expect(await Promise.all(checks)).toHaveLength(1000)
  const again = read('same-payment')
  await Promise.resolve()
  expect(get).toHaveBeenCalledTimes(2)
  release(payment('same-payment'))
  await again
}, 2000)

test('лавина различных ID ограничена восемью запросами и не создаёт очередь', async () => {
  const releases: (() => void)[] = []
  let active = 0
  let maxActive = 0
  const get = vi.fn(
    (id: string) =>
      new Promise<YooPayment>((resolve) => {
        active++
        maxActive = Math.max(maxActive, active)
        releases.push(() => {
          active--
          resolve(payment(id))
        })
      }),
  )
  const read = createPaymentReader({ create: vi.fn(), get })
  const checks = Promise.allSettled(Array.from({ length: 1000 }, (_, index) => read(`p-${index}`)))
  await Promise.resolve()
  expect(maxActive).toBe(8)
  for (const release of releases) release()
  const results = await checks
  expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(8)
  expect(results.filter((item) => item.status === 'rejected')).toHaveLength(992)
  expect(get).toHaveBeenCalledTimes(8)
})

test('ошибка провайдера не застревает в общем запросе', async () => {
  const get = vi.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValue(payment('p1'))
  const read = createPaymentReader({ create: vi.fn(), get })
  await expect(read('p1')).rejects.toThrow('timeout')
  await expect(read('p1')).resolves.toEqual(payment('p1'))
})

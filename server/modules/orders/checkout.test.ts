// @vitest-environment node
import type { Db } from 'mongodb'
import { vi } from 'vitest'
import { defaultSiteContent } from '../../../shared/site-content.ts'
import { calculateQuote } from './checkout.ts'

vi.mock('../content/service.ts', () => ({
  getSiteContent: vi.fn(async () => defaultSiteContent),
}))

function pricingDb(birthday = '', claimed = false) {
  const products = [
    { _id: 'borscht', name: 'Борщ', priceKopecks: 36_000, categoryId: 'soups', available: true },
    { _id: 'combo', name: 'Комбо', priceKopecks: 99_000, categoryId: 'combo', available: true },
  ]
  return {
    collection(name: string) {
      if (name === 'catalog') return { find: () => ({ toArray: async () => products }) }
      if (name === 'bonus_codes')
        return {
          findOne: async () => ({
            _id: 'RUB100',
            kind: 'rubles',
            value: 100,
            active: true,
            startsAt: new Date(Date.now() - 60_000).toISOString(),
            endsAt: new Date(Date.now() + 60_000).toISOString(),
          }),
        }
      if (name === 'users') return { findOne: async () => ({ birthday }) }
      if (name === 'birthday_claims')
        return { findOne: async () => (claimed ? { state: 'used' } : null) }
      throw new Error(`Неожиданная коллекция: ${name}`)
    },
  } as unknown as Db
}

const pickup = { mode: 'pickup' as const, label: defaultSiteContent.address }
const delivery = {
  mode: 'delivery' as const,
  label: 'ул. Мира, 10',
  details: {
    street: 'ул. Мира, 10',
    entrance: '',
    floor: '',
    flat: '',
    comment: '',
    isHouse: true,
  },
}
const line = (productId: string, quantity = 1) => ({ productId, quantity, extras: [] })

test('сервер берёт цену товара из каталога и отдаёт объяснение скидки', async () => {
  const quote = await calculateQuote(pricingDb(), { lines: [line('borscht')], fulfillment: pickup })
  expect(quote).toMatchObject({
    subtotalKopecks: 36_000,
    discountKopecks: 3_600,
    totalKopecks: 32_400,
    adjustments: [{ label: 'Скидка за самовывоз (10%)', amountKopecks: -3_600 }],
  })
  expect(quote.lines[0]?.unitPriceKopecks).toBe(36_000)
})

test('сервер выбирает более выгодный бонус-код без скидки на комбо', async () => {
  const quote = await calculateQuote(pricingDb(), {
    lines: [line('borscht'), line('combo')],
    fulfillment: pickup,
    promoCode: 'rub100',
  })
  expect(quote).toMatchObject({
    subtotalKopecks: 135_000,
    discountableSubtotalKopecks: 36_000,
    discountKopecks: 0,
    promoDiscountKopecks: 10_000,
    totalKopecks: 125_000,
    adjustments: [{ label: 'Бонус-код RUB100', amountKopecks: -10_000 }],
  })
})

test('сервер добавляет платную доставку и рассчитывает порог бесплатной', async () => {
  const paid = await calculateQuote(pricingDb(), {
    lines: [line('borscht', 2)],
    fulfillment: delivery,
  })
  expect(paid).toMatchObject({
    subtotalKopecks: 72_000,
    deliveryKopecks: 25_000,
    totalKopecks: 97_000,
    adjustments: [{ label: 'Доставка', amountKopecks: 25_000 }],
  })
  const free = await calculateQuote(pricingDb(), {
    lines: [line('borscht', 5)],
    fulfillment: delivery,
  })
  expect(free).toMatchObject({
    subtotalKopecks: 180_000,
    deliveryKopecks: 0,
    totalKopecks: 180_000,
    adjustments: [{ label: 'Доставка', amountKopecks: 0 }],
  })
})

test('скидка ко дню рождения выбирается сервером и не суммируется с другими', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-11T06:00:00Z'))
  try {
    const quote = await calculateQuote(
      pricingDb('1990-11-11'),
      {
        lines: [line('borscht'), line('combo')],
        fulfillment: pickup,
        birthdayDiscount: true,
      },
      'account-1',
    )
    expect(quote).toMatchObject({
      birthdayYear: 2026,
      birthdayDiscountKopecks: 3600,
      discountKopecks: 0,
      totalKopecks: 131400,
      adjustments: [{ label: 'Скидка ко дню рождения (10%)', amountKopecks: -3600 }],
    })
    await expect(
      calculateQuote(
        pricingDb('1990-06-11'),
        {
          lines: [line('borscht')],
          fulfillment: pickup,
          birthdayDiscount: true,
        },
        'account-1',
      ),
    ).rejects.toThrow('BIRTHDAY_OUTSIDE_WINDOW')
    await expect(
      calculateQuote(
        pricingDb(''),
        {
          lines: [line('borscht')],
          fulfillment: pickup,
          birthdayDiscount: true,
        },
        'account-1',
      ),
    ).rejects.toThrow('BIRTHDAY_DATE_REQUIRED')
    await expect(
      calculateQuote(
        pricingDb('1990-11-11', true),
        {
          lines: [line('borscht')],
          fulfillment: pickup,
          birthdayDiscount: true,
        },
        'account-1',
      ),
    ).rejects.toThrow('BIRTHDAY_ALREADY_USED')
    const promoWins = await calculateQuote(
      pricingDb('1990-11-11', true),
      {
        lines: [line('borscht')],
        fulfillment: pickup,
        birthdayDiscount: true,
        promoCode: 'RUB100',
      },
      'account-1',
    )
    expect(promoWins).toMatchObject({
      promoDiscountKopecks: 10_000,
      birthdayDiscountKopecks: 0,
      totalKopecks: 26_000,
    })
  } finally {
    vi.useRealTimers()
  }
})

import { bonusCodeDiscount, type BonusCode } from './bonus-code.ts'

const code: BonusCode = {
  _id: 'TEST',
  kind: 'percent',
  value: 12.5,
  startsAt: '2026-11-09T10:00:00+07:00',
  endsAt: '2026-11-09T11:00:00+07:00',
  active: true,
}

test('срок действия кода включает начало и исключает окончание с учётом часового пояса', () => {
  expect(bonusCodeDiscount(code, 10000, new Date('2026-11-09T03:00:00Z'))).toBe(1250)
  expect(bonusCodeDiscount(code, 10000, new Date('2026-11-09T04:00:00Z'))).toBeNull()
  expect(bonusCodeDiscount(code, 10000, new Date('2026-11-09T02:59:59Z'))).toBeNull()
})

test('рублёвая скидка ограничивается стоимостью подходящих блюд', () => {
  expect(
    bonusCodeDiscount(
      { ...code, kind: 'rubles', value: 500 },
      30000,
      new Date('2026-11-09T03:30:00Z'),
    ),
  ).toBe(30000)
})

test('испорченный срок в базе не включает код бессрочно', () => {
  expect(
    bonusCodeDiscount({ ...code, endsAt: 'bad-date' }, 10000, new Date('2026-11-09T03:30:00Z')),
  ).toBeNull()
})

import { birthdayCelebrationYear } from './birthday.ts'

test('окно ±3 дня включительно по красноярскому времени', () => {
  const at = (date: string) => new Date(date)
  expect(birthdayCelebrationYear('1990-11-11', at('2026-11-07T16:59:00Z'))).toBeNull()
  expect(birthdayCelebrationYear('1990-11-11', at('2026-11-07T17:00:00Z'))).toBe(2026)
  expect(birthdayCelebrationYear('1990-11-11', at('2026-11-14T16:59:00Z'))).toBe(2026)
  expect(birthdayCelebrationYear('1990-11-11', at('2026-11-14T17:00:00Z'))).toBeNull()
})

test('год празднования сохраняется на границе лет и 29 февраля переносится на 28-е', () => {
  expect(birthdayCelebrationYear('1990-01-01', new Date('2026-12-29T17:00:00Z'))).toBe(2027)
  expect(birthdayCelebrationYear('1990-01-01', new Date('2027-01-04T17:00:00Z'))).toBeNull()
  expect(birthdayCelebrationYear('1990-12-31', new Date('2027-01-01T03:00:00Z'))).toBe(2026)
  expect(birthdayCelebrationYear('1992-02-29', new Date('2027-02-24T17:00:00Z'))).toBe(2027)
  expect(birthdayCelebrationYear('1992-02-29', new Date('2027-03-03T17:00:00Z'))).toBeNull()
  expect(birthdayCelebrationYear('1992-02-29', new Date('2027-02-27T17:00:00Z'))).toBe(2027)
  expect(birthdayCelebrationYear('1992-02-29', new Date('2028-02-28T17:00:00Z'))).toBe(2028)
})

import { formatRussianPhone, formatRussianPhoneInput } from './phone.ts'

test('единый формат телефона для контактов и ввода в админке', () => {
  expect(formatRussianPhone('+79998887766')).toBe('+7 (999) 888-77-66')
  expect(formatRussianPhone('8 999 888 77 66')).toBe('+7 (999) 888-77-66')
  expect(formatRussianPhoneInput('9998887766', '')).toBe('+7 (999) 888-77-66')
  expect(formatRussianPhone('')).toBe('')
})

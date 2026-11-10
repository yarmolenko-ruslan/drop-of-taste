import { addressDetailsSchema } from './address.ts'
import { phoneSchema } from './phone.ts'
import { birthDateSchema, birthdayStringSchema, isRealBirthday, profileSchema } from './profile.ts'

test('phoneSchema нормализует форматированный номер и отклоняет некорректные записи', () => {
  expect(phoneSchema.safeParse('+7 (999) 123-45-67').data).toBe('+79991234567')
  expect(phoneSchema.safeParse('8 (999) 123-45-67').data).toBe('+79991234567')
  expect(phoneSchema.safeParse('79991234567').data).toBe('+79991234567')
  expect(phoneSchema.safeParse('7+9991234567').success).toBe(false)
  expect(phoneSchema.safeParse('+7abc9991234567').success).toBe(false)
  expect(phoneSchema.safeParse('123').success).toBe(false)
  expect(phoneSchema.safeParse('+7 (999) 123-45-6').success).toBe(false)
})

test('addressDetailsSchema требует подъезд, этаж и квартиру, пока не отмечен частный дом', () => {
  const base = {
    street: 'ул. Мира, 10',
    entrance: '',
    floor: '',
    flat: '',
    comment: '',
    isHouse: false,
  }
  const apartment = addressDetailsSchema.safeParse(base)
  expect(apartment.success).toBe(false)
  if (!apartment.success) {
    expect(apartment.error.issues.map((issue) => issue.message)).toEqual([
      'Укажите подъезд',
      'Укажите этаж',
      'Укажите квартиру',
    ])
  }

  expect(addressDetailsSchema.safeParse({ ...base, isHouse: true }).success).toBe(true)
  expect(
    addressDetailsSchema.safeParse({ ...base, entrance: '2', floor: '3', flat: '25' }).success,
  ).toBe(true)
})

test('addressDetailsSchema принимает в подъезде и этаже только цифры, до 3 знаков', () => {
  const valid = {
    street: 'ул. Мира, 10',
    entrance: '2',
    floor: '3',
    flat: '25',
    comment: '',
    isHouse: false,
  }
  for (const entrance of ['2а', '1234', '-1']) {
    const result = addressDetailsSchema.safeParse({ ...valid, entrance })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('Подъезд — только цифры, до 3 знаков')
    }
  }
  expect(addressDetailsSchema.safeParse(valid).data).toEqual(valid)
})

test('addressDetailsSchema ограничивает длину адреса и комментария', () => {
  const base = {
    street: 'ул. Мира, 10',
    entrance: '2',
    floor: '3',
    flat: '25',
    comment: '',
    isHouse: false,
  }
  expect(addressDetailsSchema.safeParse({ ...base, street: 'ул. М' }).success).toBe(false)
  expect(addressDetailsSchema.safeParse({ ...base, street: 'а'.repeat(121) }).success).toBe(false)
  expect(addressDetailsSchema.safeParse({ ...base, comment: 'а'.repeat(301) }).success).toBe(false)
  expect(addressDetailsSchema.safeParse({ ...base, flat: '12345678901' }).success).toBe(false)
})

test('profileSchema проверяет имя и необязательную почту', () => {
  expect(profileSchema.safeParse({ name: 'Руслан Ярмоленко', email: '' }).success).toBe(true)
  expect(profileSchema.safeParse({ name: 'Руслан', email: 'test@example.ru' }).success).toBe(true)
  expect(profileSchema.safeParse({ name: '', email: '' }).error?.issues[0]?.message).toBe(
    'Введите имя',
  )
  expect(profileSchema.safeParse({ name: 'Руслан', email: 'не-почта' }).success).toBe(false)
  expect(profileSchema.safeParse({ name: 'Руслан123', email: '' }).success).toBe(false)
  expect(profileSchema.safeParse({ name: 'Я'.repeat(22), email: '' }).success).toBe(true)
  expect(
    profileSchema.safeParse({ name: 'Я'.repeat(23), email: '' }).error?.issues[0]?.message,
  ).toBe('Имя — не более 22 символов')
})

test('profileSchema обрезает пробелы у почты, но не принимает пробел внутри', () => {
  expect(profileSchema.safeParse({ name: 'Руслан', email: '  test@example.ru ' }).data).toEqual({
    name: 'Руслан',
    email: 'test@example.ru',
  })
  expect(profileSchema.safeParse({ name: 'Руслан', email: 'test @example.ru' }).success).toBe(false)
  expect(profileSchema.safeParse({ name: ' Руслан ', email: '' }).data?.name).toBe('Руслан')
})

test('birthdayStringSchema и isRealBirthday проверяют сериализованную дату', () => {
  expect(birthdayStringSchema.safeParse('').success).toBe(true)
  expect(birthdayStringSchema.safeParse('1990-02-28').success).toBe(true)
  expect(birthdayStringSchema.safeParse('1990-2-8').success).toBe(false)
  expect(isRealBirthday('')).toBe(true)
  expect(isRealBirthday('1900-02-29')).toBe(false)
  expect(isRealBirthday('2000-02-29')).toBe(true)
  expect(isRealBirthday('1990-13-01')).toBe(false)
})

test('birthDateSchema принимает пустую или реальную дату и отклоняет несуществующую', () => {
  expect(birthDateSchema.safeParse({ day: '', month: '', year: '' }).success).toBe(true)
  expect(birthDateSchema.safeParse({ day: '29', month: '2', year: '1992' }).success).toBe(true)
  expect(birthDateSchema.safeParse({ day: '31', month: '2', year: '1990' }).success).toBe(false)
  expect(birthDateSchema.safeParse({ day: '1', month: '', year: '1990' }).success).toBe(false)
  expect(birthDateSchema.safeParse({ day: '31', month: '12', year: '999' }).success).toBe(true)
})

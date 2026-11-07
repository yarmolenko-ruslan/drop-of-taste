import { formatCompactAddress } from './formatCompactAddress'

const details = {
  street: 'мира 10',
  entrance: '1',
  floor: '1',
  flat: '1',
  comment: '',
  isHouse: false,
}

test('сокращает адрес и выделяет номер дома без изменения данных', () => {
  expect(formatCompactAddress(details)).toBe('ул. Мира, д. 10, под. 1, эт. 1, кв. 1')
  expect(details.street).toBe('мира 10')
})

test('не дублирует уже указанную улицу и учитывает частный дом', () => {
  expect(formatCompactAddress({ ...details, street: 'ул. мира, дом 10', isHouse: true })).toBe(
    'ул. Мира, д. 10',
  )
})

test('сохраняет тип проспекта', () => {
  expect(formatCompactAddress({ ...details, street: 'проспект мира 10к2' })).toBe(
    'Пр-т Мира, д. 10к2, под. 1, эт. 1, кв. 1',
  )
})

test('отделяет город от улицы, введённый через запятую', () => {
  expect(formatCompactAddress({ ...details, street: 'красноярск, мира 17' })).toBe(
    'г. Красноярск, ул. Мира, д. 17, под. 1, эт. 1, кв. 1',
  )
  expect(formatCompactAddress({ ...details, street: 'г. Красноярск, ул. Мира, 17' })).toBe(
    'г. Красноярск, ул. Мира, д. 17, под. 1, эт. 1, кв. 1',
  )
  expect(formatCompactAddress({ ...details, street: 'город Ульяновск, Домодедовская 17' })).toBe(
    'г. Ульяновск, ул. Домодедовская, д. 17, под. 1, эт. 1, кв. 1',
  )
})

test('не принимает название улицы за город перед номером дома', () => {
  expect(formatCompactAddress({ ...details, street: 'Мира, дом 17' })).toBe(
    'ул. Мира, д. 17, под. 1, эт. 1, кв. 1',
  )
})

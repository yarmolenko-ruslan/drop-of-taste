import { searchCatalog } from './searchCatalog'

const categories = [
  {
    id: 'breakfast',
    title: 'Завтраки',
    products: [
      { name: 'Сырники с ягодами', details: 'Творог и сметана', ingredients: ['Мёд'] },
      { name: 'Овсяная каша', details: 'С ягодами', ingredients: ['Молоко'] },
    ],
  },
  {
    id: 'desserts',
    title: 'Десерты',
    products: [
      { name: 'Медовик', details: 'Нежный торт', ingredients: ['Мёд'] },
      { name: 'Торт с ёжевикой', details: 'Домашний', ingredients: ['Ягоды'] },
    ],
  },
]

test('ищет по названию, описанию и составу без учёта регистра и ё', () => {
  expect(searchCatalog(categories, 'ЕЖЕВИК').map(({ product }) => product.name)).toEqual([
    'Торт с ёжевикой',
  ])
  expect(searchCatalog(categories, 'творог').map(({ product }) => product.name)).toEqual([
    'Сырники с ягодами',
  ])
  expect(searchCatalog(categories, 'молоко').map(({ product }) => product.name)).toEqual([
    'Овсяная каша',
  ])
})

test('требует все слова запроса и ставит совпадения в названии первыми', () => {
  expect(searchCatalog(categories, 'ягод каша').map(({ product }) => product.name)).toEqual([
    'Овсяная каша',
  ])
  expect(searchCatalog(categories, 'мёд').map(({ product }) => product.name)).toEqual([
    'Медовик',
    'Сырники с ягодами',
  ])
  expect(searchCatalog(categories, '   ')).toEqual([])
})

import type { CatalogProduct, ProductBadge } from './product'
import type { HomeCombo } from './homeCatalog'

export type DialogItem = {
  id: string
  name: string
  description: string
  image?: string
  imageAlt?: string
  badges: readonly ProductBadge[]
  measure: 'г' | 'мл'
  amount: number | null
  calories: number | null
  priceRub: number | null
  ingredients: readonly string[]
  allergenNote?: string
  variants: readonly string[]
  extras: readonly string[]
}

type ProductCopy = { description: string; ingredients: readonly string[] }

const productCopy: Record<string, ProductCopy> = {
  ukha: {
    description:
      'Ароматная домашняя уха с нежной рыбой, картофелем и свежим укропом. Подаём горячей, с лёгким рыбным бульоном.',
    ingredients: ['Рыба', 'Картофель', 'Морковь', 'Лук', 'Укроп'],
  },
  kurnik: {
    description:
      'Румяный пирог с сочной начинкой из курицы, грибов и картофеля. Выпекаем до золотистой корочки.',
    ingredients: ['Курица', 'Грибы', 'Картофель', 'Лук', 'Тесто'],
  },
  smetannik: {
    description:
      'Домашний сметанник с мягкими коржами и нежным кремом. Тот самый десерт к чашке чая.',
    ingredients: ['Сметана', 'Мука', 'Яйцо', 'Сахар'],
  },
  'cranberry-mors': {
    description:
      'Освежающий морс из северной клюквы с приятной ягодной кислинкой. Готовим небольшими партиями.',
    ingredients: ['Клюква', 'Вода', 'Сахар'],
  },
  'cabbage-pie': {
    description: 'Пышный печёный пирожок с тушёной капустой в мягком дрожжевом тесте.',
    ingredients: ['Капуста', 'Дрожжевое тесто', 'Лук'],
  },
  'home-cutlets': {
    description:
      'Сочные котлеты по домашнему рецепту с воздушным картофельным пюре. Сытный обед на каждый день.',
    ingredients: ['Мясо', 'Картофель', 'Лук', 'Молоко'],
  },
  medovik: {
    description:
      'Тонкие медовые коржи, пропитанные лёгким сметанным кремом. Вкус, знакомый с детства.',
    ingredients: ['Мёд', 'Сметана', 'Мука', 'Яйцо'],
  },
  'sea-buckthorn-mors': {
    description: 'Яркий морс из облепихи с мягкой кислинкой и насыщенным ягодным ароматом.',
    ingredients: ['Облепиха', 'Вода', 'Сахар'],
  },
  syrniki: {
    description:
      'Нежные сырники из фермерского творога с румяной корочкой. Подаём со сметаной и ягодным соусом.',
    ingredients: ['Творог', 'Яйцо', 'Мука', 'Сметана', 'Ягоды'],
  },
  oatmeal: {
    description: 'Тёплая овсяная каша на молоке с ягодами, клюквой и каплей мёда.',
    ingredients: ['Овсяные хлопья', 'Молоко', 'Ягоды', 'Мёд'],
  },
  'ham-omelet': {
    description: 'Пышный омлет из трёх яиц с ветчиной и сыром. Дополняем тостом и свежей зеленью.',
    ingredients: ['Яйцо', 'Ветчина', 'Сыр', 'Тост', 'Зелень'],
  },
  'cottage-cheese-blini': {
    description: 'Тонкие домашние блинчики с мягкой творожной начинкой. Подаём со сметаной.',
    ingredients: ['Блины', 'Творог', 'Сметана'],
  },
  olivier: {
    description:
      'Любимый салат с говядиной, овощами и домашним майонезом. Готовим по знакомому семейному рецепту.',
    ingredients: ['Говядина', 'Картофель', 'Морковь', 'Огурец', 'Майонез'],
  },
  vinaigrette: {
    description: 'Свежий винегрет из свёклы, картофеля, квашеной капусты и солёного огурчика.',
    ingredients: ['Свёкла', 'Картофель', 'Капуста', 'Огурец'],
  },
  'herring-fur-coat': {
    description:
      'Сельдь под шубой с нежными слоями овощей и домашнего майонеза — праздничная классика.',
    ingredients: ['Сельдь', 'Свёкла', 'Картофель', 'Морковь', 'Майонез'],
  },
  'chicken-caesar': {
    description:
      'Хрустящий романо с курицей гриль, сухариками и пармезаном под фирменной заправкой.',
    ingredients: ['Курица', 'Романо', 'Пармезан', 'Сухарики', 'Соус'],
  },
  borscht: {
    description:
      'Наваристый борщ на говяжьем бульоне со свёклой, капустой и томатами. Подаём со сметаной и чесночными пампушками.',
    ingredients: ['Говядина', 'Свёкла', 'Капуста', 'Картофель', 'Лук', 'Чеснок', 'Зелень'],
  },
  solyanka: {
    description:
      'Густая сборная солянка с копчёностями, оливками и лимоном. Яркий вкус и согревающий бульон.',
    ingredients: ['Копчёности', 'Оливки', 'Лимон', 'Лук', 'Томат'],
  },
  'chicken-noodle-soup': {
    description: 'Прозрачный куриный бульон с домашней лапшой, овощами и свежей зеленью.',
    ingredients: ['Курица', 'Лапша', 'Морковь', 'Лук', 'Зелень'],
  },
  'beef-stroganoff': {
    description: 'Нежные кусочки говядины в сливочно грибном соусе. Подаём горячими с гарниром.',
    ingredients: ['Говядина', 'Грибы', 'Сливки', 'Лук'],
  },
  'cabbage-rolls': {
    description: 'Домашние голубцы с мясом и рисом в мягких капустных листьях под томатным соусом.',
    ingredients: ['Капуста', 'Мясо', 'Рис', 'Томат'],
  },
  pelmeni: {
    description:
      'Пельмени ручной лепки с сочной мясной начинкой. Подаём со сметаной или сливочным маслом.',
    ingredients: ['Тесто', 'Мясо', 'Лук', 'Сметана'],
  },
  'home-roast': {
    description:
      'Горячее жаркое из свинины и картофеля с луком, поданное прямо на чугунной сковороде.',
    ingredients: ['Свинина', 'Картофель', 'Лук', 'Зелень'],
  },
  draniki: {
    description: 'Хрустящие драники из тёртого картофеля. Подаём со свежей сметаной.',
    ingredients: ['Картофель', 'Лук', 'Сметана'],
  },
  'potatoes-mushrooms': {
    description: 'Румяный картофель, обжаренный с грибами и луком до аппетитной корочки.',
    ingredients: ['Картофель', 'Грибы', 'Лук', 'Зелень'],
  },
  'liver-onions': {
    description: 'Нежная куриная печень с луком в сметанном соусе. Сытное блюдо с домашним вкусом.',
    ingredients: ['Куриная печень', 'Лук', 'Сметана'],
  },
  vatrushka: {
    description: 'Пышная ватрушка из сдобного теста с ванильным творогом в центре.',
    ingredients: ['Тесто', 'Творог', 'Ваниль', 'Яйцо'],
  },
  pampushki: {
    description: 'Мягкие горячие пампушки с чесноком и зеленью. Особенно хороши к борщу.',
    ingredients: ['Мука', 'Чеснок', 'Зелень'],
  },
  napoleon: {
    description:
      'Хрустящие слоёные коржи с нежным заварным кремом. Классический домашний «Наполеон».',
    ingredients: ['Слоёное тесто', 'Молоко', 'Яйцо', 'Сахар'],
  },
  sharlotka: {
    description: 'Тёплая яблочная шарлотка с воздушным тестом. Подаём с шариком пломбира.',
    ingredients: ['Яблоки', 'Мука', 'Яйцо', 'Сахар', 'Пломбир'],
  },
  cappuccino: {
    description: 'Эспрессо из зёрен свежей обжарки с нежной молочной пеной.',
    ingredients: ['Кофе', 'Молоко'],
  },
  latte: {
    description:
      'Мягкий кофе с большим количеством тёплого молока. Можно дополнить любимым сиропом.',
    ingredients: ['Кофе', 'Молоко'],
  },
  'herbal-tea': {
    description:
      'Ароматный травяной чай с чабрецом, мятой и смородиной. Согревает и помогает замедлиться.',
    ingredients: ['Чабрец', 'Мята', 'Смородина'],
  },
}

const soupIds = new Set(['ukha', 'borscht', 'solyanka', 'chicken-noodle-soup'])
const coffeeIds = new Set(['cappuccino', 'latte'])
const morsIds = new Set(['cranberry-mors', 'sea-buckthorn-mors'])
const sweetIds = new Set([
  'smetannik',
  'medovik',
  'napoleon',
  'sharlotka',
  'syrniki',
  'cottage-cheese-blini',
  'vatrushka',
])
const bakeryIds = new Set(['cabbage-pie', 'kurnik', 'pampushki'])
const saladIds = new Set(['olivier', 'vinaigrette', 'herring-fur-coat', 'chicken-caesar'])

function extrasForProduct(id: string): readonly string[] {
  if (soupIds.has(id)) return ['Сметана', 'Пампушки с чесноком', 'Зелень']
  if (coffeeIds.has(id)) return ['Сироп', 'Растительное молоко', 'Сливки']
  if (morsIds.has(id)) return ['Лёд', 'Мята', 'Лимон']
  if (id === 'herbal-tea') return ['Лимон', 'Мёд']
  if (sweetIds.has(id)) return ['Ягодный соус', 'Пломбир', 'Сметана']
  if (id === 'oatmeal') return ['Ягоды', 'Мёд', 'Орехи']
  if (bakeryIds.has(id)) return ['Сметана', 'Чесночный соус']
  if (saladIds.has(id)) return ['Дополнительная заправка', 'Зелень']
  return ['Сметана', 'Чесночный соус', 'Зелень']
}

export function dialogItemFromProduct(product: CatalogProduct): DialogItem {
  const copy = productCopy[product.id]
  return {
    ...product,
    description: copy?.description ?? `${product.name}. ${product.details}.`,
    ingredients: copy?.ingredients ?? [],
    allergenNote:
      product.id === 'ukha'
        ? 'Содержит рыбу. Может содержать следы глютена.'
        : coffeeIds.has(product.id)
          ? 'Содержит молоко.'
          : morsIds.has(product.id) || product.id === 'herbal-tea'
            ? undefined
            : sweetIds.has(product.id) || bakeryIds.has(product.id)
              ? 'Может содержать молоко, яйцо и глютен.'
              : 'Информацию об аллергенах уточняйте при заказе.',
    variants: product.measure === 'мл' ? ['300 мл', '500 мл'] : ['Обычная', 'Большая'],
    extras: extrasForProduct(product.id),
  }
}

export function dialogItemFromCombo(combo: HomeCombo): DialogItem {
  return {
    id: combo.id,
    name: combo.name,
    description: `Готовый набор ${combo.portions}. Внутри: ${combo.details}. Собрали любимые домашние блюда в одном заказе.`,
    image: combo.image,
    imageAlt: combo.name,
    badges: [],
    measure: 'г',
    amount: null,
    calories: null,
    priceRub: null,
    ingredients: combo.details.split(', '),
    allergenNote: 'Состав и аллергены блюд набора уточняйте при заказе.',
    variants: ['Один набор'],
    extras: ['Сметана', 'Соус на выбор', 'Приборы'],
  }
}

export function dialogItemFromSauce(name: string): DialogItem {
  const descriptions: Record<string, string> = {
    Сметана: 'Нежная густая сметана к супам, драникам и домашним пельменям.',
    Чесночный: 'Ароматный соус с чесноком и зеленью к горячим блюдам и выпечке.',
    Горчица: 'Пряная горчица с выразительной остротой к мясу и закускам.',
    'Хрен со свёклой': 'Острый хрен со свёклой — яркое дополнение к мясным блюдам.',
    Аджика: 'Насыщенная аджика с томатами, перцем и ароматными специями.',
  }
  return {
    id: `sauce-${name}`,
    name,
    description: descriptions[name] ?? name,
    badges: [],
    measure: 'г',
    amount: null,
    calories: null,
    priceRub: null,
    ingredients:
      name === 'Сметана'
        ? ['Сметана']
        : name === 'Чесночный'
          ? ['Чеснок', 'Сметана', 'Зелень']
          : name === 'Горчица'
            ? ['Горчица', 'Специи']
            : name === 'Аджика'
              ? ['Томат', 'Перец', 'Чеснок']
              : ['Хрен', 'Свёкла'],
    allergenNote:
      name === 'Горчица'
        ? 'Содержит горчицу.'
        : name === 'Сметана' || name === 'Чесночный'
          ? 'Содержит молочные продукты.'
          : undefined,
    variants: ['Одна порция'],
    extras: [],
  }
}

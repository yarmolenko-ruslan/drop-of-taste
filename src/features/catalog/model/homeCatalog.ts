import type { CatalogProduct, ProductBadge } from './product.ts'

type ProductInput = {
  id: string
  name: string
  details: string
  image?: string
  badges?: readonly ProductBadge[]
  measure?: 'г' | 'мл'
  action?: 'add' | 'choose'
}

function product({
  id,
  name,
  details,
  image,
  badges = [],
  measure = 'г',
  action = 'add',
}: ProductInput): CatalogProduct {
  return {
    id,
    name,
    details,
    image: image ?? `/products/${id}.jpg`,
    imageAlt: name,
    badges,
    measure,
    action,
    amount: null,
    calories: null,
    priceRub: null,
  }
}

export type HomeCategory = {
  id: string
  title: string
  subtitle: string
  products: readonly CatalogProduct[]
}

export const homeCategories: readonly HomeCategory[] = [
  {
    id: 'breakfast',
    title: 'Завтраки',
    subtitle: 'Каждое утро до 12:00! Как дома — только готовить не нужно.',
    products: [
      product({
        id: 'syrniki',
        name: 'Сырники со сметаной',
        details: 'Фермерский творог, ягодный соус',
        badges: ['hit'],
      }),
      product({
        id: 'oatmeal',
        name: 'Каша овсяная с ягодами',
        details: 'На молоке, с клюквой и мёдом',
        badges: ['lenten'],
      }),
      product({
        id: 'ham-omelet',
        name: 'Омлет с ветчиной и сыром',
        details: 'Три яйца, тост, зелень',
      }),
      product({
        id: 'cottage-cheese-blini',
        name: 'Блинчики с творогом',
        details: 'Тонкие блины, сметана',
        action: 'choose',
      }),
    ],
  },
  {
    id: 'salads',
    title: 'Салаты',
    subtitle: 'Большие порции и свежие овощи',
    products: [
      product({
        id: 'olivier',
        name: 'Оливье',
        details: 'С говядиной и домашним майонезом',
        badges: ['hit'],
      }),
      product({
        id: 'vinaigrette',
        name: 'Винегрет',
        details: 'Свёкла, квашеная капуста, огурчик',
        badges: ['lenten'],
      }),
      product({
        id: 'herring-fur-coat',
        name: 'Сельдь под шубой',
        details: 'Слоями, как в праздник',
      }),
      product({
        id: 'chicken-caesar',
        name: 'Цезарь с курицей',
        details: 'Романо, курица-гриль, пармезан',
        badges: ['discount'],
      }),
    ],
  },
  {
    id: 'soups',
    title: 'Супы',
    subtitle: 'Наваристые, согревают в любую погоду',
    products: [
      product({
        id: 'borscht',
        name: 'Борщ с пампушками',
        details: 'На говядине, со сметаной',
        badges: ['hit'],
        action: 'choose',
      }),
      product({
        id: 'solyanka',
        name: 'Солянка сборная',
        details: 'Копчёности, оливки, лимон',
        badges: ['spicy'],
      }),
      product({
        id: 'chicken-noodle-soup',
        name: 'Куриный суп с лапшой',
        details: 'Домашняя лапша, зелень',
      }),
      product({
        id: 'ukha',
        name: 'Уха по-домашнему',
        details: 'Три вида рыбы, укроп',
        badges: ['new'],
      }),
    ],
  },
  {
    id: 'hot',
    title: 'Горячие блюда',
    subtitle: 'Сытно и по-домашнему',
    products: [
      product({
        id: 'home-cutlets',
        name: 'Котлеты по-домашнему',
        details: 'С картофельным пюре',
        badges: ['hit'],
        action: 'choose',
      }),
      product({
        id: 'beef-stroganoff',
        name: 'Бефстроганов',
        details: 'Говядина в сливочно-грибном соусе',
      }),
      product({ id: 'cabbage-rolls', name: 'Голубцы', details: 'Мясо и рис в капустных листьях' }),
      product({
        id: 'pelmeni',
        name: 'Пельмени ручной лепки',
        details: 'Со сметаной или маслом',
        badges: ['hit'],
        action: 'choose',
      }),
    ],
  },
  {
    id: 'pan',
    title: 'На сковороде',
    subtitle: 'Подаём шкворчащими, на чугуне',
    products: [
      product({
        id: 'home-roast',
        name: 'Жаркое по-домашнему',
        details: 'Свинина, картофель, на чугунной сковороде',
        badges: ['spicy'],
      }),
      product({
        id: 'draniki',
        name: 'Драники со сметаной',
        details: 'Хрустящие, из тёртого картофеля',
        badges: ['lenten'],
      }),
      product({
        id: 'potatoes-mushrooms',
        name: 'Картофель с грибами',
        details: 'Жареный, с луком',
        badges: ['lenten'],
      }),
      product({
        id: 'liver-onions',
        name: 'Печень с луком',
        details: 'Куриная печень в сметане',
        badges: ['discount'],
      }),
    ],
  },
  {
    id: 'bakery',
    title: 'Выпечка',
    subtitle: 'Не забудьте добавить к заказу — прямо из печи',
    products: [
      product({
        id: 'cabbage-pie',
        name: 'Пирожок с капустой',
        details: 'Печёный, дрожжевое тесто',
        badges: ['lenten'],
      }),
      product({
        id: 'vatrushka',
        name: 'Ватрушка с творогом',
        details: 'Сдобная, ванильный творог',
      }),
      product({
        id: 'kurnik',
        name: 'Курник',
        details: 'Курица, грибы, картофель',
        badges: ['new'],
        action: 'choose',
      }),
      product({ id: 'pampushki', name: 'Пампушки с чесноком', details: 'К борщу — обязательно' }),
    ],
  },
  {
    id: 'desserts',
    title: 'Десерты',
    subtitle: 'Домашние торты и пироги к чаю',
    products: [
      product({
        id: 'medovik',
        name: 'Медовик',
        details: 'Медовые коржи, сметанный крем',
        badges: ['hit'],
      }),
      product({ id: 'napoleon', name: 'Наполеон', details: 'Слоёные коржи, заварной крем' }),
      product({
        id: 'smetannik',
        name: 'Сметанник',
        details: 'Нежный, как у бабушки',
        badges: ['new'],
      }),
      product({
        id: 'sharlotka',
        name: 'Шарлотка с яблоками',
        details: 'Тёплая, с пломбиром',
        badges: ['discount'],
      }),
    ],
  },
  {
    id: 'drinks',
    title: 'Напитки',
    subtitle: 'Морсы, кофе и травяные чаи',
    products: [
      product({
        id: 'cranberry-mors',
        name: 'Морс клюквенный',
        details: 'Северная клюква',
        badges: ['new', 'lenten'],
        measure: 'мл',
        action: 'choose',
      }),
      product({
        id: 'cappuccino',
        name: 'Капучино',
        details: 'Зерно свежей обжарки',
        measure: 'мл',
        action: 'choose',
      }),
      product({
        id: 'latte',
        name: 'Латте',
        details: 'Сироп на выбор',
        measure: 'мл',
        action: 'choose',
      }),
      product({
        id: 'herbal-tea',
        name: 'Чай травяной',
        details: 'Чабрец, мята, смородина',
        badges: ['lenten'],
        measure: 'мл',
        action: 'choose',
      }),
    ],
  },
]

export type HomeCombo = {
  id: string
  name: string
  portions: string
  details: string
  image: string
}

export const homeCombos: readonly HomeCombo[] = [
  {
    id: 'lunch',
    name: 'Обед как дома',
    portions: 'на 1 персону',
    details: 'Борщ с пампушками, котлеты с пюре, морс клюквенный',
    image: '/products/combo-lunch.jpg',
  },
  {
    id: 'breakfast-for-two',
    name: 'Завтрак на двоих',
    portions: 'на 2 персоны',
    details: 'Сырники, омлет с ветчиной, 2 капучино',
    image: '/products/combo-breakfast.jpg',
  },
  {
    id: 'family-dinner',
    name: 'Семейный ужин',
    portions: 'на 4 персоны',
    details: 'Пельмени, жаркое на сковороде, оливье, курник, морс 1 л',
    image: '/products/combo-dinner.jpg',
  },
  {
    id: 'tea-time',
    name: 'К чаю',
    portions: 'на 3–4 персоны',
    details: 'Медовик целиком, 6 пирожков, ватрушки, чай травяной',
    image: '/products/combo-tea.jpg',
  },
]

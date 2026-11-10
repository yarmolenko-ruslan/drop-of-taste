import { defaultLegalContent, type LegalContent } from './legal-content.ts'
import { CONSENT_VERSION } from './validation/auth.ts'

export type SiteContent = {
  brandName: string
  siteTitle: string
  browserTitle: string
  brandLogo: string
  tagline: string
  phone: string
  email: string
  address: string
  hours: string
  mapEmbedUrl: string
  mapRouteUrl: string
  footerDescription: string
  legalDetails: string
  legalRevision: string
  legal: LegalContent
  vkUrl: string
  telegramUrl: string
  aboutLead: string
  aboutPageTitle: string
  aboutEyebrow: string
  aboutImageAlt: string
  visitTitle: string
  highlightsTitle: string
  mapTitle: string
  aboutParagraphs: [string, string]
  aboutImage: string
  homeAboutText: string
  bonusTitle: string
  bonusText: string
  bonusSteps: [string, string, string]
  comboTitle: string
  comboSubtitle: string
  comboBadge: string
  comboNote: string
  saucesSubtitle: string
  aboutHighlights: [string, string, string]
  benefits: { icon: 'clock' | 'truck' | 'card' | 'pin'; title: string; detail: string }[]
  promotions: {
    id: string
    category: 'delivery' | 'pickup' | 'cafe'
    badge: string
    title: string
    subtitle: string
    description: string
    conditions: string
    action: string
    href?: string
    startsAt?: string
    endsAt?: string
    discountPercent?: number
    theme: 'red' | 'cream' | 'burgundy' | 'gold' | 'green' | 'white'
  }[]
  heroSlides: {
    id: string
    badge: string
    title: string
    description: string
    image: string
    imageAlt: string
    href?: string
  }[]
}

export const defaultSiteContent: SiteContent = {
  brandName: 'КАПЕЛА ВКУСА',
  siteTitle: 'Капела вкуса',
  browserTitle: 'Капела вкуса - кафе домашней кухни и доставкой по городу',
  brandLogo: '/brand-emblem.png',
  tagline: 'ДОМАШНЯЯ КУХНЯ',
  phone: '',
  email: '',
  address: 'г. Красноярск, улица Петра Подзолкова, 3и',
  hours: 'Ежедневно 08:00–20:00',
  mapEmbedUrl:
    'https://yandex.ru/map-widget/v1/?ll=92.884165%2C56.049189&mode=search&oid=172905214895&ol=biz&z=16.73',
  mapRouteUrl: 'https://yandex.ru/maps/?rtext=~56.049189,92.884165',
  footerDescription: 'Домашняя кухня, выпечка и кофе с доставкой.',
  legalDetails: '[ИП / ООО «Название»], ИНН [–], ОГРН [–]',
  legalRevision: CONSENT_VERSION,
  legal: defaultLegalContent,
  vkUrl: 'https://vk.com/',
  telegramUrl: 'https://t.me/',
  aboutLead: 'Больше, чем еда — это наш край',
  aboutPageTitle: 'О кафе',
  aboutEyebrow: 'ДОМАШНЯЯ КУХНЯ · КАФЕ',
  aboutImageAlt: 'Интерьер кафе «Капела вкуса»',
  visitTitle: 'Приходите в гости',
  highlightsTitle: 'Что вас ждёт',
  mapTitle: 'Как нас найти',
  aboutParagraphs: [
    '«Капела вкуса» — кафе домашней кухни в Красноярске. Здесь можно позавтракать, пообедать знакомыми блюдами, выбрать свежую выпечку или заказать любимые вкусы с доставкой.',
    'Готовим завтраки, супы, горячие блюда, десерты и выпечку. Утро начинаем с домашнего завтрака, а в течение дня предлагаем сытные блюда и кофе.',
  ],
  aboutImage: '/banners/cafe-interior.jpg',
  homeAboutText:
    'Домашняя кухня, свежая выпечка и любимые блюда на каждый день. Заходите на завтрак, обед или за чашкой кофе.',
  bonusTitle: 'Всё для удобного заказа',
  bonusText:
    'Сохраняйте адреса доставки, следите за заказами и повторяйте любимые блюда в несколько нажатий.',
  bonusSteps: ['Войдите по номеру телефона', 'Сохраните адрес доставки', 'Следите за заказами'],
  comboTitle: 'Комбо и наборы',
  comboSubtitle: 'Собрали готовые обеды и наборы на компанию — выгоднее, чем по отдельности.',
  comboBadge: 'ГОТОВЫЙ НАБОР',
  comboNote: 'На комбо не распространяются другие акции и промокоды',
  saucesSubtitle: 'Добавьте вкуса любимому блюду',
  aboutHighlights: [
    'Домашние блюда и свежая выпечка',
    'Завтраки каждое утро до 12:00',
    'Доставка и самовывоз',
  ],
  benefits: [
    { icon: 'clock', title: 'От 60 минут', detail: 'Привезём горячим' },
    { icon: 'truck', title: 'Бесплатно от 1 500 ₽', detail: 'Условия в корзине' },
    { icon: 'card', title: 'Оформление заказа', detail: 'За пару минут' },
    { icon: 'pin', title: 'Самовывоз −10%', detail: 'Одно кафе в городе' },
  ],
  promotions: [
    {
      id: 'birthday',
      category: 'delivery',
      badge: 'ДЕНЬ РОЖДЕНИЯ',
      title: '−10%',
      subtitle: 'Скидка 10% в день рождения',
      description: 'Поздравляем вкусно: скидка на весь заказ в ваш праздник.',
      conditions:
        'Действует по паспорту при получении. В день рождения и три дня после. Скидки и бонусы не суммируются.',
      action: 'В меню',
      href: '/menu/combo',
      theme: 'red',
    },
    {
      id: 'pickup',
      category: 'pickup',
      badge: 'САМОВЫВОЗ',
      title: '−10%',
      subtitle: 'Скидка на самовывоз',
      description: 'Заберите заказ в нашем кафе — скидка применится при оформлении.',
      conditions:
        'Скидка действует при выборе самовывоза. Не суммируется с другими специальными предложениями.',
      action: 'Выбрать блюда',
      href: '/menu/combo',
      discountPercent: 10,
      theme: 'cream',
    },
    {
      id: 'lunch',
      category: 'cafe',
      badge: 'КОМБО',
      title: 'Обед как дома',
      subtitle: 'Комбо-обед по выгодной цене',
      description: 'Суп, горячее и морс по будням с 12:00 до 16:00.',
      conditions:
        'Предложение действует в кафе по будням с 12:00 до 16:00. Состав зависит от наличия блюд.',
      action: 'Выбрать',
      href: '/menu/combo',
      theme: 'burgundy',
    },
    {
      id: 'bonus',
      category: 'delivery',
      badge: 'ЛИЧНЫЙ КАБИНЕТ',
      title: 'Ваши заказы под рукой',
      subtitle: 'Оформляйте быстрее',
      description: 'Сохраняйте адреса и повторяйте любимые заказы в личном кабинете.',
      conditions: 'Войдите по номеру телефона, чтобы видеть историю заказов и сохранённые адреса.',
      action: 'Войти',
      theme: 'white',
    },
    {
      id: 'first-order',
      category: 'delivery',
      badge: 'ПЕРВЫЙ ЗАКАЗ',
      title: 'Пирожки в подарок',
      subtitle: 'Подарок к первому заказу',
      description: 'Положим пирожки к первому заказу на сайте от 1000 ₽.',
      conditions:
        'Предложение действует один раз для нового пользователя при заказе от 1000 ₽. Подарок не заменяется денежной компенсацией.',
      action: 'В меню',
      href: '/menu/bakery',
      theme: 'gold',
    },
    {
      id: 'breakfast',
      category: 'cafe',
      badge: 'В КАФЕ',
      title: 'Завтраки до 12:00',
      subtitle: 'Утро в «Капеле вкуса»',
      description: 'Каши, сырники или омлет с кофе — по специальной цене в кафе.',
      conditions:
        'Завтраки доступны ежедневно до 12:00 в кафе. Актуальный состав уточняйте у сотрудников.',
      action: 'Адрес кафе',
      href: '/about',
      theme: 'green',
    },
  ],
  heroSlides: [
    {
      id: 'birthday',
      badge: 'АКЦИЯ',
      title: 'Скидка 10% в день рождения',
      description: 'По паспорту · скидки не суммируются',
      image: '/banners/cafe-exterior.jpg',
      imageAlt: 'Фасад кафе «Капела вкуса» вечером',
      href: '/promotions/birthday',
    },
    {
      id: 'cafe',
      badge: 'О НАС',
      title: 'Больше, чем еда — это наш край',
      description: 'Домашняя кухня, тёплая атмосфера и любимые вкусы',
      image: '/banners/cafe-interior.jpg',
      imageAlt: 'Уютный зал кафе с тёплым освещением',
      href: '/about',
    },
    {
      id: 'breakfast',
      badge: 'ЗАВТРАКИ',
      title: 'Доброе утро начинается с завтрака',
      description: 'Сырники, горячий кофе и немного времени для себя',
      image: '/banners/breakfast.jpg',
      imageAlt: 'Сырники с ягодами и чашка кофе',
      href: '/promotions/breakfast',
    },
  ],
}

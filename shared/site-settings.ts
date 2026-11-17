export const siteLabelNames = {
  promotions: 'Ссылка «Акции»',
  newArrivals: 'Заголовок «Новинки»',
  about: 'Ссылка «О нас»',
  account: 'Ссылка «Личный кабинет»',
  delivery: 'Ссылка «Доставка и оплата»',
  menu: 'Заголовок меню',
  customers: 'Заголовок «Покупателям»',
  contacts: 'Заголовок контактов',
  information: 'Заголовок информации',
  map: 'Кнопка карты',
  login: 'Кнопка входа в шапке',
  search: 'Подсказка поиска',
  allCategory: 'Ссылка «Весь раздел»',
  accountEyebrow: 'Подпись над блоком кабинета',
  accountButton: 'Кнопка входа на главной',
  accountHelp: 'Ссылка на шаги входа',
  aboutEyebrow: 'Подпись над блоком о кафе',
  aboutButton: 'Кнопка о кафе',
} as const
export const homeSectionNames = {
  hero: 'Баннеры',
  newArrivals: 'Новинки',
  combo: 'Комбо и наборы',
  sauces: 'Соусы',
  benefits: 'Условия доставки и оплаты',
  account: 'Блок личного кабинета',
  about: 'Блок о кафе',
} as const
export const appearanceNames = {
  brand: 'Основной цвет',
  background: 'Фон страницы',
  text: 'Основной текст',
  gold: 'Акцентный цвет',
  burgundy: 'Тёмный фирменный цвет',
  goldLight: 'Светлый акцент',
} as const
export type SiteSettings = {
  delivery: { minimumSubtotalKopecks: number; freeFromKopecks: number | null; feeKopecks: number }
  labels: Record<keyof typeof siteLabelNames, string>
  sections: Record<keyof typeof homeSectionNames, boolean>
  appearance: Record<keyof typeof appearanceNames, string>
  seoDescription: string
  favicon: string
}
export const defaultSiteSettings: SiteSettings = {
  delivery: { minimumSubtotalKopecks: 50_000, freeFromKopecks: 150_000, feeKopecks: 25_000 },
  labels: {
    promotions: 'Акции',
    newArrivals: 'Новинки',
    about: 'О нас',
    account: 'Личный кабинет',
    delivery: 'Доставка и оплата',
    menu: 'МЕНЮ',
    customers: 'ПОКУПАТЕЛЯМ',
    contacts: 'КОНТАКТЫ',
    information: 'ИНФОРМАЦИЯ',
    map: 'Кафе на карте',
    login: 'Войти',
    search: 'Искать блюда',
    allCategory: 'Весь раздел',
    accountEyebrow: 'ЛИЧНЫЙ КАБИНЕТ',
    accountButton: 'Войти по номеру',
    accountHelp: 'Как это работает',
    aboutEyebrow: 'О НАС',
    aboutButton: 'О кафе',
  },
  sections: {
    hero: true,
    newArrivals: true,
    combo: true,
    sauces: true,
    benefits: true,
    account: true,
    about: true,
  },
  appearance: {
    brand: '#a70d22',
    background: '#fcf6ee',
    text: '#46171a',
    gold: '#dfb86f',
    burgundy: '#3f080e',
    goldLight: '#e9c78c',
  },
  seoDescription: 'Домашняя кухня, свежая выпечка, доставка и самовывоз в Красноярске.',
  favicon: '',
}

/** Дополняет настройки старой базы, не меняя явно сохранённые значения. */
export function mergeSiteSettings(saved?: Partial<SiteSettings>): SiteSettings {
  return {
    ...defaultSiteSettings,
    ...saved,
    delivery: { ...defaultSiteSettings.delivery, ...saved?.delivery },
    labels: { ...defaultSiteSettings.labels, ...saved?.labels },
    sections: { ...defaultSiteSettings.sections, ...saved?.sections },
    appearance: { ...defaultSiteSettings.appearance, ...saved?.appearance },
  }
}

import type { Permission } from './admin-access.ts'

export const activitySectionPermissions = {
  orders: 'orders.read',
  clients: 'clients.read',
  content: 'site.read',
  promotions: 'promotions.read',
  codes: 'codes.read',
  categories: 'catalog.read',
  products: 'catalog.read',
  legal: 'legal.read',
  logs: null,
  iiko: null,
  employees: null,
} satisfies Record<string, Permission | null>
export type ActivitySection = keyof typeof activitySectionPermissions
export const activitySectionLabels: Record<ActivitySection, string> = {
  orders: 'Заказы',
  clients: 'Клиенты',
  content: 'Сайт и баннеры',
  promotions: 'Акции',
  codes: 'Бонус-коды',
  categories: 'Разделы меню',
  products: 'Товары',
  legal: 'Документы',
  logs: 'Журнал',
  iiko: 'iiko',
  employees: 'Сотрудники',
}
export type ActivityNote = {
  type: 'employee.credentials.view' | 'employee.credentials.copy'
  employeeId: string
  revision: string
}
export type ActivityKind = 'access' | 'view' | 'change' | 'navigation'
export type ActivityOutcome = 'pending' | 'success' | 'denied' | 'error'
export type AdminActivity = {
  _id: string
  at: string
  completedAt?: string
  actor: { id: string; name: string; role: 'owner' | 'employee' } | null
  action: string
  kind: ActivityKind
  outcome: ActivityOutcome
  method: string
  route: string
  statusCode?: number
  errorCode?: string
  resourceId?: string
  section?: ActivitySection
}
export type ActivityPage = { activities: AdminActivity[]; nextBefore: string | null }
export const activityLabels: Record<string, string> = {
  'auth.login': 'Вход в кабинет',
  'auth.logout': 'Выход из кабинета',
  'panel.open': 'Открытие панели',
  'section.open': 'Открытие раздела',
  'orders.view': 'Просмотр заказов',
  'clients.search': 'Просмотр или поиск клиентов',
  'client.view': 'Открытие карточки клиента',
  'employees.view': 'Просмотр сотрудников',
  'employee.open': 'Открытие карточки сотрудника',
  'employee.create': 'Создание сотрудника',
  'employee.update': 'Изменение сотрудника и прав',
  'employee.password_reset': 'Выдача временного пароля',
  'employee.password_changed': 'Смена собственного пароля',
  'employee.credentials.view': 'Просмотр реквизитов сотрудника',
  'employee.credentials.copy': 'Запрос копирования реквизитов сотрудника',
  'order.stage': 'Изменение этапа заказа',
  'order.accept': 'Заказ принят в работу',
  'order.deliver': 'Заказ передан в доставку',
  'order.complete': 'Заказ завершён',
  'content.save': 'Сохранение контента',
  'category.create': 'Создание раздела меню',
  'category.update': 'Изменение раздела меню',
  'category.delete': 'Удаление раздела меню',
  'product.create': 'Создание товара',
  'product.update': 'Изменение товара',
  'product.delete': 'Удаление товара',
  'bonus_codes.view': 'Просмотр бонус-кодов',
  'bonus_code.create': 'Создание бонус-кода',
  'bonus_code.update': 'Изменение бонус-кода',
  'bonus_code.delete': 'Удаление бонус-кода',
  'logs.view': 'Просмотр журнала',
  'image.upload': 'Загрузка изображения',
  'iiko.sync': 'Синхронизация меню iiko',
  'admin.request': 'Административный запрос',
}

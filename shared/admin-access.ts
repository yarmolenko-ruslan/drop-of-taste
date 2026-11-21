/** Shared, explicit allowlist. New capabilities are denied until added here and on the server. */
export const permissionGroups = [
  {
    id: 'orders',
    label: 'Заказы',
    description:
      'Просмотр заказов с контактами и адресом доставки; изменение этапа приготовления и доставки.',
    write: true,
  },
  {
    id: 'clients',
    label: 'Клиенты',
    description:
      'Контакты, сохранённые адреса и история заказов. Персональные данные — выдавайте только при необходимости.',
    write: false,
  },
  {
    id: 'catalog',
    label: 'Каталог',
    description:
      'Товары, цены, доступность и разделы меню. Редактирование включает создание и удаление.',
    write: true,
  },
  {
    id: 'site',
    label: 'Сайт и настройки',
    description:
      'Тексты, баннеры, контакты и условия работы: доставка, оплата, скидки и оформление сайта.',
    write: true,
  },
  {
    id: 'promotions',
    label: 'Акции',
    description: 'Условия и сроки акций, скидки. Изменения влияют на стоимость новых заказов.',
    write: true,
  },
  {
    id: 'codes',
    label: 'Бонус-коды',
    description: 'Просмотр, создание, изменение и удаление кодов скидок.',
    write: true,
  },
  {
    id: 'legal',
    label: 'Документы',
    description: 'Политика конфиденциальности, согласие и редакция юридических документов.',
    write: true,
  },
] as const
export type PermissionGroup = (typeof permissionGroups)[number]['id']
export type Permission = `${PermissionGroup}.read` | `${Exclude<PermissionGroup, 'clients'>}.manage`
export const permissions: Permission[] = permissionGroups.flatMap((group) => [
  `${group.id}.read` as Permission,
  ...(group.write ? [`${group.id}.manage` as Permission] : []),
])
export type AdminPrincipal = {
  id: string
  name: string
  role: 'owner' | 'employee'
  permissions: Permission[]
  mustChangePassword: boolean
}
export type AdminSession = { authenticated: true; principal: AdminPrincipal; sessionId?: string }
export function can(principal: AdminPrincipal | null, permission: Permission): boolean {
  return Boolean(
    principal && (principal.role === 'owner' || principal.permissions.includes(permission)),
  )
}
export const employeePresets: { name: string; permissions: Permission[] }[] = [
  { name: 'Без доступа', permissions: [] },
  { name: 'Оператор', permissions: ['orders.read', 'orders.manage'] },
  {
    name: 'Менеджер',
    permissions: ['orders.read', 'orders.manage', 'clients.read', 'catalog.read', 'catalog.manage'],
  },
  { name: 'Редактор', permissions: ['catalog.read', 'catalog.manage', 'site.read', 'site.manage'] },
  {
    name: 'Маркетолог',
    permissions: ['promotions.read', 'promotions.manage', 'codes.read', 'codes.manage'],
  },
  { name: 'Наблюдатель', permissions: ['orders.read', 'catalog.read'] },
]
export type Employee = {
  id: string
  login: string
  name: string
  active: boolean
  permissions: Permission[]
  mustChangePassword: boolean
  revision: string
  createdAt: string
  updatedAt: string
}

export function contentPermissionGroup(key: string): 'site' | 'promotions' | 'legal' {
  return key === 'promotions'
    ? 'promotions'
    : ['legal', 'legalRevision'].includes(key)
      ? 'legal'
      : 'site'
}

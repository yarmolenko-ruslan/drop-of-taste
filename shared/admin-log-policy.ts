export const ADMIN_LOG_RETENTION_DAYS = 90
export const ADMIN_LOG_RETENTION_SECONDS = ADMIN_LOG_RETENTION_DAYS * 24 * 60 * 60

export const quietAdminActions = [
  'panel.open',
  'section.open',
  'orders.view',
  'clients.search',
  'client.view',
  'employees.view',
  'employee.open',
  'bonus_codes.view',
  'logs.view',
] as const

export const adminLogCutoff = (now = Date.now()) =>
  new Date(now - ADMIN_LOG_RETENTION_SECONDS * 1000)

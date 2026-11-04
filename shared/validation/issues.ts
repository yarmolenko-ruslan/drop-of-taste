import type { ZodIssue } from 'zod'

/** Первое сообщение об ошибке для каждого поля по пути issue: `{ street: '…' }`. */
export function issuesByField(issues: readonly ZodIssue[]): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const issue of issues) {
    const key = issue.path[0]
    if (typeof key === 'string' && !(key in errors)) errors[key] = issue.message
  }
  return errors
}

/** This stores public identity markers, never the HttpOnly authentication token. */
export const pendingLogoutKey = 'drop-of-taste:admin-logout-pending'
export type AdminLogoutIntent = { id: string; accountId: string | null; sessionId: string | null }
export function parseAdminLogout(value: string | null): AdminLogoutIntent | null {
  if (value === null) return null
  try {
    const parsed = JSON.parse(value) as Partial<AdminLogoutIntent> | null
    if (
      parsed &&
      typeof parsed.id === 'string' &&
      parsed.id.length > 0 &&
      parsed.id.length <= 100 &&
      (parsed.accountId === null ||
        (typeof parsed.accountId === 'string' && parsed.accountId.length <= 100)) &&
      (parsed.sessionId === null ||
        (typeof parsed.sessionId === 'string' && parsed.sessionId.length <= 100))
    )
      return { id: parsed.id, accountId: parsed.accountId!, sessionId: parsed.sessionId! }
  } catch {
    /* The previous app version stored the literal '1'. */
  }
  return { id: 'legacy', accountId: null, sessionId: null }
}
export function readAdminLogout(): AdminLogoutIntent | null {
  try {
    return parseAdminLogout(localStorage.getItem(pendingLogoutKey))
  } catch {
    return null
  }
}
export function persistAdminLogout(intent: AdminLogoutIntent) {
  try {
    localStorage.setItem(
      pendingLogoutKey,
      JSON.stringify({ id: intent.id, accountId: intent.accountId, sessionId: intent.sessionId }),
    )
  } catch {
    /* In-memory revocation still works. */
  }
}
/** A late completion must never erase a newer logout requested by another tab. */
export function completeAdminLogout(intent: AdminLogoutIntent): AdminLogoutIntent | null {
  const current = readAdminLogout()
  if (current && current.id !== intent.id) return current
  try {
    localStorage.removeItem(pendingLogoutKey)
  } catch {
    /* Local state can finish after server revocation. */
  }
  return null
}

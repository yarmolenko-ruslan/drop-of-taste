type CursorFilter = Array<Record<string, unknown>>

/** Устойчивые страницы по убыванию (createdAt, _id), включая одинаковые даты. */
export function parseOrdersCursor(cursor: unknown): CursorFilter | 'invalid' | undefined {
  if (cursor === undefined) return undefined
  if (typeof cursor !== 'string' || !cursor || cursor.length > 256) return 'invalid'
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as {
      d?: unknown
      i?: unknown
    }
    if (
      typeof decoded.d !== 'string' ||
      typeof decoded.i !== 'string' ||
      !decoded.i ||
      decoded.i.length > 100
    )
      return 'invalid'
    const date = new Date(decoded.d)
    if (Number.isNaN(date.getTime())) return 'invalid'
    return [{ createdAt: { $lt: date } }, { createdAt: date, _id: { $lt: decoded.i } }]
  } catch {
    return 'invalid'
  }
}

export function encodeOrdersCursor(order: { _id: string; createdAt: Date }): string {
  return Buffer.from(JSON.stringify({ d: order.createdAt.toISOString(), i: order._id })).toString(
    'base64url',
  )
}

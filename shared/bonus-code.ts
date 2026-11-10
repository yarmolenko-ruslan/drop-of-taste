export type BonusCode = {
  _id: string
  kind: 'percent' | 'rubles'
  value: number
  startsAt: string
  endsAt: string
  active: boolean
}

export function normalizeBonusCode(code: string) {
  return code.trim().toUpperCase()
}

export function bonusCodeDiscount(code: BonusCode, subtotalKopecks: number, now = new Date()) {
  const time = now.getTime()
  const startsAt = Date.parse(code.startsAt)
  const endsAt = Date.parse(code.endsAt)
  if (
    !code.active ||
    !Number.isFinite(startsAt) ||
    !Number.isFinite(endsAt) ||
    startsAt >= endsAt ||
    !Number.isFinite(code.value) ||
    code.value <= 0 ||
    (code.kind !== 'percent' && code.kind !== 'rubles') ||
    (code.kind === 'percent' && code.value > 100) ||
    time < startsAt ||
    time >= endsAt
  )
    return null
  return Math.min(
    subtotalKopecks,
    code.kind === 'percent'
      ? Math.round((subtotalKopecks * code.value) / 100)
      : Math.round(code.value * 100),
  )
}

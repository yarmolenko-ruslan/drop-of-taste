/** Праздничный год привязан к дню рождения, в том числе для окна на границе лет. */
export const BIRTHDAY_CLAIM_RELEASED_EVENT = 'drop-of-taste:birthday-claim-released'

export function birthdayCelebrationYear(birthday: string, now = new Date()): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return null
  const local = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Krasnoyarsk',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const value = (part: string) => Number(local.find((item) => item.type === part)?.value)
  const today = Date.UTC(value('year'), value('month') - 1, value('day'))
  const [, , month, day] = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthday) ?? []
  for (const year of [value('year') - 1, value('year'), value('year') + 1]) {
    // 29 февраля в обычный год отмечается 28 февраля.
    const leapDay =
      month === '02' && day === '29' && new Date(Date.UTC(year, 1, 29)).getUTCMonth() !== 1
    const anniversary = Date.UTC(year, Number(month) - 1, leapDay ? 28 : Number(day))
    if (Math.abs(today - anniversary) <= 3 * 86_400_000) return year
  }
  return null
}

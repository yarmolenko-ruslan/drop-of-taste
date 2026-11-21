export const LOG_TIME_ZONE = 'Asia/Krasnoyarsk'
export const formatLogTime = (at: string) =>
  new Date(at).toLocaleString('ru-RU', { timeZone: LOG_TIME_ZONE })
type TimedLog = { _id: string; at: string }
const dayMs = 24 * 60 * 60 * 1000
const dateKey = new Intl.DateTimeFormat('en-CA', {
  timeZone: LOG_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
export const logDay = (date: Date) => {
  const parts = dateKey.formatToParts(date)
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)!.value)
  return new Date(Date.UTC(value('year'), value('month') - 1, value('day')))
}
const dateLabel = (date: Date) =>
  date.toLocaleDateString('ru-RU', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
const monday = (date: Date) => new Date(date.getTime() - ((date.getUTCDay() + 6) % 7) * dayMs)

export function groupLogs<T extends TimedLog>(entries: readonly T[], now = new Date()) {
  const today = logDay(now)
  const yesterday = new Date(today.getTime() - dayMs)
  const thisWeek = monday(today)
  const previousWeek = new Date(thisWeek.getTime() - 7 * dayMs)
  const thisMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))
  const groups = new Map<
    string,
    { key: string; title: string; open: boolean; entries: T[]; at: number }
  >()
  for (const entry of [...entries].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))) {
    const day = logDay(new Date(entry.at))
    let key: string
    let title: string
    if (day >= thisWeek || +day === +yesterday) {
      key = `day-${day.toISOString()}`
      title = `${+day === +today ? 'Сегодня · ' : +day === +yesterday ? 'Вчера · ' : ''}${dateLabel(day)}`
    } else if (day >= thisMonth || day >= previousWeek) {
      const start = monday(day)
      const end = new Date(start.getTime() + 6 * dayMs)
      key = `week-${start.toISOString()}`
      title = `Неделя ${dateLabel(start)} — ${dateLabel(end)}`
    } else {
      const month = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1))
      key = `month-${month.toISOString()}`
      title = month.toLocaleDateString('ru-RU', { timeZone: 'UTC', month: 'long', year: 'numeric' })
      title = title[0]!.toUpperCase() + title.slice(1)
    }
    let group = groups.get(key)
    if (!group) {
      group = { key, title, open: +day === +today, entries: [], at: +day }
      groups.set(key, group)
    }
    group.entries.push(entry)
  }
  return [...groups.values()].sort((a, b) => b.at - a.at)
}

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { groupLogs, logDay } from './groupLogEntries'
import styles from './AdminScreen.module.css'
const plurals = new Intl.PluralRules('ru-RU')
const recordCount = (count: number) =>
  `${count} ${{ one: 'запись', few: 'записи', many: 'записей', other: 'записи' }[plurals.select(count) as 'one' | 'few' | 'many' | 'other']}`

export function LogGroups<T extends { _id: string; at: string }>({
  entries,
  renderEntry,
}: {
  entries: readonly T[]
  renderEntry: (entry: T) => ReactNode
}) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => {
      const next = new Date()
      setNow((previous) => (+logDay(previous) === +logDay(next) ? previous : next))
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [])
  const groups = useMemo(() => groupLogs(entries, now), [entries, now])
  return (
    <>
      {groups.map((group) => (
        <details key={group.key} className={styles.logGroup} open={group.open}>
          <summary className={styles.logGroupSummary}>
            {group.title} <span>{recordCount(group.entries.length)}</span>
          </summary>
          <div className={styles.logGroupEntries}>{group.entries.map(renderEntry)}</div>
        </details>
      ))}
    </>
  )
}

import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { groupLogs } from './groupLogEntries'
import { LogGroups } from './LogGroups'

const now = new Date('2026-11-19T05:00:00Z')
const entries = [
  { _id: 'today', at: '2026-11-19T03:00:00Z' },
  { _id: 'yesterday', at: '2026-11-18T03:00:00Z' },
  { _id: 'this-week', at: '2026-11-17T03:00:00Z' },
  { _id: 'last-week', at: '2026-11-11T03:00:00Z' },
  { _id: 'older-week', at: '2026-11-03T03:00:00Z' },
  { _id: 'last-month', at: '2026-10-29T03:00:00Z' },
]

afterEach(() => vi.useRealTimers())

test('groups cafe-local days, earlier weeks and previous months, newest first', () => {
  const groups = groupLogs([...entries].reverse(), now)
  expect(groups.map((group) => group.entries.map((entry) => entry._id))).toEqual(
    entries.map((entry) => [entry._id]),
  )
  expect(groups[0]).toMatchObject({ open: true, title: expect.stringContaining('Сегодня') })
  expect(groups[1]).toMatchObject({ open: false, title: expect.stringContaining('Вчера') })
  expect(groups[2]!.title).toContain('17 ноября')
  expect(groups[3]!.title).toContain('Неделя 9 ноября')
  expect(groups[4]!.title).toContain('Неделя 2 ноября')
  expect(groups[5]!.title).toContain('Октябрь 2026')
  expect(groups.slice(1).every((group) => !group.open)).toBe(true)
})

test('uses Krasnoyarsk midnight rather than UTC midnight', () => {
  const groups = groupLogs([{ _id: 'boundary', at: '2026-11-18T17:30:00Z' }], now)
  expect(groups[0]!.title).toContain('Сегодня')
  const sunday = groupLogs(
    [{ _id: 'sunday', at: '2026-11-22T03:00:00Z' }],
    new Date('2026-11-23T03:00:00Z'),
  )
  expect(sunday[0]!.title).toContain('Вчера')
})

test('collapsed history can be expanded and stays expanded after loading another entry', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)
  const user = userEvent.setup()
  const renderEntry = (entry: (typeof entries)[number]) => (
    <article key={entry._id}>{entry._id}</article>
  )
  const view = render(<LogGroups entries={entries} renderEntry={renderEntry} />)
  expect(screen.getByText(/Сегодня/).closest('details')).toHaveAttribute('open')
  const yesterday = screen.getByText(/Вчера/).closest('details')!
  expect(yesterday).not.toHaveAttribute('open')
  await user.click(screen.getByText(/Вчера/))
  expect(yesterday).toHaveAttribute('open')
  view.rerender(
    <LogGroups
      entries={[...entries, { _id: 'another', at: '2026-11-18T02:00:00Z' }]}
      renderEntry={renderEntry}
    />,
  )
  expect(screen.getByText(/Вчера/).closest('details')).toBe(yesterday)
  expect(yesterday).toHaveAttribute('open')
  expect(yesterday).toHaveTextContent('2 записи')
})

test('yesterday is folded automatically when the cafe-local day changes', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-19T16:59:50Z'))
  render(
    <LogGroups
      entries={[entries[0]!]}
      renderEntry={(entry) => <article key={entry._id}>{entry._id}</article>}
    />,
  )
  expect(screen.getByText(/Сегодня/).closest('details')).toHaveAttribute('open')
  act(() => vi.advanceTimersByTime(60_000))
  expect(screen.getByText(/Вчера/).closest('details')).not.toHaveAttribute('open')
})

test.each([
  ['2026-01-01T03:00:00Z', '2025-12-31T03:00:00Z', 'Вчера'],
  ['2024-03-01T03:00:00Z', '2024-02-29T03:00:00Z', 'Вчера'],
  ['2026-01-07T03:00:00Z', '2025-12-30T03:00:00Z', 'Неделя 29 декабря 2025'],
])('calendar transitions: %s', (current, at, expected) => {
  const groups = groupLogs([{ _id: 'edge-date', at }], new Date(current))
  expect(groups).toHaveLength(1)
  expect(groups[0]!.title).toContain(expected)
  expect(groups[0]!.open).toBe(false)
})

test('calendar grouping does not depend on the locale date string format', () => {
  const original = Object.getOwnPropertyDescriptor(Intl.DateTimeFormat.prototype, 'format')!
  Object.defineProperty(Intl.DateTimeFormat.prototype, 'format', {
    ...original,
    get: () => () => '11/19/2026',
  })
  try {
    const groups = groupLogs([entries[0]!], now)
    expect(groups[0]!.title).toContain('Сегодня')
  } finally {
    Object.defineProperty(Intl.DateTimeFormat.prototype, 'format', original)
  }
})

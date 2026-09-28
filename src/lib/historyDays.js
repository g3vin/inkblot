/** historyDays.js — history rows by the day they were kept: Today, Yesterday, then dates. */

export function dayLabel(iso, now = new Date()) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'Earlier'
  const start = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((start(now) - start(date)) / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

/** The rows by the day they were kept, in order. */
export function byDay(rows, now) {
  const out = []
  for (const row of rows) {
    const label = dayLabel(row.timestamp, now)
    if (out.at(-1)?.label === label) out.at(-1).rows.push(row)
    else out.push({ label, rows: [row] })
  }
  return out
}

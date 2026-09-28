/**
 * Local calendar days as the stats store keys them: `YYYY-MM-DD`. Weekdays count
 * from 1 for Sunday, as goal plans and reminders store them.
 */

const pad = (value, width = 2) => String(value).padStart(width, '0')

export function dayKey(date) {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Local midnight of the day, or `null` for a key that is not one. */
export function dayDate(key) {
  const parts = String(key ?? '').split('-').map(Number)
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null
  return new Date(parts[0], parts[1] - 1, parts[2])
}

export function addDays(date, days) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
  return next
}

export function shiftDay(key, days) {
  const date = dayDate(key)
  return date ? dayKey(addDays(date, days)) : key
}

/** 1 = Sunday … 7 = Saturday. */
export function weekdayOf(date) {
  return date.getDay() + 1
}

export function weekdayName(weekday, style = 'long') {
  // 2023-01-01 was a Sunday.
  return new Date(2023, 0, weekday).toLocaleDateString(undefined, { weekday: style })
}

/** Weekdays in the order this locale's week runs. */
export function orderedWeekdays() {
  let first = 1
  try {
    const info = new Intl.Locale(navigator.language).weekInfo ?? new Intl.Locale(navigator.language).getWeekInfo?.()
    // Intl counts 1 = Monday … 7 = Sunday.
    if (info?.firstDay) first = (info.firstDay % 7) + 1
  } catch {
    first = 1
  }
  return Array.from({ length: 7 }, (_, index) => ((first - 1 + index) % 7) + 1)
}

/** "9–10 pm". */
export function hourRange(hour) {
  const format = (h) => new Date(2023, 0, 1, h % 24).toLocaleTimeString(undefined, { hour: 'numeric' })
  return `${format(hour)}–${format(hour + 1)}`
}

/** The offset the store records, minutes east of UTC. */
export function utcOffsetMinutes(date) {
  return -date.getTimezoneOffset()
}

export function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().toUpperCase()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16).toUpperCase()
  })
}

/* ---------------- formatting ---------------- */

export function formatNumber(value) {
  return Math.round(value).toLocaleString()
}

/** "1h 05m", "12m", "40s". */
export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  if (hours > 0) return `${hours}h ${pad(minutes)}m`
  if (minutes > 0) return `${minutes}m`
  return `${total}s`
}

/** "24:59", "1:02:03" — a clock. */
export function formatClock(seconds) {
  const total = Math.max(0, Math.ceil(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`
}

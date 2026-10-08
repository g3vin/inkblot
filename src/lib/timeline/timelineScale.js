/**
 * timelineScale.js — the axis of a timeline view: ticks in the project calendar.
 *
 * A view is `pxPerUnit` wide per unit — a day, or one sequence position — starting
 * from `origin`. Ticks land where the calendar turns over (midnight, the first of a
 * month, a new year) rather than at round day numbers, so a custom calendar's
 * 40-day months tick at their own boundaries. In a calendar of plain story days
 * there are no months, so ticks are round counts of days.
 */
import { formatDay, fromParts, normalizeCalendar, toParts } from '../map/calendar'

export const MIN_PX_PER_DAY = 0.002
export const MAX_PX_PER_DAY = 4000

/**
 * `viewport` (`{ origin, px }`) kept inside `bounds` (`[from, to]`) on a plot `width`
 * pixels wide: zoomed out no further than the whole span fills it, and panned no
 * further than either end. The axis runs from the first event to the last, not on
 * forever. When even `maxPx` cannot fill the plot, the span sits at its start.
 */
export function boundViewport(viewport, bounds, width, maxPx = MAX_PX_PER_DAY) {
  const [from, to] = bounds
  const span = Math.max(to - from, 1e-6)
  const px = Math.min(Math.max(viewport.px, width / span), Math.max(maxPx, width / span))
  const last = Math.max(from, to - width / px)
  return { ...viewport, px, origin: Math.min(last, Math.max(from, viewport.origin)) }
}

/** Aim for a major tick about every this many pixels. */
const TICK_SPACING = 90

const NICE_DAYS = [1 / 24, 1 / 12, 1 / 6, 1 / 4, 1 / 2, 1, 2, 7, 14, 30, 60, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000, 1e6]
const NICE_YEARS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000]
const NICE_MONTHS = [1, 2, 3, 6]

const firstAtLeast = (list, value) => list.find((item) => item >= value) ?? list[list.length - 1]

const yearLabel = (cal, year) => {
  if (cal.mode === 'gregorian') return year > 0 ? String(year) : `${1 - year} BC`
  return `Year ${year}${cal.custom.era ? ` ${cal.custom.era}` : ''}`
}

const monthsInYear = (cal) => (cal.mode === 'gregorian' ? 12 : cal.custom.months.length)

/** Ticks at round counts of days — a plain story-day calendar, or hours in any. */
function countTicks(cal, from, to, step) {
  const out = []
  const first = Math.ceil(from / step) * step
  for (let at = first; at <= to && out.length < 400; at += step) {
    // An hour tick names its day at midnight and only its time otherwise.
    const label = step < 1 && Math.abs(at - Math.round(at)) > 1e-9
      ? formatDay(cal, at, { withTime: true }).split(', ').pop()
      : formatDay(cal, Math.round(at * 1e6) / 1e6)
    out.push({ at, label })
  }
  return out
}

function dayTicks(cal, from, to, step) {
  const out = []
  let day = Math.ceil(from)
  if (step === 7) day += ((7 - (((day % 7) + 7) % 7)) % 7)
  for (; day <= to && out.length < 400; day += step) {
    const parts = toParts(cal, day)
    out.push({ at: day, label: `${parts.day} ${parts.monthName}` })
  }
  return out
}

function monthTicks(cal, from, to, step) {
  const out = []
  const count = monthsInYear(cal)
  const start = toParts(cal, from)
  let year = start.year
  let month = Math.floor((start.month - 1) / step) * step + 1
  for (let guard = 0; guard < 600; guard += 1) {
    const at = fromParts(cal, { year, month, day: 1 })
    if (at > to) break
    if (at >= from) {
      const parts = toParts(cal, at)
      out.push({ at, label: month === 1 ? `${parts.monthName} ${yearLabel(cal, year)}` : parts.monthName })
    }
    month += step
    if (month > count) {
      month -= count
      year += 1
    }
  }
  return out
}

function yearTicks(cal, from, to, step) {
  const out = []
  const first = Math.ceil(toParts(cal, from).year / step) * step
  for (let year = first; out.length < 400; year += step) {
    const at = fromParts(cal, { year, month: 1, day: 1 })
    if (at > to) break
    if (at >= from) out.push({ at, label: yearLabel(cal, year) })
  }
  return out
}

/**
 * The ticks between `from` and `to` (days) at `pxPerDay`: `[{ at, label }]`. A
 * calendar with months ticks by hours, days, weeks, months or years as the zoom
 * wants; a story-day one by round counts.
 */
export function calendarTicks(calendar, from, to, pxPerDay) {
  const cal = normalizeCalendar(calendar)
  const daysPerTick = TICK_SPACING / Math.max(pxPerDay, MIN_PX_PER_DAY)
  if (cal.mode === 'day' || daysPerTick < 1) {
    return countTicks(cal, from, to, firstAtLeast(NICE_DAYS, daysPerTick))
  }
  const monthDays = cal.mode === 'gregorian' ? 30.44 : cal.custom.months.reduce((sum, month) => sum + month.days, 0) / cal.custom.months.length
  const yearDays = monthDays * monthsInYear(cal)
  if (daysPerTick <= 7) return dayTicks(cal, from, to, daysPerTick <= 1 ? 1 : daysPerTick <= 2 ? 2 : 7)
  if (daysPerTick <= monthDays * 6) {
    const step = firstAtLeast(NICE_MONTHS, daysPerTick / monthDays)
    // A step of more months than the year has is a year or more: tick by years.
    if (step < monthsInYear(cal)) return monthTicks(cal, from, to, step)
  }
  return yearTicks(cal, from, to, firstAtLeast(NICE_YEARS, daysPerTick / yearDays))
}

/** Sequence ticks: every nth position, numbered from 1. */
export function sequenceTicks(from, to, pxPerUnit) {
  const step = firstAtLeast([1, 2, 5, 10, 20, 50, 100, 200, 500, 1000], TICK_SPACING / Math.max(pxPerUnit, 0.01))
  const out = []
  for (let at = Math.max(0, Math.ceil(from / step) * step); at <= to && out.length < 400; at += step) out.push({ at, label: `#${at + 1}` })
  return out
}

/** The unit a drag snaps to at this zoom, in days: an hour, a day, a month-ish, a year-ish. */
export function snapUnit(calendar, pxPerDay) {
  const cal = normalizeCalendar(calendar)
  if (pxPerDay >= 96) return 1 / 24
  if (pxPerDay >= 4) return 1
  if (cal.mode === 'day' || pxPerDay >= 0.15) return 1
  return 30
}

export const snapTo = (value, unit) => Math.round(value / unit) * unit

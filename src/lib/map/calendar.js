/**
 * calendar.js — turning the story's day numbers into dates, and back.
 *
 * The timeline runs on one axis for the whole project: a day number, a float, day 0
 * being the story's epoch. That is what journeys are scheduled on and what lets two
 * maps agree about when a character was where. A calendar only changes how a day is
 * *written*:
 *
 *   day        "Day 12"
 *   gregorian  "3 March 1850", counted from an epoch date — civil arithmetic, never
 *              `Date`, so there are no time zones and no DST to shift a day
 *   custom     a world's own months, weekdays, eras and leap rule
 *
 * The calendar belongs to the project (`.story/calendar.json`), not to a map.
 *
 * Mirrored in `inkblot_core::map::calendar`.
 */

export const DEFAULT_CALENDAR = {
  mode: 'day',
  gregorianEpoch: '1850-03-01',
  custom: {
    months: [
      { name: 'Deepwinter', days: 30 }, { name: 'Thaw', days: 30 }, { name: 'Seedtime', days: 30 },
      { name: 'Blossom', days: 30 }, { name: 'Highsun', days: 30 }, { name: 'Harvest', days: 30 },
      { name: 'Leaffall', days: 30 }, { name: 'Frostmoot', days: 30 }, { name: 'Longnight', days: 30 },
    ],
    weekdays: [],
    yearZero: 1,
    era: '',
    leap: null,
  },
}

const GREGORIAN_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const GREGORIAN_WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const positiveInt = (value, fallback) => (Number.isInteger(value) && value > 0 ? value : fallback)

/** Anything → a calendar, falling back part by part to the default. */
export function normalizeCalendar(raw) {
  const source = isObject(raw) ? raw : {}
  const custom = isObject(source.custom) ? source.custom : {}
  const months = (Array.isArray(custom.months) ? custom.months : [])
    .filter((month) => isObject(month) && typeof month.name === 'string')
    .map((month) => ({ name: month.name, days: positiveInt(month.days, 30) }))
  const leap = isObject(custom.leap) ? custom.leap : null
  const monthsOut = months.length ? months : DEFAULT_CALENDAR.custom.months
  return {
    ...source,
    mode: ['day', 'gregorian', 'custom'].includes(source.mode) ? source.mode : 'day',
    gregorianEpoch: /^-?\d{1,6}-\d{2}-\d{2}$/.test(source.gregorianEpoch || '') ? source.gregorianEpoch : DEFAULT_CALENDAR.gregorianEpoch,
    custom: {
      ...custom,
      months: monthsOut,
      weekdays: (Array.isArray(custom.weekdays) ? custom.weekdays : []).filter((name) => typeof name === 'string'),
      yearZero: Number.isInteger(custom.yearZero) ? custom.yearZero : 1,
      era: typeof custom.era === 'string' ? custom.era : '',
      leap: leap && positiveInt(leap.every, 0) && positiveInt(leap.days, 0)
        ? { every: leap.every, days: leap.days, month: Math.min(monthsOut.length, positiveInt(leap.month, 1)) }
        : null,
    },
  }
}

/* ---------- Gregorian: Howard Hinnant's days_from_civil / civil_from_days ---------- */

const floorDiv = (a, b) => Math.floor(a / b)

/** Days since 1970-01-01 of a proleptic Gregorian date. */
export function daysFromCivil(year, month, day) {
  const y = month <= 2 ? year - 1 : year
  const era = floorDiv(y, 400)
  const yoe = y - era * 400
  const mp = (month + 9) % 12
  const doy = floorDiv(153 * mp + 2, 5) + day - 1
  const doe = yoe * 365 + floorDiv(yoe, 4) - floorDiv(yoe, 100) + doy
  return era * 146097 + doe - 719468
}

/** The proleptic Gregorian date `z` days after 1970-01-01. */
export function civilFromDays(z) {
  const shifted = z + 719468
  const era = floorDiv(shifted, 146097)
  const doe = shifted - era * 146097
  const yoe = floorDiv(doe - floorDiv(doe, 1460) + floorDiv(doe, 36524) - floorDiv(doe, 146096), 365)
  const doy = doe - (365 * yoe + floorDiv(yoe, 4) - floorDiv(yoe, 100))
  const mp = floorDiv(5 * doy + 2, 153)
  const day = doy - floorDiv(153 * mp + 2, 5) + 1
  const month = mp < 10 ? mp + 3 : mp - 9
  return { year: yoe + era * 400 + (month <= 2 ? 1 : 0), month, day }
}

const parseEpoch = (text) => {
  const match = /^(-?\d+)-(\d{2})-(\d{2})$/.exec(text)
  return match ? daysFromCivil(Number(match[1]), Number(match[2]), Number(match[3])) : 0
}

/* ---------- custom calendars ---------- */

const baseYearLength = (custom) => custom.months.reduce((total, month) => total + month.days, 0)
const isLeapYear = (custom, year) => Boolean(custom.leap) && year % custom.leap.every === 0
const yearLength = (custom, year) => baseYearLength(custom) + (isLeapYear(custom, year) ? custom.leap.days : 0)
const monthLength = (custom, year, monthIndex) =>
  custom.months[monthIndex].days + (isLeapYear(custom, year) && custom.leap.month === monthIndex + 1 ? custom.leap.days : 0)

/**
 * The (0-based) year and day-of-year of `dayIndex` days after the start of year 0.
 * Whole leap cycles are skipped arithmetically, so this is O(cycle), not O(years).
 */
function customYearOf(custom, dayIndex) {
  const cycleYears = custom.leap ? custom.leap.every : 1
  let cycleDays = 0
  for (let year = 0; year < cycleYears; year += 1) cycleDays += yearLength(custom, year)
  const cycles = floorDiv(dayIndex, cycleDays)
  let year = cycles * cycleYears
  let remaining = dayIndex - cycles * cycleDays
  while (remaining >= yearLength(custom, year)) {
    remaining -= yearLength(custom, year)
    year += 1
  }
  return { year, dayOfYear: remaining }
}

function customDaysBeforeYear(custom, year) {
  const cycleYears = custom.leap ? custom.leap.every : 1
  let cycleDays = 0
  for (let index = 0; index < cycleYears; index += 1) cycleDays += yearLength(custom, index)
  const cycles = floorDiv(year, cycleYears)
  let days = cycles * cycleDays
  for (let index = cycles * cycleYears; index < year; index += 1) days += yearLength(custom, index)
  return days
}

/* ---------- parts ---------- */

/**
 * A day number → its calendar parts: `{ year, month (1-based), monthName, day
 * (1-based), weekday, hour, minute }`. In day mode, `day` is the 1-based story day.
 */
export function toParts(calendar, dayNumber) {
  const cal = normalizeCalendar(calendar)
  const whole = Math.floor(dayNumber)
  const fraction = dayNumber - whole
  // Capped at 23:59, so a hair before midnight never rounds into the next day's 00:00.
  const totalMinutes = Math.min(24 * 60 - 1, Math.round(fraction * 24 * 60))
  const hour = Math.floor(totalMinutes / 60) % 24
  const minute = totalMinutes % 60

  if (cal.mode === 'gregorian') {
    const z = parseEpoch(cal.gregorianEpoch) + whole
    const { year, month, day } = civilFromDays(z)
    const weekday = GREGORIAN_WEEKDAYS[(((z + 3) % 7) + 7) % 7]
    return { year, month, monthName: GREGORIAN_MONTHS[month - 1], day, weekday, hour, minute }
  }

  if (cal.mode === 'custom') {
    const { year, dayOfYear } = customYearOf(cal.custom, whole)
    let remaining = dayOfYear
    let monthIndex = 0
    while (monthIndex < cal.custom.months.length - 1 && remaining >= monthLength(cal.custom, year, monthIndex)) {
      remaining -= monthLength(cal.custom, year, monthIndex)
      monthIndex += 1
    }
    const weekdays = cal.custom.weekdays
    return {
      year: year + cal.custom.yearZero,
      month: monthIndex + 1,
      monthName: cal.custom.months[monthIndex].name,
      day: remaining + 1,
      weekday: weekdays.length ? weekdays[((whole % weekdays.length) + weekdays.length) % weekdays.length] : null,
      hour,
      minute,
    }
  }

  return { year: null, month: null, monthName: null, day: whole + 1, weekday: null, hour, minute }
}

/** Calendar parts → a day number (the inverse of toParts). */
export function fromParts(calendar, parts) {
  const cal = normalizeCalendar(calendar)
  const time = ((parts.hour || 0) * 60 + (parts.minute || 0)) / (24 * 60)
  if (cal.mode === 'gregorian') {
    return daysFromCivil(parts.year, parts.month, parts.day) - parseEpoch(cal.gregorianEpoch) + time
  }
  if (cal.mode === 'custom') {
    const year = parts.year - cal.custom.yearZero
    let days = customDaysBeforeYear(cal.custom, year)
    for (let index = 0; index < parts.month - 1; index += 1) days += monthLength(cal.custom, year, index)
    return days + parts.day - 1 + time
  }
  return parts.day - 1 + time
}

const pad = (value) => String(value).padStart(2, '0')

/** A day number as the calendar writes it. `withTime` adds the hour. */
export function formatDay(calendar, dayNumber, { withTime = false } = {}) {
  if (!Number.isFinite(dayNumber)) return '—'
  const cal = normalizeCalendar(calendar)
  const parts = toParts(cal, dayNumber)
  const time = withTime ? `, ${pad(parts.hour)}:${pad(parts.minute)}` : ''
  if (cal.mode === 'gregorian') {
    const year = parts.year > 0 ? String(parts.year) : `${1 - parts.year} BC`
    return `${parts.day} ${parts.monthName} ${year}${time}`
  }
  if (cal.mode === 'custom') {
    const era = cal.custom.era ? ` ${cal.custom.era}` : ''
    return `${parts.day} ${parts.monthName}, Year ${parts.year}${era}${time}`
  }
  return `Day ${parts.day}${time}`
}

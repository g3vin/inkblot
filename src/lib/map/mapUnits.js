/**
 * mapUnits.js — the units a map measures in, and how figures are shown.
 *
 * Internally every distance is kilometres, every speed km/h and every duration
 * days; a unit is only a way of writing one down. A map can add its own units
 * (a league of its world, a day's ride) in `scale.customUnits`.
 *
 * From a town to a universe: metres and miles, AU in a star system, light-years
 * and parsecs in a galaxy, megaparsecs between galaxies.
 */

export const KM_PER_AU = 149597870.7
export const KM_PER_LIGHT_YEAR = 9460730472580.8
export const KM_PER_PARSEC = 30856775814913.67
export const KM_PER_KILOPARSEC = KM_PER_PARSEC * 1e3
export const KM_PER_MEGAPARSEC = KM_PER_PARSEC * 1e6
export const KM_PER_MEGA_LIGHT_YEAR = KM_PER_LIGHT_YEAR * 1e6
/** The speed of light, in km/h. */
export const LIGHT_KMH = 1079252848.8

export const BUILTIN_UNITS = [
  { id: 'm', name: 'metres', short: 'm', km: 0.001 },
  { id: 'km', name: 'kilometres', short: 'km', km: 1 },
  { id: 'ft', name: 'feet', short: 'ft', km: 0.0003048 },
  { id: 'mi', name: 'miles', short: 'mi', km: 1.609344 },
  { id: 'nmi', name: 'nautical miles', short: 'nmi', km: 1.852 },
  { id: 'league', name: 'leagues', short: 'lea', km: 4.828032 },
  { id: 'AU', name: 'astronomical units', short: 'AU', km: KM_PER_AU },
  { id: 'ly', name: 'light-years', short: 'ly', km: KM_PER_LIGHT_YEAR },
  { id: 'pc', name: 'parsecs', short: 'pc', km: KM_PER_PARSEC },
  { id: 'kpc', name: 'kiloparsecs', short: 'kpc', km: KM_PER_KILOPARSEC },
  { id: 'Mly', name: 'million light-years', short: 'Mly', km: KM_PER_MEGA_LIGHT_YEAR },
  { id: 'Mpc', name: 'megaparsecs', short: 'Mpc', km: KM_PER_MEGAPARSEC },
]

/** Units that only make sense between stars and galaxies, not on a world's ground. */
export const ASTRONOMICAL_UNITS = new Set(['AU', 'ly', 'pc', 'kpc', 'Mly', 'Mpc'])

/** Every unit a map can use: built-ins, then its own (which win on a shared id). */
export function mapUnits(map) {
  const custom = Array.isArray(map?.scale?.customUnits) ? map.scale.customUnits : []
  const customIds = new Set(custom.map((unit) => unit.id))
  return [
    ...BUILTIN_UNITS.filter((unit) => !customIds.has(unit.id)),
    ...custom.map((unit) => ({ id: unit.id, name: unit.name || unit.id, short: unit.name || unit.id, km: unit.km })),
  ]
}

/** Kilometres in one `unitId`; 1 (a kilometre) for anything unknown. */
export function kmPerUnit(unitId, map) {
  const unit = mapUnits(map).find((candidate) => candidate.id === unitId)
  return unit && Number.isFinite(unit.km) && unit.km > 0 ? unit.km : 1
}

export const toKm = (value, unitId, map) => value * kmPerUnit(unitId, map)
export const fromKm = (km, unitId, map) => km / kmPerUnit(unitId, map)

/* ---------- display ---------- */

const trim = (text) => text.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')

/** A number with sensible precision for its size: 3 significant figures, grouped. */
export function formatNumber(value) {
  if (!Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  if (abs === 0) return '0'
  if (abs >= 1e6) return Math.round(value).toLocaleString('en-US')
  if (abs >= 100) return Math.round(value).toLocaleString('en-US')
  if (abs >= 10) return trim(value.toFixed(1))
  if (abs >= 1) return trim(value.toFixed(2))
  return trim(value.toPrecision(2))
}

/**
 * A distance in `unitId`. With `unitId` 'auto' the unit follows the size — metres to
 * kilometres to AU to light-years to millions of them — which is what a ruler in
 * space wants.
 */
export function formatDistance(km, unitId = 'km', map = null) {
  let unit = unitId
  if (unit === 'auto') {
    const abs = Math.abs(km)
    unit = abs < 1 ? 'm'
      : abs < 0.05 * KM_PER_AU ? 'km'
        : abs < 0.2 * KM_PER_LIGHT_YEAR ? 'AU'
          : abs < 1e6 * KM_PER_LIGHT_YEAR ? 'ly'
            : 'Mly'
  }
  const found = mapUnits(map).find((candidate) => candidate.id === unit)
  const short = found?.short || unit
  return `${formatNumber(fromKm(km, unit, map))} ${short}`
}

/** An area in square `unitId`s. */
export function formatArea(km2, unitId = 'km', map = null) {
  const per = kmPerUnit(unitId, map)
  const found = mapUnits(map).find((candidate) => candidate.id === unitId)
  return `${formatNumber(km2 / (per * per))} ${found?.short || unitId}²`
}

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`

/** How long light takes to cross `km`, the way a writer would say it: "8 minutes", "4.2 years". */
export const formatLightTime = (km) => formatDuration(km / LIGHT_KMH / 24)

/**
 * A duration given in days, the way a writer would say it: "3 days 4 hours",
 * "5 hours 20 minutes", "2.4 years".
 */
export function formatDuration(days) {
  if (!Number.isFinite(days)) return 'never — the way is impassable'
  const abs = Math.abs(days)
  if (abs >= 365.25 * 2e6) return `${formatNumber(days / 365.25e6)} million years`
  if (abs >= 365.25 * 2) return `${formatNumber(days / 365.25)} years`
  if (abs >= 60) return `${formatNumber(days / 30.44)} months`
  let wholeDays = Math.floor(abs)
  const hours = (abs - wholeDays) * 24
  if (wholeDays >= 1) {
    let roundedHours = Math.round(hours)
    // 3 days 23.6 hours reads as 4 days, not "3 days 24 hours".
    if (roundedHours === 24) {
      wholeDays += 1
      roundedHours = 0
    }
    return roundedHours ? `${plural(wholeDays, 'day')} ${plural(roundedHours, 'hour')}` : plural(wholeDays, 'day')
  }
  const wholeHours = Math.floor(hours)
  const minutes = Math.round((hours - wholeHours) * 60)
  if (wholeHours >= 1) return minutes ? `${plural(wholeHours, 'hour')} ${plural(minutes, 'minute')}` : plural(wholeHours, 'hour')
  return minutes >= 1 ? plural(minutes, 'minute') : 'under a minute'
}

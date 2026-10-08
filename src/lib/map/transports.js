/**
 * transports.js — how things get from one place to another.
 *
 * A transport is a speed (km/h) and how many hours of a day are actually spent
 * moving: a horse covers 8 km in an hour but not 192 km in a day. The built-ins are
 * sensible defaults for a writer, not a physics engine; a map can add its own
 * (a wyvern, a torch ship) or override any built-in by reusing its id.
 *
 * Relativistic transports give a fraction of c instead of a speed, and a traveller's
 * own clock runs slow by γ — which the timeline reports alongside the world's days.
 *
 * Mirrored in `inkblot_core::map::transports`.
 */
import { LIGHT_KMH } from './mapUnits'

export const BUILTIN_TRANSPORTS = [
  { id: 'walk', name: 'Walking', kmh: 5, hoursPerDay: 8, medium: 'land', fractionC: null, icon: 'walk' },
  { id: 'horse', name: 'Horseback', kmh: 8, hoursPerDay: 8, medium: 'land', fractionC: null },
  { id: 'gallop', name: 'Hard riding (relays)', kmh: 15, hoursPerDay: 12, medium: 'land', fractionC: null },
  { id: 'cart', name: 'Cart or wagon', kmh: 4, hoursPerDay: 8, medium: 'land', fractionC: null },
  { id: 'car', name: 'Car', kmh: 70, hoursPerDay: 8, medium: 'land', fractionC: null },
  { id: 'train', name: 'Steam train', kmh: 60, hoursPerDay: 18, medium: 'land', fractionC: null },
  { id: 'rowboat', name: 'Rowing boat', kmh: 4, hoursPerDay: 8, medium: 'water', fractionC: null },
  { id: 'sailingShip', name: 'Sailing ship', kmh: 9.26, hoursPerDay: 24, medium: 'water', fractionC: null },
  { id: 'steamship', name: 'Steamship', kmh: 18.52, hoursPerDay: 24, medium: 'water', fractionC: null },
  { id: 'airplane', name: 'Airliner', kmh: 850, hoursPerDay: 24, medium: 'air', fractionC: null },
  { id: 'rocket', name: 'Chemical rocket', kmh: 40000, hoursPerDay: 24, medium: 'space', fractionC: null },
  { id: 'light10', name: '10% of light speed', kmh: 0, hoursPerDay: 24, medium: 'space', fractionC: 0.1 },
  { id: 'light50', name: '50% of light speed', kmh: 0, hoursPerDay: 24, medium: 'space', fractionC: 0.5 },
  { id: 'light90', name: '90% of light speed', kmh: 0, hoursPerDay: 24, medium: 'space', fractionC: 0.9 },
  { id: 'light99', name: '99% of light speed', kmh: 0, hoursPerDay: 24, medium: 'space', fractionC: 0.99 },
]

const BUILTIN_BY_ID = new Map(BUILTIN_TRANSPORTS.map((transport) => [transport.id, transport]))

/** Every transport on a map: its own first (they override), then the built-ins. */
export function mapTransports(map) {
  const custom = Array.isArray(map?.transports) ? map.transports : []
  const customIds = new Set(custom.map((transport) => transport.id))
  return [...custom, ...BUILTIN_TRANSPORTS.filter((transport) => !customIds.has(transport.id))]
}

/** A transport by id; walking when there is no such transport. */
export function resolveTransport(map, id) {
  const custom = Array.isArray(map?.transports) ? map.transports.find((transport) => transport.id === id) : null
  return custom || BUILTIN_BY_ID.get(id) || BUILTIN_BY_ID.get('walk')
}

/** Speed in km/h, whether given directly or as a fraction of c. */
export const effectiveKmh = (transport) =>
  transport?.fractionC > 0 && transport.fractionC < 1 ? transport.fractionC * LIGHT_KMH : Math.max(transport?.kmh || 0, 1e-9)

/** γ, the time-dilation factor at `fractionC`. */
export const lorentzGamma = (fractionC) => 1 / Math.sqrt(1 - Math.min(0.999999999, Math.max(0, fractionC)) ** 2)

/** The days a traveller at `fractionC` lives through while the world lives `worldDays`. */
export const properTimeDays = (worldDays, fractionC) => (fractionC > 0 ? worldDays / lorentzGamma(fractionC) : worldDays)

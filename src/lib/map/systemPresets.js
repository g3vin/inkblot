/**
 * systemPresets.js — star systems to start from.
 *
 * The Solar System uses real mean orbital elements (J2000: semi-major axis,
 * eccentricity, longitude of perihelion ϖ, mean longitude L, so the mean anomaly at
 * day 0 is L − ϖ); the rest are plausible systems of their kind. All are ordinary
 * bodies afterwards, to edit, rename or delete.
 */
import { newId } from './mapModel'
import { starPreset } from './stars'
import { periodDays } from './orbits'

const star = (id, name, spectral, overrides = {}) => {
  const preset = starPreset(spectral)
  return {
    id,
    name,
    kind: 'star',
    parent: null,
    massSun: preset.massSun,
    radiusKm: preset.radiusSun * 695700,
    color: null,
    orbit: null,
    star: { spectral: preset.id, temperatureK: preset.temperatureK, luminositySun: preset.luminositySun },
    ...overrides,
  }
}

const body = (id, name, kind, parent, aAU, e, extra = {}) => ({
  id,
  name,
  kind,
  parent,
  massSun: null,
  radiusKm: null,
  color: null,
  orbit: { aAU, e, periapsisDeg: 0, meanAnomalyDeg: 0, periodDays: null, retrograde: false, ...(extra.orbit || {}) },
  ...Object.fromEntries(Object.entries(extra).filter(([key]) => key !== 'orbit')),
})

/** Longitude of perihelion and mean longitude → the orbit's angles. */
const angles = (varpi, meanLongitude) => ({ periapsisDeg: varpi, meanAnomalyDeg: (((meanLongitude - varpi) % 360) + 360) % 360 })

function sol() {
  return [
    star('sun', 'Sun', 'G2V'),
    body('mercury', 'Mercury', 'planet', 'sun', 0.387098, 0.20563, { massSun: 1.66e-7, color: '#9d8f85', orbit: angles(77.46, 252.25) }),
    body('venus', 'Venus', 'planet', 'sun', 0.723332, 0.006772, { massSun: 2.448e-6, color: '#e6c27a', orbit: angles(131.53, 181.98) }),
    body('earth', 'Earth', 'planet', 'sun', 1.000001, 0.016709, { massSun: 3.003e-6, color: '#4f8fd6', orbit: angles(102.94, 100.46) }),
    body('moon', 'Moon', 'moon', 'earth', 0.00257, 0.0549, { massSun: 3.69e-8, color: '#c9c9c9' }),
    body('mars', 'Mars', 'planet', 'sun', 1.523679, 0.0934, { massSun: 3.227e-7, color: '#d0673b', orbit: angles(336.04, 355.45) }),
    { id: 'belt', name: 'Asteroid belt', kind: 'belt', parent: 'sun', massSun: null, radiusKm: null, color: null, orbit: null, belt: { innerAU: 2.2, outerAU: 3.3 } },
    body('jupiter', 'Jupiter', 'planet', 'sun', 5.2044, 0.0489, { massSun: 9.546e-4, color: '#d8b38a', orbit: angles(14.75, 34.4) }),
    body('io', 'Io', 'moon', 'jupiter', 0.002819, 0.0041),
    body('europa', 'Europa', 'moon', 'jupiter', 0.004486, 0.009, { orbit: { meanAnomalyDeg: 90 } }),
    body('ganymede', 'Ganymede', 'moon', 'jupiter', 0.007155, 0.0013, { orbit: { meanAnomalyDeg: 200 } }),
    body('callisto', 'Callisto', 'moon', 'jupiter', 0.012585, 0.0074, { orbit: { meanAnomalyDeg: 300 } }),
    body('saturn', 'Saturn', 'planet', 'sun', 9.5826, 0.0565, { massSun: 2.858e-4, color: '#e3cf9a', orbit: angles(92.43, 49.94) }),
    body('titan', 'Titan', 'moon', 'saturn', 0.008168, 0.0288),
    body('uranus', 'Uranus', 'planet', 'sun', 19.2184, 0.0457, { massSun: 4.366e-5, color: '#9fd8e0', orbit: angles(170.96, 313.23) }),
    body('neptune', 'Neptune', 'planet', 'sun', 30.11, 0.0113, { massSun: 5.151e-5, color: '#4c6fe0', orbit: angles(44.97, 304.88) }),
    body('pluto', 'Pluto', 'dwarf', 'sun', 39.482, 0.2488, { massSun: 6.55e-9, color: '#c8b49a', orbit: angles(224.07, 238.93) }),
  ]
}

function redDwarf() {
  const worlds = [0.0115, 0.0158, 0.0223, 0.0293, 0.0385, 0.0469, 0.0619]
  return [
    star('star', 'Ember', 'M5V', { massSun: 0.089, star: { spectral: 'M5V', temperatureK: 2566, luminositySun: 0.000553 } }),
    ...worlds.map((aAU, index) =>
      body(`world-${index + 1}`, `Ember ${String.fromCharCode(98 + index)}`, 'planet', 'star', aAU, 0.005, {
        color: ['#b36b4f', '#c98e5b', '#8fb0c9', '#6f9e7a', '#7f8fb3', '#9aa2b0', '#b0b8c4'][index],
        orbit: { meanAnomalyDeg: (index * 137) % 360 },
      })
    ),
  ]
}

function binary() {
  const separation = 23
  const massA = 1.1
  const massB = 0.9
  const period = periodDays(separation, massA + massB)
  return [
    { id: 'pair', name: 'Barycentre', kind: 'barycenter', parent: null, massSun: null, radiusKm: null, color: null, orbit: null },
    star('a', 'Astra A', 'G2V', {
      parent: 'pair', massSun: massA,
      orbit: { aAU: (separation * massB) / (massA + massB), e: 0.3, periapsisDeg: 0, meanAnomalyDeg: 0, periodDays: period, retrograde: false },
    }),
    star('b', 'Astra B', 'K5V', {
      parent: 'pair', massSun: massB,
      orbit: { aAU: (separation * massA) / (massA + massB), e: 0.3, periapsisDeg: 180, meanAnomalyDeg: 0, periodDays: period, retrograde: false },
    }),
    body('home', 'Haven', 'planet', 'a', 1.1, 0.02, { massSun: 3e-6, color: '#4f8fd6' }),
    body('home-moon', 'Lantern', 'moon', 'home', 0.0025, 0.03),
    body('outer', 'Far Reach', 'planet', 'pair', 60, 0.05, { massSun: 2e-4, color: '#c9a36b' }),
  ]
}

function lone() {
  return [star('star', 'Star', 'G2V')]
}

export const SYSTEM_PRESETS = [
  { id: 'sol', label: 'The Solar System', hint: 'The Sun, eight planets, Pluto and the big moons', build: sol },
  { id: 'redDwarf', label: 'Red dwarf', hint: 'Seven close, rocky worlds round a dim star', build: redDwarf },
  { id: 'binary', label: 'Binary stars', hint: 'Two suns, a world round one, a giant round both', build: binary },
  { id: 'lone', label: 'A single star', hint: 'Start empty and add your own worlds', build: lone },
]

/** A fresh copy of a preset's bodies (ids prefixed, so two presets never collide). */
export function presetBodies(presetId) {
  const preset = SYSTEM_PRESETS.find((candidate) => candidate.id === presetId) || SYSTEM_PRESETS[0]
  return preset.build()
}

/** A new body to add to a system, orbiting `parentId`. */
export function newBody(kind, parentId, aAU) {
  const names = { planet: 'New world', moon: 'New moon', station: 'Station', dwarf: 'Dwarf planet', belt: 'Belt', star: 'Companion star' }
  if (kind === 'belt') {
    return { id: newId(), name: names.belt, kind, parent: parentId, massSun: null, radiusKm: null, color: null, orbit: null, belt: { innerAU: aAU, outerAU: aAU * 1.4 } }
  }
  if (kind === 'star') {
    return { ...star(newId(), names.star, 'M2V'), parent: parentId, orbit: { aAU, e: 0.1, periapsisDeg: 0, meanAnomalyDeg: 0, periodDays: null, retrograde: false } }
  }
  return body(newId(), names[kind] || 'Body', kind, parentId, aAU, 0.02, { orbit: { meanAnomalyDeg: Math.round(Math.random() * 360) } })
}

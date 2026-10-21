/**
 * systemPresets.js — star systems to start from.
 *
 * The Solar System uses real mean orbital elements (J2000: semi-major axis,
 * eccentricity, longitude of perihelion ϖ, mean longitude L, so the mean anomaly at
 * day 0 is L − ϖ); the rest are plausible systems of their kind. All are ordinary
 * bodies afterwards, to edit, rename or delete.
 *
 * Three groups: one star; several stars on nested orbits (Kepler, like every system
 * so far); and three bodies that all pull on each other (`dynamics: 'nbody'`,
 * nbody.js) — the known periodic solutions that hold together, and the ones that
 * fly apart. A chaotic template takes a seed and a `perturb`, so no two are alike,
 * and is softened at 0.01 AU — about two solar radii, where real stars would touch —
 * so its close passes stay cheap to follow and its energy stays put.
 */
import { newId } from './mapModel'
import { starFields, starPreset } from './stars'
import { G } from './nbody'
import { periodDays } from './orbits'
import { gaussian, random } from './seeded'

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
    star: starFields(preset),
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

/* ---------------- several stars, nested orbits ---------------- */

/** A pair of stars round their barycentre `pairId`, `separation` AU apart. */
function pair(pairId, parent, [idA, nameA, spectralA], [idB, nameB, spectralB], separation, e = 0, extra = {}) {
  const massA = starPreset(spectralA).massSun
  const massB = starPreset(spectralB).massSun
  const period = periodDays(separation, massA + massB)
  const orbitOf = (aAU, periapsisDeg) => ({ aAU, e, periapsisDeg, meanAnomalyDeg: 0, periodDays: period, retrograde: false, inclinationDeg: 0, ascendingNodeDeg: 0 })
  return [
    { id: pairId, name: extra.name || 'Barycentre', kind: 'barycenter', parent, massSun: null, radiusKm: null, color: null, orbit: extra.orbit || null },
    star(idA, nameA, spectralA, { parent: pairId, orbit: orbitOf((separation * massB) / (massA + massB), 0), ...(extra.a || {}) }),
    star(idB, nameB, spectralB, { parent: pairId, orbit: orbitOf((separation * massA) / (massA + massB), 180), ...(extra.b || {}) }),
  ]
}

function circumbinary() {
  return [
    ...pair('pair', null, ['a', 'Kepler A', 'K5V'], ['b', 'Kepler B', 'M2V'], 0.22, 0.16),
    body('world', 'Tatooine', 'planet', 'pair', 0.7, 0.007, { massSun: 1e-4, color: '#d9b77e' }),
    body('cold', 'Outer Dune', 'planet', 'pair', 2.1, 0.02, { color: '#8aa6c7', orbit: { meanAnomalyDeg: 140 } }),
  ]
}

function contact() {
  // Two stars so close they share one envelope: their surfaces touch.
  return pair('pair', null, ['a', 'Ursa A', 'F5V'], ['b', 'Ursa B', 'K5V'], 0.0098, 0, {
    a: { star: { ...starFields(starPreset('F5V')), contact: 'b' } },
  })
}

function xray() {
  // A blue supergiant pouring itself onto a black hole through a hot stream.
  return [
    ...pair('pair', null, ['donor', 'Cygnus', 'B8Ia'], ['hole', 'The Maw', 'BH'], 0.2, 0, {
      // Cygnus X-1's companion: a supergiant, but one that fits inside its orbit.
      a: { massSun: 21, radiusKm: 20 * 695700, star: { ...starFields(starPreset('B8Ia')), feeds: 'hole' } },
    }),
  ]
}

function triple() {
  // Alpha Centauri: a close pair, and a red dwarf a fifth of a light-year out.
  const inner = pair('pair', null, ['a', 'Rigil Kentaurus', 'G2V'], ['b', 'Toliman', 'K5V'], 23.4, 0.52)
  return [
    ...inner,
    { ...star('proxima', 'Proxima', 'M5V', { parent: 'pair', orbit: { aAU: 8700, e: 0.5, periapsisDeg: 0, meanAnomalyDeg: 200, periodDays: null, retrograde: false, inclinationDeg: 12, ascendingNodeDeg: 0 } }) },
    body('proxima-b', 'Proxima b', 'planet', 'proxima', 0.0485, 0.02, { massSun: 3.2e-6, color: '#a8724f' }),
  ]
}

function quadruple() {
  // Two pairs, each a close binary, orbiting one another.
  const massOf = (spectral) => starPreset(spectral).massSun
  const massA = massOf('F5V') + massOf('G2V')
  const massB = massOf('K5V') + massOf('M2V')
  const wide = 60
  const period = periodDays(wide, massA + massB)
  const outer = (aAU, periapsisDeg) => ({ aAU, e: 0.2, periapsisDeg, meanAnomalyDeg: 0, periodDays: period, retrograde: false, inclinationDeg: 0, ascendingNodeDeg: 0 })
  return [
    { id: 'centre', name: 'Barycentre', kind: 'barycenter', parent: null, massSun: null, radiusKm: null, color: null, orbit: null },
    ...pair('north', 'centre', ['na', 'Castor Aa', 'F5V'], ['nb', 'Castor Ab', 'G2V'], 0.12, 0.1, { name: 'North pair', orbit: outer((wide * massB) / (massA + massB), 0) }),
    ...pair('south', 'centre', ['sa', 'Castor Ba', 'K5V'], ['sb', 'Castor Bb', 'M2V'], 0.08, 0.05, { name: 'South pair', orbit: outer((wide * massA) / (massA + massB), 180) }),
  ]
}

/* ---------------- three bodies, all pulling ---------------- */

/**
 * A body for an N-body system: no orbit, a state. `pos` and `vel` are in units of
 * `length` AU and `length / time` AU a day, where time = √(length³ / (G · mass))
 * — the natural units the classic solutions are published in (G = m = 1).
 */
function scaled(length, massSun) {
  const time = Math.sqrt((length ** 3) / (G * massSun))
  return (id, name, spectral, mass, pos, vel, extra = {}) => ({
    ...star(id, name, spectral),
    massSun: mass * massSun,
    parent: null,
    orbit: null,
    state: { pos: [pos[0] * length, pos[1] * length, (pos[2] || 0) * length], vel: [(vel[0] * length) / time, (vel[1] * length) / time, ((vel[2] || 0) * length) / time] },
    ...extra,
  })
}

/** Nudge every velocity by up to `perturb` (a fraction), drawn from `seed`. */
function perturbed(bodies, seed, perturb) {
  if (!(perturb > 0)) return bodies
  const rand = random(seed)
  return bodies.map((candidate) => {
    if (!candidate.state) return candidate
    const vel = candidate.state.vel.map((value) => value * (1 + gaussian(rand) * perturb))
    return { ...candidate, state: { ...candidate.state, vel } }
  })
}

function figureEight({ seed, perturb }) {
  // Chenciner and Montgomery (2000): three equal stars chasing round one figure 8.
  const at = scaled(1, 1)
  const v3 = [-0.93240737, -0.86473146]
  return perturbed([
    at('a', 'Ana', 'G2V', 1, [0.97000436, -0.24308753], [-v3[0] / 2, -v3[1] / 2]),
    at('b', 'Bel', 'G2V', 1, [-0.97000436, 0.24308753], [-v3[0] / 2, -v3[1] / 2]),
    at('c', 'Cora', 'G2V', 1, [0, 0], v3),
  ], seed, perturb)
}

function lagrange({ seed, perturb }) {
  // Lagrange's triangle, held rigid as it turns: stable when one body is much the
  // heaviest (Routh's criterion), as with the Sun, Jupiter and its Trojans.
  const masses = [1, 0.02, 0.0008]
  const total = masses[0] + masses[1] + masses[2]
  const side = 3
  const corners = [[0, 0], [side, 0], [side / 2, (side * Math.sqrt(3)) / 2]]
  const centre = [0, 1].map((axis) => corners.reduce((sum, corner, index) => sum + corner[axis] * masses[index], 0) / total)
  const omega = Math.sqrt((G * total) / side ** 3)
  const spectral = ['G2V', 'T', 'T']
  const names = ['Sol Prime', 'Warden', 'Trojan']
  return perturbed(masses.map((mass, index) => {
    const x = corners[index][0] - centre[0]
    const y = corners[index][1] - centre[1]
    return { ...star(['a', 'b', 'c'][index], names[index], spectral[index]), massSun: mass, parent: null, orbit: null, state: { pos: [x, y, 0], vel: [-omega * y, omega * x, 0] } }
  }), seed, perturb)
}

function hierarchical({ seed, perturb }) {
  // A tight pair and a far third: stable while the outer orbit is wide enough
  // (Mardling–Aarseth), here by a long way.
  return perturbed([
    ...pair('pair', null, ['a', 'Hesper', 'G2V'], ['b', 'Vesper', 'K5V'], 0.4, 0.1),
    star('c', 'Wanderer', 'M2V', { parent: 'pair', orbit: { aAU: 9, e: 0.15, periapsisDeg: 0, meanAnomalyDeg: 90, periodDays: null, retrograde: false, inclinationDeg: 20, ascendingNodeDeg: 30 } }),
  ], seed, perturb)
}

function sitnikov({ seed, perturb }) {
  // Two equal stars in a circle, and a planet bobbing up and down through their
  // middle, along the axis: Sitnikov's problem.
  const separation = 1
  const mass = 1
  const speed = Math.sqrt((G * 2 * mass) / separation) / 2
  return perturbed([
    { ...star('a', 'Gemma', 'G2V'), massSun: mass, parent: null, orbit: null, state: { pos: [separation / 2, 0, 0], vel: [0, speed, 0] } },
    { ...star('b', 'Geminus', 'G2V'), massSun: mass, parent: null, orbit: null, state: { pos: [-separation / 2, 0, 0], vel: [0, -speed, 0] } },
    { ...body('p', 'Pendulum', 'planet', null, 1, 0, { massSun: 1e-9, color: '#7fa7d9' }), orbit: null, state: { pos: [0, 0, 0.35], vel: [0, 0, 0] } },
  ], seed, perturb)
}

function butterfly({ seed, perturb }) {
  // Šuvakov and Dmitrašinović's butterfly (2013): periodic, but unstable — it
  // holds its shape for a few turns, then tangles into chaos.
  const at = scaled(1, 1)
  const p = [0.30689, 0.12551]
  return perturbed([
    at('a', 'Psyche', 'F5V', 1, [-1, 0], p),
    at('b', 'Eros', 'F5V', 1, [1, 0], p),
    at('c', 'Moth', 'K5V', 1, [0, 0], [-2 * p[0], -2 * p[1]]),
  ], seed, perturb)
}

function pythagorean({ seed, perturb }) {
  // Burrau's problem: masses 3, 4 and 5 at rest at the corners of a 3-4-5
  // triangle. After close passes, two leave as a pair and one is flung away.
  const at = scaled(0.3, 1)
  return perturbed([
    at('a', 'Three', 'K5V', 3, [1, 3], [0, 0]),
    at('b', 'Four', 'G2V', 4, [-2, -1], [0, 0]),
    at('c', 'Five', 'F5V', 5, [1, -1], [0, 0]),
  ], seed, perturb)
}

function encounter({ seed, perturb }) {
  // Three stars thrown together from a seed: every one different.
  const rand = random(seed)
  const spectral = ['G2V', 'K5V', 'M2V', 'F5V']
  const bodies = ['a', 'b', 'c'].map((id, index) => {
    const pick = spectral[Math.floor(rand() * spectral.length)]
    const mass = starPreset(pick).massSun
    const pos = [gaussian(rand) * 2, gaussian(rand) * 2, gaussian(rand) * 0.4]
    const vel = [gaussian(rand) * 0.004, gaussian(rand) * 0.004, gaussian(rand) * 0.001]
    return { ...star(id, ['Ira', 'Oro', 'Una'][index], pick), massSun: mass, parent: null, orbit: null, state: { pos, vel } }
  })
  return perturbed(bodies, seed + 1, perturb)
}

/**
 * Every template: `group` (single, multiple, three), `stable` for the three-body
 * ones (whether it holds together over the story), and `dynamics`.
 */
export const SYSTEM_PRESETS = [
  { id: 'sol', group: 'single', label: 'The Solar System', hint: 'The Sun, eight planets, Pluto and the big moons', build: sol },
  { id: 'redDwarf', group: 'single', label: 'Red dwarf', hint: 'Seven close, rocky worlds round a dim star', build: redDwarf },
  { id: 'lone', group: 'single', label: 'A single star', hint: 'Start empty and add your own worlds', build: lone },
  { id: 'binary', group: 'multiple', label: 'Binary stars', hint: 'Two suns, a world round one, a giant round both', build: binary },
  { id: 'circumbinary', group: 'multiple', label: 'Circumbinary', hint: 'A close pair of suns, with worlds circling both', build: circumbinary },
  { id: 'contact', group: 'multiple', label: 'Contact binary', hint: 'Two stars so close they share one skin', build: contact },
  { id: 'xray', group: 'multiple', label: 'X-ray binary', hint: 'A giant star feeding a black hole', build: xray },
  { id: 'triple', group: 'multiple', label: 'Triple, like Alpha Centauri', hint: 'A close pair, and a red dwarf far out', build: triple },
  { id: 'quadruple', group: 'multiple', label: 'Quadruple', hint: 'Two pairs of stars, circling each other', build: quadruple },
  { id: 'figureEight', group: 'three', stable: true, dynamics: 'nbody', label: 'Figure eight', hint: 'Three equal suns chasing round one path', build: figureEight, stepDays: 0.25 },
  { id: 'lagrange', group: 'three', stable: true, dynamics: 'nbody', label: 'Lagrange triangle', hint: 'A sun and two companions, always a triangle', build: lagrange, stepDays: 0.5 },
  { id: 'hierarchical', group: 'three', stable: true, dynamics: 'nbody', label: 'Pair and a wanderer', hint: 'A close pair and a far third sun', build: hierarchical, stepDays: 0.25 },
  { id: 'sitnikov', group: 'three', stable: true, dynamics: 'nbody', label: 'Sitnikov pendulum', hint: 'A world bobbing between twin suns', build: sitnikov, stepDays: 0.1 },
  { id: 'butterfly', group: 'three', stable: false, dynamics: 'nbody', label: 'Butterfly', hint: 'A graceful dance that soon tangles into chaos', build: butterfly, stepDays: 0.1 },
  { id: 'pythagorean', group: 'three', stable: false, dynamics: 'nbody', label: 'Burrau’s three', hint: 'Close passes, then one sun is flung away', build: pythagorean, stepDays: 0.05 },
  { id: 'encounter', group: 'three', stable: false, dynamics: 'nbody', label: 'Random encounter', hint: 'Three suns thrown together — different every time', build: encounter, stepDays: 0.25 },
]

export const SYSTEM_PRESET_GROUPS = [
  ['single', 'One star'],
  ['multiple', 'Several stars'],
  ['three', 'Three bodies'],
]

/**
 * A whole `system` section for a preset: its bodies, dynamics and, for a template
 * that can be re-rolled, what it was made from (`template`).
 */
export function presetSystem(presetId, { seed = 1, perturb = 0 } = {}) {
  const preset = SYSTEM_PRESETS.find((candidate) => candidate.id === presetId) || SYSTEM_PRESETS[0]
  const nbody = preset.dynamics === 'nbody'
  return {
    bodies: preset.build({ seed, perturb }),
    display: { radial: nbody ? 'linear' : 'log', pxPerAU: nbody ? 160 : 100, view: '3d' },
    dynamics: nbody ? 'nbody' : 'kepler',
    ...(nbody ? { nbody: { stepDays: preset.stepDays || 0.25, softeningAU: preset.stable ? 0.001 : 0.01, horizonDays: 3650 }, template: { id: preset.id, seed, perturb } } : {}),
  }
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

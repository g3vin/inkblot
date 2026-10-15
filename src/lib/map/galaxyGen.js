/**
 * galaxyGen.js — a galaxy of stars, drawn from its type and a seed.
 *
 * Every Hubble class, and the shapes outside the sequence, built as a cloud of
 * points: where the light is (positions, light-years, the disc in x–y and z its
 * thickness), what colour it is (by the stellar population there), and how bright
 * each point is. A second, darker cloud is the dust.
 *
 *   E0–E7      de Vaucouleurs light, flattened by the class; old red-gold stars
 *   S0         a bright bulge in a smooth disc, no arms, a faint dust lane
 *   Sa–Sd      a bulge that shrinks and arms that open Sa → Sd; blue knots and pink
 *              star-forming clouds along the arms; dust lanes on their inner edges
 *   SBa–SBd    as spirals, with a bar the arms leave from (and maybe an inner ring)
 *   ring       a Hoag-like ring round a round core
 *   irregular  clumps, like the Magellanic Clouds
 *   dwarf      a sparse, faint spheroid
 *   peculiar   a spiral pulled about by a passing neighbour, with a tidal tail
 *
 * Every free choice — the number of arms, their phase, the pitch, the width, where
 * an arm forks, where the knots fall, the bulge's share, the colours, a warp — is
 * drawn from the seed, so no two galaxies look alike, and the same seed always
 * draws the same galaxy, point for point. `params` holds any choice the writer has
 * fixed (keep the pitch, reroll the rest).
 */
import { gaussian, random } from './seeded'
import { temperatureToColor } from './stars'

const TAU = Math.PI * 2
const RAD = Math.PI / 180

/** Per spiral class: the bulge's share of the light, and the arms' pitch (degrees). */
const SPIRAL_CLASS = {
  a: { bulge: 0.38, pitch: 8, arms: [2, 2, 2, 3] },
  b: { bulge: 0.24, pitch: 13, arms: [2, 2, 3, 4] },
  c: { bulge: 0.12, pitch: 20, arms: [2, 3, 4, 4] },
  d: { bulge: 0.05, pitch: 28, arms: [3, 4, 5, 6] },
}

/** Names for the types, for menus and the setup gallery. */
export const GALAXY_TYPE_NAMES = {
  E0: 'Round elliptical (E0)',
  E3: 'Elliptical (E3)',
  E5: 'Flattened elliptical (E5)',
  E7: 'Lens-shaped elliptical (E7)',
  S0: 'Lenticular (S0)',
  Sa: 'Spiral, tightly wound (Sa)',
  Sb: 'Spiral (Sb)',
  Sc: 'Spiral, open arms (Sc)',
  Sd: 'Spiral, loose and clumpy (Sd)',
  SBa: 'Barred spiral, tight (SBa)',
  SBb: 'Barred spiral (SBb)',
  SBc: 'Barred spiral, open (SBc)',
  SBd: 'Barred spiral, loose (SBd)',
  ring: 'Ring galaxy',
  irregular: 'Irregular',
  dwarf: 'Dwarf spheroidal',
  peculiar: 'Peculiar, after a close encounter',
}

const hexRgb = (hex) => {
  const value = parseInt(hex.slice(1), 16)
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255]
}
const kelvinRgb = (kelvin) => hexRgb(temperatureToColor(kelvin))
const HII = [1, 0.45, 0.62]

/**
 * The choices a galaxy is drawn with: everything `params` does not fix, from the
 * seed. Returned so the inspector can show (and lock) them.
 */
export function galaxyShape(galaxy) {
  const rand = random((galaxy.seed >>> 0) ^ 0x9e3779b9)
  const params = galaxy.params || {}
  const type = galaxy.type || 'Sb'
  const pick = (key, value) => (Number.isFinite(params[key]) ? params[key] : value)
  const spiral = /^S(B)?([abcd])$/.exec(type)
  const klass = spiral ? SPIRAL_CLASS[spiral[2]] : null
  return {
    type,
    barred: Boolean(spiral?.[1]),
    arms: pick('arms', klass ? klass.arms[Math.floor(rand() * klass.arms.length)] : 0),
    pitchDeg: pick('pitchDeg', klass ? klass.pitch * (0.8 + rand() * 0.4) : 0),
    bulge: pick('bulge', klass ? klass.bulge * (0.8 + rand() * 0.4) : type === 'S0' ? 0.45 : type === 'ring' ? 0.3 : 0),
    armWidth: pick('armWidth', 0.18 + rand() * 0.16),
    phase: pick('phase', rand() * TAU),
    barLength: pick('barLength', spiral?.[1] ? 0.22 + rand() * 0.14 : 0),
    innerRing: pick('innerRing', spiral?.[1] && rand() < 0.35 ? 1 : 0),
    ellipticity: pick('ellipticity', /^E(\d)$/.test(type) ? Number(type[1]) / 10 : 0),
    clumps: pick('clumps', 4 + Math.floor(rand() * 6)),
    warp: pick('warp', rand() * 0.12),
    knots: pick('knots', 0.5 + rand() * 0.5),
    dust: pick('dust', /^E/.test(type) || type === 'dwarf' ? 0 : 0.4 + rand() * 0.6),
    tint: pick('tint', rand()),
  }
}

/** A point's colour, by population: old (bulge), young (arms), in between (disc). */
function population(kind, rand, tint) {
  if (kind === 'old') return kelvinRgb(3600 + rand() * 1600 + tint * 400)
  if (kind === 'young') return kelvinRgb(rand() < 0.15 ? 20000 + rand() * 15000 : 7500 + rand() * 6000)
  return kelvinRgb(4800 + rand() * 2400)
}

/**
 * Draw a galaxy: `{ count, positions (x, y, z ly), colors (r, g, b), sizes, dust:
 * { count, positions, sizes }, shape }`. `count` points of light; dust is about a
 * fifth as many.
 */
export function generateGalaxy(galaxy, { count = 60000 } = {}) {
  const shape = galaxyShape(galaxy)
  const rand = random(galaxy.seed >>> 0)
  const R = galaxy.radiusLy > 0 ? galaxy.radiusLy : 50000
  const H = galaxy.thicknessLy > 0 ? galaxy.thicknessLy : 1000
  const type = shape.type
  const total = type === 'dwarf' ? Math.max(500, Math.round(count * 0.3)) : count
  const positions = new Float32Array(total * 3)
  const colors = new Float32Array(total * 3)
  const sizes = new Float32Array(total)
  const dustBudget = Math.round(total * 0.2 * shape.dust)
  const dustPositions = new Float32Array(dustBudget * 3)
  const dustSizes = new Float32Array(dustBudget)
  let n = 0
  let d = 0

  const put = (x, y, z, rgb, size) => {
    if (n >= total) return
    // A gentle warp: the disc's edge bends up on one side, down on the other.
    const r = Math.hypot(x, y) / R
    const warped = z + shape.warp * R * r * r * Math.sin(Math.atan2(y, x) - shape.phase)
    positions[n * 3] = x
    positions[n * 3 + 1] = y
    positions[n * 3 + 2] = warped
    colors[n * 3] = rgb[0]
    colors[n * 3 + 1] = rgb[1]
    colors[n * 3 + 2] = rgb[2]
    sizes[n] = size
    n += 1
  }
  const putDust = (x, y, z, size) => {
    if (d >= dustBudget) return
    dustPositions[d * 3] = x
    dustPositions[d * 3 + 1] = y
    dustPositions[d * 3 + 2] = z
    dustSizes[d] = size
    d += 1
  }
  const brightness = () => 0.6 + 1.4 * rand() ** 3

  /** A spheroid of old stars: de Vaucouleurs-like, flattened by `flat`. */
  const spheroid = (howMany, radius, flat, kind = 'old', dim = 1) => {
    for (let index = 0; index < howMany; index += 1) {
      // r^(1/4) light: concentrate the draw towards the centre.
      const r = radius * Math.min(1, 0.012 * (-Math.log(1 - rand() * 0.9999)) ** 3.2)
      const u = rand() * 2 - 1
      const a = rand() * TAU
      const s = Math.sqrt(1 - u * u)
      put(r * s * Math.cos(a), r * s * Math.sin(a) * (1 - flat * 0.6), r * u * (1 - flat), population(kind, rand, shape.tint), brightness() * dim)
    }
  }
  /** An exponential disc of stars at random angles. */
  const disc = (howMany, scale, kind = 'disc') => {
    for (let index = 0; index < howMany; index += 1) {
      const r = Math.min(R, scale * -Math.log(1 - rand() * 0.995))
      const a = rand() * TAU
      put(r * Math.cos(a), r * Math.sin(a), gaussian(rand) * H * 0.5 * Math.exp(-r / R), population(kind, rand, shape.tint), brightness() * 0.8)
    }
  }

  if (/^E\d$/.test(type)) {
    spheroid(total, R, shape.ellipticity)
  } else if (type === 'dwarf') {
    spheroid(total, R * 0.5, 0.15, 'old', 0.55)
  } else if (type === 'irregular') {
    const clumps = Array.from({ length: shape.clumps }, () => ({
      x: gaussian(rand) * R * 0.3,
      y: gaussian(rand) * R * 0.22,
      size: R * (0.06 + rand() * 0.14),
      weight: 0.3 + rand(),
    }))
    const weights = clumps.reduce((sum, clump) => sum + clump.weight, 0)
    disc(Math.round(total * 0.3), R * 0.3, 'disc')
    for (const clump of clumps) {
      const howMany = Math.round((total * 0.7 * clump.weight) / weights)
      for (let index = 0; index < howMany; index += 1) {
        put(clump.x + gaussian(rand) * clump.size, clump.y + gaussian(rand) * clump.size, gaussian(rand) * H, rand() < 0.08 ? HII : population('young', rand, shape.tint), brightness())
      }
    }
  } else if (type === 'ring') {
    spheroid(Math.round(total * shape.bulge), R * 0.25, 0.05)
    const ringR = R * 0.72
    for (let index = n; index < total; index += 1) {
      const a = rand() * TAU
      const r = ringR + gaussian(rand) * R * 0.05
      put(r * Math.cos(a), r * Math.sin(a), gaussian(rand) * H * 0.4, rand() < 0.07 ? HII : population('young', rand, shape.tint), brightness())
    }
  } else if (type === 'S0') {
    spheroid(Math.round(total * shape.bulge), R * 0.35, 0.3)
    disc(total - n, R * 0.28, 'old')
    for (let index = 0; index < dustBudget; index += 1) {
      const a = rand() * TAU
      const r = R * (0.3 + rand() * 0.25)
      putDust(r * Math.cos(a), r * Math.sin(a), gaussian(rand) * H * 0.15, 1 + rand() * 2)
    }
  } else {
    // Spirals, barred or not, and the peculiar (a spiral, disturbed).
    const peculiar = type === 'peculiar'
    // A bar holds much of what would be bulge in an unbarred spiral.
    const bulge = peculiar ? 0.12 : shape.barred ? shape.bulge * 0.3 : shape.bulge
    const arms = peculiar ? 2 : Math.max(1, Math.round(shape.arms))
    const tanPitch = Math.tan(Math.max(4, peculiar ? 22 : shape.pitchDeg) * RAD)
    const bar = shape.barLength * R
    spheroid(Math.round(total * bulge), R * 0.3, 0.35)
    if (bar > 0) {
      const barStars = Math.round(total * 0.28)
      for (let index = 0; index < barStars; index += 1) {
        // A Ferrers-like bar: long along x, thin across.
        const t = (rand() * 2 - 1) * Math.sqrt(rand())
        const x = t * bar
        const y = gaussian(rand) * bar * 0.09 * (1 - Math.abs(t) * 0.5)
        const c = Math.cos(shape.phase)
        const s = Math.sin(shape.phase)
        put(x * c - y * s, x * s + y * c, gaussian(rand) * H * 0.3, population('old', rand, shape.tint), brightness())
      }
      if (shape.innerRing) {
        const ringStars = Math.round(total * 0.04)
        for (let index = 0; index < ringStars; index += 1) {
          const a = rand() * TAU
          const r = bar * (1.05 + gaussian(rand) * 0.04)
          put(r * Math.cos(a), r * Math.sin(a), gaussian(rand) * H * 0.3, population('young', rand, shape.tint), brightness())
        }
      }
    }
    // Where the arms begin: the bar's ends, or near the bulge.
    const r0 = Math.max(bar, R * 0.08)
    const forkAt = R * (0.45 + rand() * 0.3)
    const forkArm = Math.floor(rand() * arms)
    const armStars = Math.round((total - n) * 0.62)
    const knots = Array.from({ length: Math.round(40 * shape.knots) }, () => ({ arm: Math.floor(rand() * arms), r: r0 + rand() * (R - r0), size: R * (0.006 + rand() * 0.012) }))
    const armAngle = (arm, r, fork = 0) => shape.phase + (arm * TAU) / arms + Math.log(Math.max(r, r0) / r0) / tanPitch + fork
    for (let index = 0; index < armStars; index += 1) {
      const arm = Math.floor(rand() * arms)
      const r = r0 + Math.min(R - r0, R * 0.32 * -Math.log(1 - rand() * 0.995))
      // An arm forks: past `forkAt` some of its stars take a branch, splaying off.
      const fork = arm === forkArm && r > forkAt && rand() < 0.4 ? 0.35 * Math.log(r / forkAt + 1) : 0
      const width = shape.armWidth * (0.6 + r / R)
      const a = armAngle(arm, r, fork) + gaussian(rand) * width * 0.35
      const young = rand() < 0.7
      put(r * Math.cos(a), r * Math.sin(a), gaussian(rand) * H * 0.35, young ? population('young', rand, shape.tint) : population('disc', rand, shape.tint), brightness() * (young ? 1.1 : 0.9))
      // Dust on the arm's inner (trailing) edge.
      if (rand() < 0.35) {
        const behind = a - 0.12 * (1 + r / R)
        putDust(r * 0.97 * Math.cos(behind), r * 0.97 * Math.sin(behind), gaussian(rand) * H * 0.2, 1 + rand() * 2.5)
      }
    }
    // Knots of new stars and pink clouds of glowing gas, strung along the arms.
    for (const knot of knots) {
      const a = armAngle(knot.arm, knot.r)
      const cx = knot.r * Math.cos(a)
      const cy = knot.r * Math.sin(a)
      const pink = rand() < 0.5
      for (let index = 0; index < 30; index += 1) put(cx + gaussian(rand) * knot.size, cy + gaussian(rand) * knot.size, gaussian(rand) * H * 0.2, pink ? HII : kelvinRgb(15000 + rand() * 15000), brightness() * 1.3)
    }
    if (peculiar) {
      // The tidal tail: a long stream thrown out on one side.
      const tailStars = Math.round(total * 0.12)
      for (let index = 0; index < tailStars; index += 1) {
        const t = rand()
        const a = shape.phase + t * 2.2
        const r = R * (0.6 + t * 1.3)
        put(r * Math.cos(a) + gaussian(rand) * R * 0.04 * (1 + t), r * Math.sin(a) + gaussian(rand) * R * 0.04 * (1 + t), gaussian(rand) * H * (1 + t * 4), population(rand() < 0.5 ? 'young' : 'disc', rand, shape.tint), brightness() * 0.8)
      }
    }
    disc(total - n, R * 0.3, 'disc')
  }

  return {
    count: n,
    positions: n === total ? positions : positions.slice(0, n * 3),
    colors: n === total ? colors : colors.slice(0, n * 3),
    sizes: n === total ? sizes : sizes.slice(0, n),
    dust: { count: d, positions: dustPositions.slice(0, d * 3), sizes: dustSizes.slice(0, d) },
    shape,
  }
}

/* ---------------- measuring one (for the tests, and a sanity check) ---------------- */

/**
 * Statistics of a generated galaxy: the share of light within 15% of the radius
 * (the bulge), how strongly two-fold its disc is (m = 2 Fourier power: arms or a
 * bar), the inner bar's aspect ratio, and its flattening.
 */
export function galaxyStats(result, radiusLy) {
  const { positions, count } = result
  // The bar is measured inside its own length (or the inner third, without one).
  const barReach = radiusLy * (result.shape?.barLength > 0 ? result.shape.barLength * 0.9 : 0.3)
  let central = 0
  let re = 0
  let im = 0
  let annulus = 0
  let barXX = 0
  let barYY = 0
  let barXY = 0
  let barCount = 0
  let zz = 0
  let rr = 0
  for (let index = 0; index < count; index += 1) {
    const x = positions[index * 3]
    const y = positions[index * 3 + 1]
    const z = positions[index * 3 + 2]
    const r = Math.hypot(x, y)
    if (r < radiusLy * 0.15) central += 1
    if (r > radiusLy * 0.3 && r < radiusLy * 0.8) {
      const a = Math.atan2(y, x)
      re += Math.cos(2 * a)
      im += Math.sin(2 * a)
      annulus += 1
    }
    if (r < barReach && r > radiusLy * 0.05) {
      barXX += x * x
      barYY += y * y
      barXY += x * y
      barCount += 1
    }
    zz += z * z
    rr += x * x + y * y
  }
  // The bar's aspect: the ratio of the principal second moments, inside it.
  const trace = barXX + barYY
  const det = barXX * barYY - barXY * barXY
  const gap = Math.sqrt(Math.max(0, (trace * trace) / 4 - det))
  const major = trace / 2 + gap
  const minor = Math.max(1e-9, trace / 2 - gap)
  return {
    bulgeShare: central / Math.max(1, count),
    twoFold: annulus ? Math.hypot(re, im) / annulus : 0,
    barAspect: barCount ? Math.sqrt(major / minor) : 1,
    flatness: Math.sqrt(zz / Math.max(1e-9, rr / 2)),
  }
}

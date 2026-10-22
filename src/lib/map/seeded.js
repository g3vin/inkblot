/**
 * seeded.js — randomness that is the same every time.
 *
 * Generated planets, chaotic star systems and galaxies are drawn from a seed, so a
 * map stores one number and looks the same on every machine and every opening.
 * `random(seed)` is mulberry32; `noise3` is a seeded value-gradient noise in three
 * dimensions (sampled on a sphere it has no seam and no pinched poles), and `fbm3`
 * stacks octaves of it.
 */

/** A generator of numbers in [0, 1) from a 32-bit seed. */
export function random(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A seed from anything: a number stays itself, a string is hashed (FNV-1a). */
export function seedOf(value) {
  if (Number.isFinite(value)) return Math.trunc(value) >>> 0
  let hash = 0x811c9dc5
  for (const char of String(value ?? '')) {
    hash ^= char.codePointAt(0)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** A fresh seed for a "Reroll": random, but kept to a short number a writer can read. */
export const newSeed = () => 1 + Math.floor(Math.random() * 999999)

/** A normally distributed number (Box–Muller) from a generator. */
export function gaussian(rand) {
  let u = 0
  while (u === 0) u = rand()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
}

/* ---------------- 3D gradient noise ---------------- */

const hash3 = (x, y, z, seed) => {
  let h = Math.imul(x, 0x8da6b343) ^ Math.imul(y, 0xd8163841) ^ Math.imul(z, 0xcb1ab31f) ^ Math.imul(seed, 0x27d4eb2d)
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995)
  return (h ^ (h >>> 15)) >>> 0
}

/** Twelve gradient directions (the edges of a cube), as in improved Perlin noise. */
const GRADIENTS = [[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1], [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]]

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10)
const lerp = (a, b, t) => a + (b - a) * t

/** Perlin-style gradient noise in [-1, 1] (roughly), seeded. */
export function noise3(x, y, z, seed = 0) {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const zi = Math.floor(z)
  const xf = x - xi
  const yf = y - yi
  const zf = z - zi
  const corner = (dx, dy, dz) => {
    const g = GRADIENTS[hash3(xi + dx, yi + dy, zi + dz, seed) % 12]
    return g[0] * (xf - dx) + g[1] * (yf - dy) + g[2] * (zf - dz)
  }
  const u = fade(xf)
  const v = fade(yf)
  const w = fade(zf)
  return lerp(
    lerp(lerp(corner(0, 0, 0), corner(1, 0, 0), u), lerp(corner(0, 1, 0), corner(1, 1, 0), u), v),
    lerp(lerp(corner(0, 0, 1), corner(1, 0, 1), u), lerp(corner(0, 1, 1), corner(1, 1, 1), u), v),
    w
  )
}

/** Fractal noise: `octaves` of noise3, each twice as fine and `gain` as strong. */
export function fbm3(x, y, z, seed = 0, octaves = 5, gain = 0.5, lacunarity = 2) {
  let sum = 0
  let amplitude = 1
  let frequency = 1
  let norm = 0
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += noise3(x * frequency, y * frequency, z * frequency, seed + octave * 1013) * amplitude
    norm += amplitude
    amplitude *= gain
    frequency *= lacunarity
  }
  return sum / norm
}

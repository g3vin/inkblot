/**
 * planetTexture.js — a world's surface, drawn from a seed.
 *
 * Produces an equirectangular picture (longitude −180…180 left to right, latitude
 * 90…−90 top to bottom) and a height map for relief shading. Pure and seeded, so
 * the same look gives the same world on every machine; it runs in a worker
 * (planetTexture.worker.js) because a large one takes a few hundred milliseconds.
 *
 * Kinds (`look.kind`):
 *   generated  continents of fractal noise, a sea at `seaLevel`, colours from a
 *              palette by height and latitude (ice caps where it is cold)
 *   gas        a giant's bands, stirred, with a few storms
 *   ice        an ice world: pale, cracked
 *
 * `mask` (optional) is what the writer drew, rasterized at the same size: each byte
 * a MASK_* code. Drawn land rises out of the sea, drawn water sinks, mountains rise
 * higher, ice and desert colour the ground — so continents can be drawn by hand.
 */
import { fbm3, random } from './seeded'

export const MASK_NONE = 0
export const MASK_LAND = 1
export const MASK_WATER = 2
export const MASK_MOUNTAINS = 3
export const MASK_ICE = 4
export const MASK_DESERT = 5
export const MASK_FOREST = 6

/** Which mask a region's terrain paints (terrains.js ids). */
export const TERRAIN_MASK = {
  plains: MASK_LAND,
  road: MASK_LAND,
  hills: MASK_LAND,
  swamp: MASK_FOREST,
  forest: MASK_FOREST,
  mountains: MASK_MOUNTAINS,
  desert: MASK_DESERT,
  ice: MASK_ICE,
  water: MASK_WATER,
  'rough-sea': MASK_WATER,
}

/**
 * Palettes for rocky worlds: colours from the deep sea to the peaks, as [r, g, b]
 * 0–255, and how cold its poles are (`caps`: the latitude ice reaches, in degrees).
 */
export const PLANET_PALETTES = {
  temperate: { label: 'Temperate, like Earth', deep: [18, 42, 92], shallow: [38, 94, 150], shore: [208, 196, 150], low: [74, 122, 62], mid: [118, 136, 78], high: [128, 112, 92], peak: [236, 236, 240], forest: [44, 92, 50], desert: [214, 186, 128], caps: 66 },
  arid: { label: 'Desert', deep: [60, 52, 80], shallow: [92, 104, 130], shore: [226, 196, 140], low: [206, 160, 102], mid: [184, 124, 76], high: [148, 96, 64], peak: [236, 222, 200], forest: [120, 118, 70], desert: [228, 190, 128], caps: 80 },
  ocean: { label: 'Ocean', deep: [10, 30, 82], shallow: [26, 88, 160], shore: [226, 214, 170], low: [70, 138, 92], mid: [96, 150, 96], high: [120, 120, 110], peak: [236, 236, 240], forest: [40, 100, 60], desert: [214, 192, 140], caps: 70 },
  frozen: { label: 'Frozen', deep: [32, 52, 92], shallow: [92, 130, 170], shore: [200, 210, 220], low: [196, 210, 222], mid: [214, 224, 234], high: [178, 186, 198], peak: [250, 252, 255], forest: [120, 140, 130], desert: [200, 196, 186], caps: 30 },
  lava: { label: 'Volcanic', deep: [255, 120, 30], shallow: [230, 70, 20], shore: [60, 40, 36], low: [40, 32, 30], mid: [66, 52, 46], high: [90, 74, 66], peak: [130, 116, 108], forest: [50, 40, 36], desert: [80, 60, 50], caps: 90 },
  barren: { label: 'Barren, like the Moon', deep: [70, 70, 74], shallow: [96, 96, 100], shore: [120, 120, 122], low: [134, 132, 130], mid: [154, 150, 146], high: [176, 172, 168], peak: [206, 204, 200], forest: [120, 120, 118], desert: [170, 160, 146], caps: 90 },
  rust: { label: 'Rust, like Mars', deep: [96, 54, 40], shallow: [128, 70, 48], shore: [176, 104, 70], low: [182, 98, 60], mid: [198, 120, 74], high: [160, 92, 66], peak: [226, 204, 190], forest: [140, 90, 60], desert: [210, 140, 90], caps: 78 },
  alien: { label: 'Alien', deep: [40, 18, 70], shallow: [86, 40, 120], shore: [196, 170, 120], low: [126, 46, 96], mid: [168, 70, 110], high: [96, 120, 140], peak: [220, 230, 236], forest: [70, 30, 90], desert: [200, 150, 110], caps: 72 },
}

/** Palettes for giants: [light band, dark band, storm]. */
export const GAS_PALETTES = {
  jovian: { label: 'Banded, like Jupiter', light: [226, 208, 176], dark: [168, 116, 78], storm: [196, 96, 64] },
  saturnine: { label: 'Pale gold, like Saturn', light: [234, 220, 176], dark: [196, 170, 120], storm: [236, 230, 210] },
  neptunian: { label: 'Ice giant, like Neptune', light: [96, 140, 226], dark: [54, 86, 186], storm: [30, 48, 120] },
  uranian: { label: 'Pale blue-green', light: [176, 226, 230], dark: [140, 200, 212], storm: [220, 244, 246] },
  hot: { label: 'Hot Jupiter', light: [196, 110, 80], dark: [96, 40, 40], storm: [250, 180, 90] },
}

const mix = (a, b, t) => {
  const k = Math.min(1, Math.max(0, t))
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
}

/** The direction on a unit sphere for pixel (x, y) of a width × height picture. */
function directionAt(x, y, width, height) {
  const lon = ((x + 0.5) / width) * 2 * Math.PI - Math.PI
  const lat = Math.PI / 2 - ((y + 0.5) / height) * Math.PI
  return { lat, d: [Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon)] }
}

/* ---------------- rocky worlds ---------------- */

function rocky(look, width, height, mask, color, relief) {
  const palette = PLANET_PALETTES[look.palette] || PLANET_PALETTES.temperate
  const seed = look.seed >>> 0
  const roughness = look.roughness ?? 0.5
  const seaLevel = look.seaLevel ?? 0.55
  const base = 1.1 + roughness * 1.6
  const gain = 0.42 + roughness * 0.18
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const { lat, d } = directionAt(x, y, width, height)
      // Continents (broad) plus detail (fine), in 0…1.
      const broad = fbm3(d[0] * base, d[1] * base, d[2] * base, seed, 4, 0.5) * 0.5 + 0.5
      const fine = fbm3(d[0] * base * 4, d[1] * base * 4, d[2] * base * 4, seed + 77, 4, gain) * 0.5 + 0.5
      let h = broad * 0.72 + fine * 0.28
      // Stretch around the middle so a sea level between 0.3 and 0.7 means something.
      h = Math.min(1, Math.max(0, (h - 0.5) * 1.9 + 0.5))
      const index = y * width + x
      const drawn = mask ? mask[index] : MASK_NONE
      if (drawn === MASK_WATER) h = Math.min(h, seaLevel - 0.04 - fine * 0.1)
      else if (drawn === MASK_MOUNTAINS) h = Math.max(h, seaLevel + 0.3 + fine * 0.25)
      else if (drawn !== MASK_NONE) h = Math.max(h, seaLevel + 0.03 + fine * 0.18)
      const latitude = Math.abs(lat) * (180 / Math.PI)
      // The ice's edge wanders (a broad noise, ±6°), comes further down on high
      // ground, and fades in over a few degrees: never a ruled line of latitude.
      const wander = fbm3(d[0] * 3, d[1] * 3, d[2] * 3, seed + 131, 3, 0.5) * 6
      const edge = palette.caps + wander - (h > seaLevel ? (h - seaLevel) * 30 : 0)
      const ice = Math.min(1, Math.max(0, (latitude - edge) / 4 + 0.5))
      const cold = ice > 0
      let rgb
      if (h < seaLevel) {
        rgb = mix(palette.deep, palette.shallow, (h / Math.max(seaLevel, 1e-6)) ** 3)
        if (cold) rgb = mix(rgb, palette.peak, 0.85 * ice)
      } else {
        const t = (h - seaLevel) / Math.max(1 - seaLevel, 1e-6)
        rgb = t < 0.04 ? mix(palette.shore, palette.low, t / 0.04)
          : t < 0.45 ? mix(palette.low, palette.mid, (t - 0.04) / 0.41)
            : t < 0.8 ? mix(palette.mid, palette.high, (t - 0.45) / 0.35)
              : mix(palette.high, palette.peak, (t - 0.8) / 0.2)
        if (drawn === MASK_FOREST) rgb = mix(rgb, palette.forest, 0.7)
        else if (drawn === MASK_DESERT) rgb = mix(rgb, palette.desert, 0.8)
        else if (drawn === MASK_ICE || cold) rgb = mix(rgb, palette.peak, drawn === MASK_ICE ? 0.9 : 0.85 * ice)
      }
      color[index * 4] = rgb[0]
      color[index * 4 + 1] = rgb[1]
      color[index * 4 + 2] = rgb[2]
      color[index * 4 + 3] = 255
      relief[index] = Math.round(Math.max(h, seaLevel) * 255)
    }
  }
}

/* ---------------- giants ---------------- */

function gas(look, width, height, color, relief) {
  const palette = GAS_PALETTES[look.palette] || GAS_PALETTES.jovian
  const seed = look.seed >>> 0
  const rand = random(seed)
  const bands = 9 + Math.floor(rand() * 10)
  const phase = rand() * Math.PI * 2
  const storms = Array.from({ length: 1 + Math.floor(rand() * 3) }, () => ({
    lon: rand() * 2 * Math.PI - Math.PI,
    lat: (rand() - 0.5) * 1.6,
    size: 0.06 + rand() * 0.1,
  }))
  const turbulence = 0.4 + (look.roughness ?? 0.5) * 1.2
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const { lat, d } = directionAt(x, y, width, height)
      const lon = ((x + 0.5) / width) * 2 * Math.PI - Math.PI
      const stir = fbm3(d[0] * 2.5, d[1] * 9, d[2] * 2.5, seed, 5, 0.55)
      const band = Math.sin(lat * bands + phase + stir * turbulence * 3) * 0.5 + 0.5
      let rgb = mix(palette.dark, palette.light, band)
      for (const storm of storms) {
        const dLon = Math.atan2(Math.sin(lon - storm.lon), Math.cos(lon - storm.lon))
        const r = Math.hypot(dLon * Math.cos(lat) / 1.8, lat - storm.lat) / storm.size
        if (r < 1) rgb = mix(rgb, palette.storm, (1 - r * r) * 0.85)
      }
      const index = y * width + x
      color[index * 4] = rgb[0]
      color[index * 4 + 1] = rgb[1]
      color[index * 4 + 2] = rgb[2]
      color[index * 4 + 3] = 255
      relief[index] = 128
    }
  }
}

/* ---------------- ice worlds ---------------- */

function ice(look, width, height, mask, color, relief) {
  const seed = look.seed >>> 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const { d } = directionAt(x, y, width, height)
      const plate = fbm3(d[0] * 2, d[1] * 2, d[2] * 2, seed, 4) * 0.5 + 0.5
      // Cracks: where a ridged noise is near zero.
      const ridge = Math.abs(fbm3(d[0] * 6, d[1] * 6, d[2] * 6, seed + 9, 3))
      const crack = ridge < 0.035 ? 1 - ridge / 0.035 : 0
      let rgb = mix([204, 222, 236], [244, 248, 252], plate)
      rgb = mix(rgb, [150, 104, 84], crack * 0.7)
      const index = y * width + x
      if (mask && mask[index] === MASK_WATER) rgb = mix(rgb, [60, 104, 150], 0.7)
      color[index * 4] = rgb[0]
      color[index * 4 + 1] = rgb[1]
      color[index * 4 + 2] = rgb[2]
      color[index * 4 + 3] = 255
      relief[index] = Math.round((0.4 + plate * 0.4 - crack * 0.2) * 255)
    }
  }
}

/**
 * Draw a world: `{ width, height, color (RGBA bytes), relief (one byte a pixel) }`.
 * `mask` is optional (see above). A look this does not draw (a picture, a star)
 * comes back plain grey.
 */
export function planetTexture(look, { width = 1024, height = 512, mask = null } = {}) {
  const color = new Uint8ClampedArray(width * height * 4)
  const relief = new Uint8ClampedArray(width * height)
  if (look.kind === 'gas') gas(look, width, height, color, relief)
  else if (look.kind === 'ice') ice(look, width, height, mask, color, relief)
  else if (look.kind === 'generated') rocky(look, width, height, mask, color, relief)
  else {
    color.fill(128)
    relief.fill(128)
  }
  return { width, height, color, relief }
}

/** What a look's picture depends on, as a cache key. */
export const planetTextureKey = (look, size, maskKey = '') =>
  JSON.stringify([look.kind, look.seed, look.palette, look.seaLevel, look.roughness, size.width, size.height, maskKey])

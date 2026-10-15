/**
 * planetPresets.js — worlds and stars to start a planet map from, and the world a
 * body in a star system opens as.
 *
 * Each preset is a `surface` section (mapModel.js `readSurface`): a radius, a day,
 * a tilt and a look. Every generated look takes a seed, so two "Earth-like" worlds
 * are two different worlds; Reroll draws another.
 */
import { orbitPeriod } from './orbits'
import { starPreset } from './stars'
import { seedOf } from './seeded'

const SUN_RADIUS_KM = 695700

export const PLANET_PRESETS = [
  { id: 'earthlike', group: 'world', label: 'Earth-like', hint: 'Continents, seas and ice caps', surface: { radiusKm: 6371, dayHours: 24, axialTiltDeg: 23.4, look: { kind: 'generated', palette: 'temperate', seaLevel: 0.55, roughness: 0.5 } } },
  { id: 'ocean', group: 'world', label: 'Ocean world', hint: 'Islands in a world-wide sea', surface: { radiusKm: 7200, dayHours: 30, axialTiltDeg: 12, look: { kind: 'generated', palette: 'ocean', seaLevel: 0.72, roughness: 0.55 } } },
  { id: 'desert', group: 'world', label: 'Desert world', hint: 'Dunes and dry basins', surface: { radiusKm: 5900, dayHours: 22, axialTiltDeg: 8, look: { kind: 'generated', palette: 'arid', seaLevel: 0.18, roughness: 0.45 } } },
  { id: 'frozen', group: 'world', label: 'Frozen world', hint: 'Snow to the tropics', surface: { radiusKm: 6000, dayHours: 26, axialTiltDeg: 30, look: { kind: 'generated', palette: 'frozen', seaLevel: 0.45, roughness: 0.5 } } },
  { id: 'volcanic', group: 'world', label: 'Volcanic', hint: 'Black rock and seas of lava', surface: { radiusKm: 6100, dayHours: 18, axialTiltDeg: 3, atmosphere: false, look: { kind: 'generated', palette: 'lava', seaLevel: 0.32, roughness: 0.7 } } },
  { id: 'rust', group: 'world', label: 'Like Mars', hint: 'Red plains and old craters', surface: { radiusKm: 3390, dayHours: 24.6, axialTiltDeg: 25.2, yearDays: 687, look: { kind: 'generated', palette: 'rust', seaLevel: 0.12, roughness: 0.6 } } },
  { id: 'barren', group: 'world', label: 'Like the Moon', hint: 'Grey and airless', surface: { radiusKm: 1737, dayHours: 655.7, axialTiltDeg: 1.5, atmosphere: false, look: { kind: 'generated', palette: 'barren', seaLevel: 0, roughness: 0.75 } } },
  { id: 'alien', group: 'world', label: 'Alien', hint: 'Violet seas and red forests', surface: { radiusKm: 6800, dayHours: 31, axialTiltDeg: 17, look: { kind: 'generated', palette: 'alien', seaLevel: 0.5, roughness: 0.5 } } },
  { id: 'ice', group: 'world', label: 'Ice moon', hint: 'A cracked shell over a hidden sea', surface: { radiusKm: 1561, dayHours: 85, axialTiltDeg: 0.1, atmosphere: false, look: { kind: 'ice' } } },
  { id: 'jovian', group: 'giant', label: 'Gas giant', hint: 'Bands and great storms', surface: { radiusKm: 69911, dayHours: 9.9, axialTiltDeg: 3.1, yearDays: 4333, look: { kind: 'gas', palette: 'jovian', roughness: 0.5 } } },
  { id: 'saturnine', group: 'giant', label: 'Pale giant', hint: 'Soft gold bands', surface: { radiusKm: 58232, dayHours: 10.7, axialTiltDeg: 26.7, yearDays: 10759, look: { kind: 'gas', palette: 'saturnine', roughness: 0.3 } } },
  { id: 'neptunian', group: 'giant', label: 'Ice giant', hint: 'Deep blue, wind-scoured', surface: { radiusKm: 24622, dayHours: 16.1, axialTiltDeg: 28.3, yearDays: 60190, look: { kind: 'gas', palette: 'neptunian', roughness: 0.6 } } },
  { id: 'hot', group: 'giant', label: 'Hot Jupiter', hint: 'Scorched, close to its star', surface: { radiusKm: 95000, dayHours: 84, axialTiltDeg: 0, yearDays: 3.5, look: { kind: 'gas', palette: 'hot', roughness: 0.8 } } },
  { id: 'sun', group: 'star', label: 'A star like the Sun', hint: 'Yellow, steady', surface: { radiusKm: SUN_RADIUS_KM, dayHours: 609, axialTiltDeg: 7.25, atmosphere: false, look: { kind: 'star', spectral: 'G2V', temperatureK: 5772 } } },
  { id: 'redDwarf', group: 'star', label: 'Red dwarf', hint: 'Small, dim and long-lived', surface: { radiusKm: 0.42 * SUN_RADIUS_KM, dayHours: 1000, axialTiltDeg: 0, atmosphere: false, look: { kind: 'star', spectral: 'M2V', temperatureK: 3500 } } },
  { id: 'redGiant', group: 'star', label: 'Red giant', hint: 'Swollen and boiling', surface: { radiusKm: 25 * SUN_RADIUS_KM, dayHours: 20000, axialTiltDeg: 0, atmosphere: false, look: { kind: 'star', spectral: 'K3III', temperatureK: 4300 } } },
  { id: 'blueGiant', group: 'star', label: 'Blue giant', hint: 'Fierce and short-lived', surface: { radiusKm: 12 * SUN_RADIUS_KM, dayHours: 50, axialTiltDeg: 0, atmosphere: false, look: { kind: 'star', spectral: 'O5V', temperatureK: 41000 } } },
]

export const PLANET_PRESET_GROUPS = [
  ['world', 'Rocky worlds'],
  ['giant', 'Giants'],
  ['star', 'Stars'],
]

/** A preset's surface, with a seed of its own. */
export function presetSurface(presetId, seed = 1) {
  const preset = PLANET_PRESETS.find((candidate) => candidate.id === presetId) || PLANET_PRESETS[0]
  return { ...preset.surface, look: { ...preset.surface.look, seed } }
}

const hueOf = (hex) => {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex || '')
  if (!match) return null
  const value = parseInt(match[1], 16)
  const r = ((value >> 16) & 255) / 255
  const g = ((value >> 8) & 255) / 255
  const b = (value & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (max - min < 0.08) return { hue: null, light: max }
  const hue = max === r ? ((g - b) / (max - min) + 6) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4
  return { hue: hue * 60, light: max }
}

/**
 * The surface a body in a star system opens as: a star as itself, a giant as a
 * giant, a rocky world in a palette guessed from the colour it was given — its
 * size, day, tilt and year from the system, and its seed from its id, so opening
 * it twice gives the same world.
 */
export function surfaceForBody(body, bodies) {
  const seed = seedOf(body.id)
  const period = body.orbit ? orbitPeriod(body, bodies) : null
  const common = {
    dayHours: body.rotationHours || 24,
    axialTiltDeg: body.axialTiltDeg || 0,
    ...(period ? { yearDays: period } : {}),
  }
  if (body.kind === 'star') {
    const preset = starPreset(body.star?.spectral)
    return {
      ...common,
      radiusKm: body.radiusKm || preset.radiusSun * SUN_RADIUS_KM,
      atmosphere: false,
      look: { kind: 'star', spectral: preset.id, temperatureK: body.star?.temperatureK ?? preset.temperatureK, seed },
    }
  }
  const colour = hueOf(body.color)
  const giant = (body.massSun || 0) > 3e-5 || (body.radiusKm || 0) > 20000
  if (giant) {
    const blue = colour?.hue !== null && colour?.hue !== undefined && colour.hue > 170 && colour.hue < 260
    return { ...common, radiusKm: body.radiusKm || (blue ? 24622 : 69911), atmosphere: true, look: { kind: 'gas', palette: blue ? 'neptunian' : 'jovian', roughness: 0.5, seed } }
  }
  const palette = !colour || colour.hue === null
    ? (colour?.light ?? 0.5) > 0.85 ? 'frozen' : 'barren'
    : colour.hue < 25 || colour.hue >= 330 ? 'rust'
      : colour.hue < 65 ? 'arid'
        : colour.hue < 170 ? 'temperate'
          : colour.hue < 260 ? 'ocean' : 'alien'
  const radiusKm = body.radiusKm || (body.kind === 'moon' ? 1737 : body.kind === 'dwarf' ? 1188 : 6371)
  const seaLevel = { rust: 0.12, arid: 0.2, temperate: 0.55, ocean: 0.7, alien: 0.5, frozen: 0.45, barren: 0 }[palette]
  return { ...common, radiusKm, atmosphere: palette !== 'barren', look: { kind: 'generated', palette, seaLevel, roughness: 0.5, seed } }
}

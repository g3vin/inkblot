/**
 * stars.js — what a star is like, from what kind it is.
 *
 * Presets for the spectral classes a writer is likely to want, the colour a star of
 * a given temperature appears, how bright a main-sequence star of a given mass is,
 * and where liquid water is possible around it. Approximations good to a story's
 * standard, not an astronomer's; every figure is overridable in the system builder.
 */

/**
 * Temperature K, mass M☉, radius R☉, luminosity L☉, and `look`: how the 3D view
 * draws it (a shader variant), with what it does — a pulsar's `spinSeconds`, a
 * Cepheid's `variable` pulse, a protostar's disc and jets. `group` sorts the menu.
 */
export const STAR_PRESETS = [
  { id: 'O5V', name: 'Blue giant (O)', group: 'main', look: 'main', temperatureK: 41000, massSun: 40, radiusSun: 12, luminositySun: 300000 },
  { id: 'B5V', name: 'Blue-white (B)', group: 'main', look: 'main', temperatureK: 15700, massSun: 5.9, radiusSun: 3.9, luminositySun: 830 },
  { id: 'A0V', name: 'White (A)', group: 'main', look: 'main', temperatureK: 9700, massSun: 2.4, radiusSun: 1.8, luminositySun: 25 },
  { id: 'F5V', name: 'Yellow-white (F)', group: 'main', look: 'main', temperatureK: 6550, massSun: 1.3, radiusSun: 1.4, luminositySun: 3.2 },
  { id: 'G2V', name: 'Yellow, like the Sun (G)', group: 'main', look: 'main', temperatureK: 5772, massSun: 1, radiusSun: 1, luminositySun: 1 },
  { id: 'K5V', name: 'Orange dwarf (K)', group: 'main', look: 'main', temperatureK: 4400, massSun: 0.7, radiusSun: 0.7, luminositySun: 0.16 },
  { id: 'M2V', name: 'Red dwarf (M)', group: 'main', look: 'main', temperatureK: 3500, massSun: 0.44, radiusSun: 0.42, luminositySun: 0.025 },
  { id: 'M5V', name: 'Dim red dwarf (late M)', group: 'main', look: 'main', temperatureK: 3050, massSun: 0.16, radiusSun: 0.2, luminositySun: 0.0017 },
  { id: 'T', name: 'Brown dwarf', group: 'main', look: 'brownDwarf', temperatureK: 1200, massSun: 0.05, radiusSun: 0.1, luminositySun: 0.00002 },
  { id: 'TTau', name: 'Newborn star (T Tauri)', group: 'young', look: 'protostar', temperatureK: 4200, massSun: 0.8, radiusSun: 2.5, luminositySun: 1.8 },
  { id: 'K3III', name: 'Red giant', group: 'giant', look: 'giant', temperatureK: 4300, massSun: 1.2, radiusSun: 25, luminositySun: 200 },
  { id: 'M2Ia', name: 'Red supergiant', group: 'giant', look: 'giant', temperatureK: 3600, massSun: 18, radiusSun: 760, luminositySun: 110000 },
  { id: 'B8Ia', name: 'Blue supergiant', group: 'giant', look: 'blueSupergiant', temperatureK: 12100, massSun: 21, radiusSun: 79, luminositySun: 120000 },
  { id: 'HG', name: 'Yellow hypergiant', group: 'giant', look: 'hypergiant', temperatureK: 7000, massSun: 40, radiusSun: 420, luminositySun: 500000 },
  { id: 'WR', name: 'Wolf–Rayet star', group: 'giant', look: 'wolfRayet', temperatureK: 70000, massSun: 20, radiusSun: 2, luminositySun: 300000 },
  { id: 'C', name: 'Carbon star', group: 'giant', look: 'carbon', temperatureK: 2800, massSun: 1.5, radiusSun: 200, luminositySun: 5000 },
  { id: 'CEP', name: 'Cepheid (pulsing)', group: 'giant', look: 'main', temperatureK: 6000, massSun: 5, radiusSun: 45, luminositySun: 2000, variable: { periodDays: 5.37, amplitude: 0.35 } },
  { id: 'DA', name: 'White dwarf', group: 'remnant', look: 'whiteDwarf', temperatureK: 25000, massSun: 0.6, radiusSun: 0.012, luminositySun: 0.03 },
  { id: 'NS', name: 'Neutron star', group: 'remnant', look: 'neutron', temperatureK: 600000, massSun: 1.4, radiusSun: 0.0000172, luminositySun: 0.00001 },
  { id: 'PSR', name: 'Pulsar', group: 'remnant', look: 'pulsar', temperatureK: 600000, massSun: 1.4, radiusSun: 0.0000172, luminositySun: 0.00001, spinSeconds: 0.714 },
  { id: 'MAG', name: 'Magnetar', group: 'remnant', look: 'magnetar', temperatureK: 600000, massSun: 1.4, radiusSun: 0.0000172, luminositySun: 0.00001, spinSeconds: 6 },
  { id: 'BH', name: 'Black hole', group: 'remnant', look: 'blackHole', temperatureK: 0, massSun: 10, radiusSun: 0.0000425, luminositySun: 0 },
]

/** How the menu groups them. */
export const STAR_GROUPS = [
  ['main', 'Ordinary stars'],
  ['young', 'Young'],
  ['giant', 'Giants'],
  ['remnant', 'What stars leave behind'],
]

export const starPreset = (id) => STAR_PRESETS.find((preset) => preset.id === id) || STAR_PRESETS[4]

const clampByte = (value) => Math.round(Math.min(255, Math.max(0, value)))
const hex = (value) => clampByte(value).toString(16).padStart(2, '0')

/**
 * The colour of a blackbody at `kelvin`, as a CSS hex (Tanner Helland's fit to the
 * CIE blackbody locus). A black hole — 0 K — is black.
 */
export function temperatureToColor(kelvin) {
  if (!(kelvin > 0)) return '#000000'
  const t = Math.min(40000, Math.max(1000, kelvin)) / 100
  const red = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592
  const green = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * (t - 60) ** -0.0755148492
  const blue = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307
  return `#${hex(red)}${hex(green)}${hex(blue)}`
}

/** Main-sequence luminosity (L☉) from mass (M☉), piecewise mass–luminosity relation. */
export function massToLuminosity(massSun) {
  if (!(massSun > 0)) return 0
  if (massSun < 0.43) return 0.23 * massSun ** 2.3
  if (massSun < 2) return massSun ** 4
  if (massSun < 55) return 1.4 * massSun ** 3.5
  return 32000 * massSun
}

/** The conservative habitable zone (AU) for a star of `luminositySun`. */
export function habitableZoneAU(luminositySun) {
  if (!(luminositySun > 0)) return null
  return [Math.sqrt(luminositySun / 1.1), Math.sqrt(luminositySun / 0.53)]
}

/** A star's `star` section as a preset makes it, ready to patch onto a body. */
export function starFields(preset) {
  return {
    spectral: preset.id,
    temperatureK: preset.temperatureK,
    luminositySun: preset.luminositySun,
    ...(preset.variable ? { variable: { ...preset.variable } } : {}),
    ...(preset.spinSeconds ? { spinSeconds: preset.spinSeconds } : {}),
  }
}

/** How a star body looks: its preset's look, unless it says otherwise. */
export const starLook = (body) => body?.star?.look || starPreset(body?.star?.spectral).look

/**
 * How bright and big a variable star is on `day`, as factors of its usual
 * brightness and radius: a Cepheid's steep rise and slow fall.
 */
export function variableAt(star, day) {
  const variable = star?.variable
  if (!variable || !(variable.periodDays > 0)) return { brightness: 1, radius: 1 }
  const phase = ((((day / variable.periodDays) % 1) + 1) % 1)
  // A sawtooth softened at the turn: up in the first fifth, down in the rest.
  const wave = phase < 0.2 ? phase / 0.2 : 1 - (phase - 0.2) / 0.8
  const amplitude = Math.min(0.9, Math.max(0, variable.amplitude ?? 0.3))
  const swing = (wave - 0.5) * 2 * amplitude
  return { brightness: 1 + swing, radius: 1 + swing * 0.15 }
}

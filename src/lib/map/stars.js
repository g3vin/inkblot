/**
 * stars.js — what a star is like, from what kind it is.
 *
 * Presets for the spectral classes a writer is likely to want, the colour a star of
 * a given temperature appears, how bright a main-sequence star of a given mass is,
 * and where liquid water is possible around it. Approximations good to a story's
 * standard, not an astronomer's; every figure is overridable in the system builder.
 */

/** Temperature K, mass M☉, radius R☉, luminosity L☉. */
export const STAR_PRESETS = [
  { id: 'O5V', name: 'Blue giant (O)', temperatureK: 41000, massSun: 40, radiusSun: 12, luminositySun: 300000 },
  { id: 'B5V', name: 'Blue-white (B)', temperatureK: 15700, massSun: 5.9, radiusSun: 3.9, luminositySun: 830 },
  { id: 'A0V', name: 'White (A)', temperatureK: 9700, massSun: 2.4, radiusSun: 1.8, luminositySun: 25 },
  { id: 'F5V', name: 'Yellow-white (F)', temperatureK: 6550, massSun: 1.3, radiusSun: 1.4, luminositySun: 3.2 },
  { id: 'G2V', name: 'Yellow, like the Sun (G)', temperatureK: 5772, massSun: 1, radiusSun: 1, luminositySun: 1 },
  { id: 'K5V', name: 'Orange dwarf (K)', temperatureK: 4400, massSun: 0.7, radiusSun: 0.7, luminositySun: 0.16 },
  { id: 'M2V', name: 'Red dwarf (M)', temperatureK: 3500, massSun: 0.44, radiusSun: 0.42, luminositySun: 0.025 },
  { id: 'M5V', name: 'Dim red dwarf (late M)', temperatureK: 3050, massSun: 0.16, radiusSun: 0.2, luminositySun: 0.0017 },
  { id: 'K3III', name: 'Red giant', temperatureK: 4300, massSun: 1.2, radiusSun: 25, luminositySun: 200 },
  { id: 'B8Ia', name: 'Blue supergiant', temperatureK: 12100, massSun: 21, radiusSun: 79, luminositySun: 120000 },
  { id: 'DA', name: 'White dwarf', temperatureK: 25000, massSun: 0.6, radiusSun: 0.012, luminositySun: 0.03 },
  { id: 'T', name: 'Brown dwarf', temperatureK: 1200, massSun: 0.05, radiusSun: 0.1, luminositySun: 0.00002 },
  { id: 'BH', name: 'Black hole', temperatureK: 0, massSun: 10, radiusSun: 0.0000425, luminositySun: 0 },
]

export const KM_PER_SOLAR_RADIUS = 695700

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

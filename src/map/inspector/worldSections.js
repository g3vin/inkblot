/**
 * worldSections.js — a planet map's own settings in the Map tab: what the world
 * looks like (generated, a picture, a giant's bands, ice, or a star), how big it
 * is, how long its day and year are and how far it leans, and whether the story's
 * sunlight falls on it.
 *
 * A generated world can be rolled again (a new seed) without losing what was
 * drawn on it; regions the writer draws grow into land when "Land from regions"
 * is on (planetTexture.js).
 */
import { GAS_PALETTES, PLANET_PALETTES } from '../../lib/map/planetTexture'
import { newSeed } from '../../lib/map/seeded'
import { STAR_GROUPS, STAR_PRESETS, starPreset } from '../../lib/map/stars'

const LOOK_KINDS = [
  { value: 'generated', label: 'Rocky, generated' },
  { value: 'gas', label: 'Giant, banded' },
  { value: 'ice', label: 'Ice' },
  { value: 'texture', label: 'A picture' },
  { value: 'star', label: 'A star' },
]

const SUN_RADIUS_KM = 695700

export function worldSections(ui, { map, dispatch, onChoosePicture }) {
  const { surface } = map
  const look = surface.look
  const patchSurface = (patch) => dispatch({ type: 'section/patch', section: 'surface', patch })
  const patchLook = (patch) => patchSurface({ look: { ...look, ...patch } })
  const fields = [
    ui.choice('world.kind', 'Looks', look.kind, LOOK_KINDS, (kind) => {
      if (kind === look.kind) return
      const palette = kind === 'gas' ? 'jovian' : kind === 'generated' ? 'temperate' : look.palette
      patchLook({ kind, palette })
    }),
  ]

  if (look.kind === 'generated') {
    fields.push(
      ui.choice('world.palette', 'Palette', look.palette, Object.entries(PLANET_PALETTES).map(([value, palette]) => ({ value, label: palette.label })), (palette) => patchLook({ palette })),
      ui.number('world.sea', 'Sea level', Math.round(look.seaLevel * 100), (percent) => patchLook({ seaLevel: percent / 100 }), { min: 0, max: 100, step: 5, suffix: '%', help: 'How much of the world is under water.' }),
      ui.number('world.rough', 'Ruggedness', Math.round(look.roughness * 100), (percent) => patchLook({ roughness: percent / 100 }), { min: 0, max: 100, step: 5, suffix: '%' }),
      ui.toggle('world.fromRegions', 'Land from regions', surface.terrainFromRegions, (terrainFromRegions) => patchSurface({ terrainFromRegions })),
    )
  } else if (look.kind === 'gas') {
    fields.push(
      ui.choice('world.palette', 'Palette', GAS_PALETTES[look.palette] ? look.palette : 'jovian', Object.entries(GAS_PALETTES).map(([value, palette]) => ({ value, label: palette.label })), (palette) => patchLook({ palette })),
      ui.number('world.rough', 'Storminess', Math.round(look.roughness * 100), (percent) => patchLook({ roughness: percent / 100 }), { min: 0, max: 100, step: 5, suffix: '%' }),
    )
  } else if (look.kind === 'texture') {
    fields.push(
      ui.note(look.texture ? 'Wrapped in a picture: longitude left to right, north at the top.' : 'Choose a picture of the whole world, twice as wide as it is tall.'),
      ui.buttonField('world.picture', look.texture ? 'Choose another picture…' : 'Choose a picture…', onChoosePicture),
    )
  } else if (look.kind === 'star') {
    const setStar = (id) => {
      const preset = starPreset(id)
      patchSurface({ radiusKm: preset.radiusSun * SUN_RADIUS_KM, look: { ...look, spectral: preset.id, temperatureK: preset.temperatureK } })
    }
    fields.push(
      ui.choice('world.star', 'Kind of star', look.spectral || 'G2V', STAR_PRESETS.map((preset) => ({ value: preset.id, label: preset.name, group: STAR_GROUPS.find(([id]) => id === preset.group)?.[1] })), setStar),
      ui.number('world.temperature', 'Temperature', look.temperatureK, (temperatureK) => patchLook({ temperatureK }), { min: 500, step: 100, suffix: 'K' }),
    )
  }

  if (look.kind === 'generated' || look.kind === 'gas' || look.kind === 'ice') {
    fields.push(ui.buttons([ui.button('world.reroll', 'Roll again', () => patchLook({ seed: newSeed() }))]))
    fields.push(ui.note('Rolling again draws a different world of the same kind. What you drew on it stays.'))
  }

  const body = [
    ui.number('world.radius', 'Radius', Math.round(surface.radiusKm), (radiusKm) => patchSurface({ radiusKm }), { min: 1, step: 100, suffix: 'km', help: 'Distances and areas on this map are measured on a sphere this size.' }),
    ui.number('world.day', 'Day', surface.dayHours, (dayHours) => patchSurface({ dayHours }), { min: 0.01, step: 1, suffix: 'hours' }),
    ui.number('world.year', 'Year', surface.yearDays ?? 365.25, (yearDays) => patchSurface({ yearDays }), { min: 0.01, step: 1, suffix: 'days' }),
    ui.number('world.tilt', 'Axial tilt', surface.axialTiltDeg, (axialTiltDeg) => patchSurface({ axialTiltDeg }), { min: 0, max: 180, step: 0.5, suffix: '°', help: 'Leaning more makes stronger seasons.' }),
  ]
  if (look.kind !== 'star') {
    body.push(
      ui.toggle('world.daylight', 'Sunlight follows the story', surface.daylight !== false, (daylight) => patchSurface({ daylight })),
      look.kind !== 'texture' ? ui.toggle('world.atmosphere', 'Atmosphere', surface.atmosphere, (atmosphere) => patchSurface({ atmosphere })) : null,
    )
  }
  body.push(ui.toggle('world.grid', 'Latitude and longitude', Boolean(surface.graticule), (graticule) => patchSurface({ graticule })))

  return [
    ui.section('world', look.kind === 'star' ? 'Star' : 'World', fields),
    ui.section('world.body', 'Size and seasons', body),
  ]
}

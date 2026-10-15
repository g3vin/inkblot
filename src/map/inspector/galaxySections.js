/**
 * galaxySections.js — a galaxy map's and a group of galaxies' own settings.
 *
 * A galaxy: its type, Roll again (a new seed — the same type, another galaxy), its
 * size, and its shape: the arms, their pitch, the bulge, the bar, the dust. A shape
 * value the writer sets is kept through a reroll (`params`); "Let it vary" hands
 * it back to the seed.
 *
 * A group of galaxies: how big a region it is, and "Fill with galaxies", which adds
 * galaxies along a cosmic web (universeGen.js).
 */
import { GALAXY_TYPES } from '../../lib/map/mapModel'
import { GALAXY_TYPE_NAMES, galaxyShape } from '../../lib/map/galaxyGen'
import { newSeed } from '../../lib/map/seeded'
import { fillUniverse } from '../../lib/map/universeGen'

const round = (value, places = 2) => Math.round(value * 10 ** places) / 10 ** places

export function galaxySections(ui, { map, dispatch, addPins }) {
  if (map.mapKind === 'universe') return universeSections(ui, { map, dispatch, addPins })
  const { galaxy } = map
  const patchGalaxy = (patch) => dispatch({ type: 'section/patch', section: 'galaxy', patch })
  const shape = galaxyShape(galaxy)
  const params = galaxy.params || {}
  const setParam = (key, value) => patchGalaxy({ params: { ...params, [key]: value } })
  const spiral = /^S(B)?[abcd]$/.test(galaxy.type) || galaxy.type === 'peculiar'
  const fixed = Object.keys(params).filter((key) => Number.isFinite(params[key]))

  const shapeFields = []
  if (spiral) {
    shapeFields.push(
      ui.number('galaxy.arms', 'Arms', Math.round(shape.arms), (arms) => setParam('arms', arms), { min: 1, max: 8, step: 1 }),
      ui.number('galaxy.pitch', 'Arm pitch', round(shape.pitchDeg, 1), (pitchDeg) => setParam('pitchDeg', pitchDeg), { min: 4, max: 40, step: 1, suffix: '°', help: 'Small is tightly wound; large is open.' }),
      ui.number('galaxy.width', 'Arm width', Math.round(shape.armWidth * 100), (percent) => setParam('armWidth', percent / 100), { min: 5, max: 60, step: 1, suffix: '%' }),
      ui.number('galaxy.bulge', 'Bulge', Math.round(shape.bulge * 100), (percent) => setParam('bulge', percent / 100), { min: 0, max: 60, step: 1, suffix: '%' }),
    )
    if (shape.barred) {
      shapeFields.push(
        ui.number('galaxy.bar', 'Bar length', Math.round(shape.barLength * 100), (percent) => setParam('barLength', percent / 100), { min: 5, max: 60, step: 1, suffix: '%' }),
        ui.toggle('galaxy.innerRing', 'Inner ring', Boolean(shape.innerRing), (on) => setParam('innerRing', on ? 1 : 0)),
      )
    }
    shapeFields.push(ui.number('galaxy.knots', 'Star-forming knots', Math.round(shape.knots * 100), (percent) => setParam('knots', percent / 100), { min: 0, max: 200, step: 5, suffix: '%' }))
  } else if (galaxy.type === 'irregular') {
    shapeFields.push(ui.number('galaxy.clumps', 'Clumps', Math.round(shape.clumps), (clumps) => setParam('clumps', clumps), { min: 1, max: 16, step: 1 }))
  } else if (galaxy.type === 'S0' || galaxy.type === 'ring') {
    shapeFields.push(ui.number('galaxy.bulge', 'Core', Math.round(shape.bulge * 100), (percent) => setParam('bulge', percent / 100), { min: 5, max: 80, step: 1, suffix: '%' }))
  }
  if (shape.dust > 0 || spiral) {
    shapeFields.push(ui.number('galaxy.dust', 'Dust', Math.round(shape.dust * 100), (percent) => setParam('dust', percent / 100), { min: 0, max: 100, step: 5, suffix: '%' }))
  }
  shapeFields.push(ui.number('galaxy.warp', 'Warp', Math.round(shape.warp * 100), (percent) => setParam('warp', percent / 100), { min: 0, max: 30, step: 1, suffix: '%' }))
  if (fixed.length) {
    shapeFields.push(ui.note('Shapes you set stay put when you roll again.'))
    shapeFields.push(ui.buttonField('galaxy.vary', 'Let the shape vary again', () => patchGalaxy({ params: {} })))
  }

  return [
    ui.section('galaxy', 'Galaxy', [
      ui.choice('galaxy.type', 'Type', galaxy.type, GALAXY_TYPES.map((type) => ({ value: type, label: GALAXY_TYPE_NAMES[type] })), (type) => patchGalaxy({ type, params: {} })),
      ui.buttons([ui.button('galaxy.reroll', 'Roll again', () => patchGalaxy({ seed: newSeed() }))]),
      ui.note('Rolling again draws another galaxy of the same type. Places on it stay where they are.'),
      ui.number('galaxy.radius', 'Radius', galaxy.radiusLy, (radiusLy) => patchGalaxy({ radiusLy }), { min: 500, step: 1000, suffix: 'ly' }),
      ui.number('galaxy.thickness', 'Thickness', galaxy.thicknessLy, (thicknessLy) => patchGalaxy({ thicknessLy }), { min: 10, step: 100, suffix: 'ly' }),
      ui.group('galaxy.shape', 'Shape', shapeFields, { collapsible: true }),
    ]),
  ]
}

function universeSections(ui, { map, dispatch, addPins }) {
  const { universe } = map
  const patchUniverse = (patch) => dispatch({ type: 'section/patch', section: 'universe', patch })
  const generated = map.pins.filter((pin) => pin.galaxy).length
  const fill = (count) => {
    const seed = newSeed()
    addPins(fillUniverse({ seed, count, extentMpc: universe.extentMpc, idFor: (index) => `g${seed}-${index}` }))
  }
  return [
    ui.section('universe', 'Group of galaxies', [
      ui.number('universe.extent', 'Across', universe.extentMpc, (extentMpc) => patchUniverse({ extentMpc }), { min: 0.1, step: 1, suffix: 'Mpc', help: 'A megaparsec is about 3.26 million light-years.' }),
      ui.stat('Galaxies', String(map.pins.length)),
      ui.buttons([
        ui.button('universe.fill', 'Fill with galaxies', () => fill(120)),
        ui.button('universe.fewer', 'Add a dozen', () => fill(12)),
      ]),
      ui.note(generated
        ? 'Each galaxy is drawn from its type and seed. Select one to open it as a galaxy of its own.'
        : 'Galaxies are placed along filaments and gathered in clusters, as in the real sky.'),
    ]),
  ]
}

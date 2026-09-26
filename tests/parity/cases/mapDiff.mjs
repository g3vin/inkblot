/**
 * mapDiff.js against `inkblot_core::map::diff`.
 *
 * Pairs of maps built from the map-model corpus's FULL map by one edit at a time —
 * each kind of change the diff names, in each collection it can happen in — plus the
 * degenerate inputs (no map, the wrong type, a section missing on one side). Every
 * pair is merged under several decision sets, including "keep the left side of
 * everything", which must reproduce the left map's content.
 */
import {
  diffMaps, mapDiffIsEmpty, describeMapDiff, mergeMaps, mapChangeKey,
} from '../../../src/lib/map/mapDiff.js'
import { normalizeMap, summarizeMapChange } from '../../../src/lib/map/mapModel.js'
import { FULL } from './mapModel.mjs'

const json = (value) => (value === undefined ? null : JSON.parse(JSON.stringify(value)))

const counter = () => {
  let next = 0
  return () => `gen${next++}`
}

/** A copy of `map` with `edit` applied to it. */
const edited = (map, edit) => {
  const copy = json(map)
  edit(copy)
  return copy
}

function* variants(base) {
  yield base
  yield edited(base, (m) => { m.viewport = { x: 999, y: -1, zoom: 4 } })
  yield edited(base, (m) => { m.pins[0].at = [1, 1] })
  yield edited(base, (m) => { m.pins[0].name = 'New Harbour' })
  yield edited(base, (m) => { m.pins[0].at = [2, 2]; m.pins[0].color = '#000' })
  yield edited(base, (m) => { m.pins.push({ id: 'inn', name: 'The Inn', at: [7, 7] }) })
  yield edited(base, (m) => { m.pins.splice(1, 1) })
  yield edited(base, (m) => { m.pins.reverse() })
  yield edited(base, (m) => { m.routes[0].nodes = m.routes[0].nodes.slice(0, 2) })
  yield edited(base, (m) => { m.routes = [] })
  yield edited(base, (m) => { m.regions[0].hatch = 'waves' })
  yield edited(base, (m) => { m.labels[0].text = 'The Sundering Sea'; m.labels[1].startOffset = 0.9 })
  yield edited(base, (m) => { m.labels.shift() })
  yield edited(base, (m) => { m.travelers[0].legs = [] })
  yield edited(base, (m) => { m.system.bodies[1].orbit = { aAU: 2 } })
  yield edited(base, (m) => { m.system.bodies.splice(0, 1) })
  yield edited(base, (m) => { m.system.display = { radial: 'linear' } })
  yield edited(base, (m) => { delete m.system })
  yield edited(base, (m) => { m.system = 7 })
  yield edited(base, (m) => { m.terrains[0].multipliers = {} })
  yield edited(base, (m) => { m.transports.push({ id: 'ship', kmh: 12, medium: 'water' }) })
  yield edited(base, (m) => { m.style.theme = 'night'; m.timeline = { day: 40 } })
  yield edited(base, (m) => { m.mapKind = 'earth'; delete m.earth })
  yield edited(base, (m) => { m.pins = 'none'; m.labels = null })
}

const DEGENERATE = [null, [], 'map', {}, { type: 'map' }, { pins: [{ id: 'a', at: [0, 0] }] }]

/** No decisions; everything flipped to the left; every other change flipped. */
function decisionSets(diff) {
  const keys = [
    ...diff.added.map((change) => mapChangeKey('added', change)),
    ...diff.removed.map((change) => mapChangeKey('removed', change)),
    ...diff.edited.map((change) => mapChangeKey('edited', change)),
    ...diff.moved.map((change) => mapChangeKey('moved', change)),
    ...diff.settings.map((change) => mapChangeKey('setting', change)),
  ]
  const all = Object.fromEntries(keys.map((key) => [key, 'left']))
  const some = Object.fromEntries(keys.filter((_, index) => index % 2 === 0).map((key) => [key, 'left']))
  const rightOnly = Object.fromEntries(keys.map((key) => [key, 'right']))
  return [{}, all, some, rightOnly]
}

function* pairs() {
  for (const base of [json(FULL), normalizeMap(json(FULL), counter())]) {
    const all = [...variants(base)]
    for (const other of all) {
      yield [base, other]
      yield [other, base]
    }
  }
  for (const left of DEGENERATE) {
    for (const right of DEGENERATE) yield [json(left), json(right)]
    yield [json(left), json(FULL)]
    yield [json(FULL), json(left)]
  }
}

export default {
  name: 'mapDiff',
  *cases() {
    for (const [left, right] of pairs()) {
      const diff = diffMaps(left, right)
      yield { fn: 'diffMaps', args: [left, right], expected: diff }
      yield { fn: 'mapDiffIsEmpty', args: [left, right], expected: mapDiffIsEmpty(diff) }
      yield { fn: 'describeMapDiff', args: [left, right], expected: describeMapDiff(diff) }
      yield { fn: 'summarizeMapChange', args: [left, right], expected: summarizeMapChange(left, right) }
      for (const decisions of decisionSets(diff)) {
        yield { fn: 'mergeMaps', args: [left, right, decisions], expected: mergeMaps(left, right, diff, decisions) }
      }
    }
    for (const map of [null, json(FULL), { pins: [] }, { routes: 'x' }]) {
      yield { fn: 'summarizeMapChange', args: [null, map], expected: summarizeMapChange(null, map) }
    }
  },
}

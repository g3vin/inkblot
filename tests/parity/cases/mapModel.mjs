/**
 * mapModel.js (and mapSearch.js) against `inkblot_core::map::model` and
 * `inkblot_core::search::collect_map_matches`.
 *
 * Like the canvas corpus, this is mostly files that should not exist — every
 * modeled key holding the wrong JSON type, references to items that are gone,
 * duplicate and missing ids — because `normalizeMap` is what stands between such a
 * file and a crashed pane, and what it keeps is what gets written back out.
 *
 * **Generated ids.** Both sides are handed the same counter (`gen0`, `gen1`, …), so
 * a match also proves the two draw ids in the same order — which is what keeps an
 * id stable when the same file is normalized by the page and by the core.
 */
import {
  normalizeMap, createEmptyMap, isMapPayload, readMapViewport, countMapWords, mapDocRefs, MAP_KINDS,
} from '../../../src/lib/map/mapModel.js'
import { collectMapMatches } from '../../../src/lib/map/mapSearch.js'
import { createMatcher } from '../../../src/lib/sidebarSearch.js'

const counter = () => {
  let next = 0
  return () => `gen${next++}`
}

const WRONG = [null, 7, -3, 0, 'text', '', true, [], [1], {}, { nested: 1 }]

/** Every section of a map, each given every wrong type in turn. */
function* wrongTypedMaps() {
  const sections = [
    'mapKind', 'scale', 'background', 'earth', 'system', 'pins', 'routes', 'regions', 'terrains',
    'labels', 'transports', 'travelers', 'timeline', 'style', 'viewport',
  ]
  for (const section of sections) {
    for (const value of WRONG) yield { [section]: value }
  }
}

const FULL = {
  type: 'map',
  formatVersion: 1,
  mapKind: 'image',
  futureTopLevel: { keep: ['me'] },
  scale: {
    kmPerUnit: 0.8,
    displayUnit: 'mi',
    calibration: { a: [0, 0], b: [100, 0], distance: 50, unit: 'mi', note: 'from the atlas' },
    customUnits: [{ id: 'league', km: 4.828 }, { id: '', km: 1 }, { id: 'bad', km: -1 }, 'x', { id: 'day', name: 'Day’s ride', km: 60 }],
  },
  background: { image: '.assets/abc.png', width: 4096, height: 3072, opacity: 1.5, trace: null, showImage: 'yes' },
  earth: { projection: 'orthographic', rotate: [10, -20, 5], graticule: false },
  system: {
    bodies: [
      { id: 'sun', name: 'Sol', kind: 'star', massSun: 1, radiusKm: 696000 },
      { id: 'earth', name: 'Earth', parent: 'sun', orbit: { aAU: 1, e: 0.0167, periapsisDeg: 102.9 } },
      { id: 'moon', kind: 'moon', parent: 'earth', orbit: { aAU: 0.00257, e: 1.4 } },
      { id: 'lost', parent: 'nowhere', orbit: { aAU: -1 } },
      { id: 'self', parent: 'self', orbit: 'circular' },
      { name: 'unnamed id' },
      { id: 'sun', name: 'duplicate' },
    ],
    display: { radial: 'spiral', pxPerAU: 250 },
  },
  pins: [
    { id: 'harbour', name: 'Old Harbour', at: [120.5, 88], doc: 'Settings/Harbour', glow: true },
    { id: 'fort', at: [300, 40], icon: 'castle', color: '#aa3300' },
    { id: 'nowhere', name: 'Nowhere' },
    { id: 'moonbase', body: 'moon' },
    { id: 'emptybody', body: '' },
    { at: [1, 2, 3] },
    { id: 'fort', at: [0, 0], name: 'second fort' },
    { id: 'badpoint', at: ['1', 2] },
    'not a pin',
  ],
  routes: [
    {
      id: 'coast', name: 'The Coast Road', smooth: 'catmullRom',
      nodes: [{ pin: 'harbour', at: [9, 9] }, { at: [200, 60], pin: 'gone' }, { pin: 'fort' }, 'x', { at: [1] }],
      style: { stroke: '#335', width: 0, dash: 'inked', arrow: 1, flourish: 'yes' },
    },
    { id: 'stub', nodes: [{ pin: 'harbour' }] },
    { id: 'free', nodes: [{ at: [0, 0] }, { at: [5, 5] }], smooth: 'bezier' },
  ],
  regions: [
    { id: 'woods', name: 'Mirkwood', terrain: 'forest', hatch: 'dots', rings: [[[0, 0], [10, 0], [10, 10], [0, 10]], [[2, 2], [3, 2]]] },
    { id: 'thin', rings: [[[0, 0], [1, 1]]] },
    { rings: 'none' },
  ],
  terrains: [
    { id: 'forest', multipliers: { walk: 0.7, horse: 0.5, '*land': 0.6, cart: -1, boat: 'no', air: 0 } },
    { id: 'road', name: 'Road', multipliers: 'fast' },
  ],
  labels: [
    { id: 'sea', text: 'The Grey Sea', at: [50, 50], size: 0, startOffset: 3, maxZoom: -1 },
    { id: 'along', text: 'Coast Road', route: 'coast', startOffset: 0.25 },
    { id: 'alongGone', text: 'nowhere', route: 'stub' },
    { id: 'path', text: 'River', path: [[0, 0], [1, 1], ['x', 2], [3, 3]] },
    { id: 'nothing', text: 'lost' },
  ],
  transports: [
    { id: 'wyvern', name: 'Wyvern', kmh: 60, hoursPerDay: 30, medium: 'air' },
    { id: 'torch', kmh: 1, medium: 'space', fractionC: 0.5 },
    { id: 'bad', kmh: -5, hoursPerDay: 0, medium: 'teleport', fractionC: 1 },
  ],
  travelers: [
    {
      id: 'anna', doc: 'Characters/Anna', color: '#c33', startPin: 'harbour', startDay: 3,
      legs: [
        { id: 'l1', from: 'harbour', to: 'fort', route: 'coast', transport: 'horse', departDay: 4, restDays: 1 },
        { from: 'fort', to: 'gone', route: 'stub', restDays: -2, departDay: 'soon' },
        { id: 'l1', from: 'fort', to: 'harbour' },
      ],
    },
    { name: 'Nameless Walker', startPin: 'missing', legs: 'none' },
  ],
  timeline: { day: 12.5, playing: true },
  style: {
    theme: 'parchment',
    compass: { show: false, at: [0.5], size: -4, flourish: 2 },
    scaleBar: { show: 'no' },
    cartouche: { show: true, title: 'The Western Reach', subtitle: 42 },
    mood: 'stormy',
  },
  viewport: { x: -40.25, y: 12, zoom: 0 },
}

const RAW_MAPS = [
  null,
  undefined,
  7,
  'map',
  [],
  {},
  { type: 'map' },
  ...MAP_KINDS.map((mapKind) => ({ mapKind })),
  { mapKind: 'moon' },
  FULL,
  ...wrongTypedMaps(),
]

const QUERIES = ['harbour', 'road', 'e', 'Settings', 'zzz', '', 'coast road']
const OPTIONS = [
  { matchCase: false, wholeWord: false, useRegex: false },
  { matchCase: true, wholeWord: true, useRegex: false },
  { matchCase: false, wholeWord: false, useRegex: true },
]

/** Plain JSON only — maps come off disk, so nothing here needs encode(). */
const json = (value) => (value === undefined ? null : JSON.parse(JSON.stringify(value)))

export default {
  name: 'mapModel',
  *cases() {
    for (const raw of RAW_MAPS) {
      const arg = json(raw)
      yield { fn: 'normalizeMap', args: [arg], expected: normalizeMap(arg, counter()) }
      yield { fn: 'isMapPayload', args: [arg], expected: isMapPayload(arg) }
      yield { fn: 'readMapViewport', args: [arg], expected: readMapViewport(arg) }
      yield { fn: 'countMapWords', args: [arg], expected: countMapWords(arg) }
      yield { fn: 'mapDocRefs', args: [arg], expected: mapDocRefs(arg) }
    }

    for (const kind of [...MAP_KINDS, 'moon', '']) {
      yield { fn: 'createEmptyMap', args: [kind], expected: createEmptyMap(kind) }
    }

    const normalized = normalizeMap(FULL, counter())
    for (const raw of [FULL, normalized]) {
      for (const query of QUERIES) {
        for (const options of OPTIONS) {
          for (const limit of [24, 2]) {
            yield {
              fn: 'collectMapMatches',
              args: [json(raw), query, options, 'World.map', limit],
              expected: collectMapMatches(json(raw), createMatcher(query, options), 'World.map', { limit }),
            }
          }
        }
      }
    }
  },
}

/**
 * maplib — the map document's pure libraries: the model, geometry, spaces, the Earth,
 * travel, the calendar, the timeline and orbits.
 *
 * Every assertion here is a fact a writer would notice if it were false: a pin that
 * loses its link on rename, a forest that does not slow a horse, a character who
 * arrives before they leave, London–New York the wrong length, a year that does not
 * bring the Earth back round.
 */
import {
  normalizeMap, createEmptyMap, serializeMap, isMapPayload, rewriteMapDocRefs, countMapWords,
  summarizeMapChange, mapDocRefs,
} from '../../src/lib/map/mapModel.js'
import { diffMaps, mapDiffIsEmpty, mergeMaps, mapChangeKey, mapItemTitle } from '../../src/lib/map/mapDiff.js'
import {
  cumulativeLengths, pointAtDistance, catmullRomSample, ringArea, regionArea, pointInRegion,
  segmentRingCrossings, nearestOnPolyline, simplifyDP, chaikin, polylineLength,
} from '../../src/lib/map/mapGeometry.js'
import { createSpace, measuredLine, pointAtKm, calibrationKmPerUnit, routeCoords } from '../../src/lib/map/mapSpace.js'
import { haversineKm, densifyGreatCircle, interpolateGreatCircle, initialBearing } from '../../src/lib/map/geodesy.js'
import { toKm, fromKm, formatDistance, formatDuration } from '../../src/lib/map/mapUnits.js'
import { resolveTransport, lorentzGamma, properTimeDays, effectiveKmh } from '../../src/lib/map/transports.js'
import { travelProfile, legTravel, kmAfter, distanceMatrix, terrainAt } from '../../src/lib/map/travel.js'
import { normalizeCalendar, toParts, fromParts, formatDay, daysFromCivil, civilFromDays } from '../../src/lib/map/calendar.js'
import { buildSchedule, travelerPositionAt, mapConflicts, crossScheduleConflicts } from '../../src/lib/map/timeline.js'
import { systemPositionsAt, solveKepler, periodDays, orbitPeriod, interceptDays, bodyMass } from '../../src/lib/map/orbits.js'
import { massToLuminosity, temperatureToColor, habitableZoneAU } from '../../src/lib/map/stars.js'
import { zoomMapAt, screenToWorld, worldToScreen, fitMapBounds, clampMapZoom } from '../../src/lib/map/mapViewport.js'
import { createProjector, systemToWorld, worldToSystem } from '../../src/lib/map/mapProjection.js'

const ok = (label, condition) => {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`)
  if (!condition) process.exitCode = 1
}
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps
const within = (a, b, fraction) => Math.abs(a - b) <= Math.abs(b) * fraction

/* ---------------- model ---------------- */

{
  const map = normalizeMap({
    mapKind: 'image',
    futureKey: 1,
    pins: [{ id: 'a', at: [0, 0], doc: 'Settings/Port', aura: 'gold' }, { id: 'b', at: [10, 0] }],
    routes: [{ id: 'r', nodes: [{ pin: 'a' }, { pin: 'b' }] }],
    travelers: [{ id: 't', doc: 'Characters/Anna', legs: [{ id: 'l', from: 'a', to: 'b' }] }],
  })
  ok('unknown keys survive normalize at the top and on items', map.futureKey === 1 && map.pins[0].aura === 'gold')
  const round = normalizeMap(JSON.parse(JSON.stringify(serializeMap(map, { x: 5, y: 6, zoom: 2 }))))
  ok('serialize → normalize round-trips, viewport included', round.pins.length === 2 && round.viewport.zoom === 2 && round.futureKey === 1)

  const renamed = rewriteMapDocRefs(map, 'Settings/Port', 'Settings/Harbour', 'file')
  ok('renaming a linked doc rewrites the pin', renamed.changed && renamed.map.pins[0].doc === 'Settings/Harbour')
  const movedFolder = rewriteMapDocRefs(map, 'Characters', 'People', 'folder')
  ok('moving a folder rewrites travelers under it', movedFolder.map.travelers[0].doc === 'People/Anna')
  const untouched = rewriteMapDocRefs(map, 'Settings/Portly', 'x', 'file')
  ok('an unrelated rename leaves the map object as it was', !untouched.changed && untouched.map === map)
  const deleted = rewriteMapDocRefs(map, 'Settings/Port', null, 'file')
  ok('a delete keeps the link (the pin shows as missing)', !deleted.changed && deleted.map.pins[0].doc === 'Settings/Port')
  ok('doc refs are listed once each', JSON.stringify(mapDocRefs(map)) === JSON.stringify(['Settings/Port', 'Characters/Anna']))

  ok('a text document is not a map payload', !isMapPayload({ content: [], notes: [] }) && isMapPayload(null) && isMapPayload({ type: 'map' }))
  const empty = createEmptyMap('blank', { setupPending: true })
  ok('a new blank map is a sheet and remembers it wants setting up', empty.background.width === 4000 && empty.setupPending === true)
  ok('words are counted from names and labels', countMapWords({ pins: [{ name: 'Old Quay' }], labels: [{ text: 'Grey Sea' }] }) === 4)
  ok('history rows summarise counts', summarizeMapChange(null, map) === 'Snapshot · 2 places, 1 route, 1 traveler')
  ok('history rows summarise changes', summarizeMapChange(map, { ...map, pins: [map.pins[0]], routes: [] }) === '−1 place · −1 route')
}

/* ---------------- history: compare and merge ---------------- */

{
  const older = normalizeMap({
    pins: [
      { id: 'port', name: 'Port', at: [0, 0] },
      { id: 'keep', name: 'Keep', at: [5, 5] },
      { id: 'mill', name: 'Mill', at: [9, 9] },
    ],
    routes: [{ id: 'road', nodes: [{ pin: 'port' }, { pin: 'mill' }] }],
    style: { theme: 'clean' },
  })
  const newer = normalizeMap({
    ...older,
    pins: [
      { ...older.pins[0], at: [3, 3] },
      { ...older.pins[1], name: 'Old Keep' },
      { id: 'inn', name: 'Inn', at: [1, 1] },
    ],
    style: { ...older.style, theme: 'night' },
    viewport: { x: 400, y: 0, zoom: 2 },
  })
  const diff = diffMaps(older, newer)
  ok('a placement change is a move', diff.moved.length === 1 && diff.moved[0].after.id === 'port')
  ok('a rename is an edit', diff.edited.length === 1 && diff.edited[0].after.id === 'keep')
  ok('an added and a removed place are both found',
    diff.added[0]?.item.id === 'inn' && diff.removed[0]?.item.id === 'mill')
  ok('a changed style is a setting, and the viewport is not', diff.settings.map((s) => s.section).join() === 'style')

  const keys = [
    ...diff.added.map((c) => mapChangeKey('added', c)),
    ...diff.removed.map((c) => mapChangeKey('removed', c)),
    ...diff.edited.map((c) => mapChangeKey('edited', c)),
    ...diff.moved.map((c) => mapChangeKey('moved', c)),
    ...diff.settings.map((c) => mapChangeKey('setting', c)),
  ]
  const allLeft = mergeMaps(older, newer, diff, Object.fromEntries(keys.map((key) => [key, 'left'])))
  ok('keeping the left of every change gives back the left map', mapDiffIsEmpty(diffMaps(older, allLeft)))
  ok('the restored place is back where it was in paint order',
    allLeft.pins.map((pin) => pin.id).join() === 'port,keep,mill')
  ok('no decisions leaves the right map', mapDiffIsEmpty(diffMaps(newer, mergeMaps(older, newer, diff, {}))))

  const dropMill = mergeMaps(newer, older, diffMaps(newer, older), { 'added:pins:mill': 'left' })
  ok('a route stop on a dropped place is cleaned up on load',
    normalizeMap(dropMill).routes.length === 0)
  ok('an item is titled by its name, its text, its doc, or its kind',
    mapItemTitle('pins', { name: 'Port' }) === 'Port' &&
    mapItemTitle('labels', { text: 'Grey Sea' }) === 'Grey Sea' &&
    mapItemTitle('pins', { doc: 'Settings/Rivertown' }) === 'Rivertown' &&
    mapItemTitle('routes', {}) === 'Untitled route')
}

/* ---------------- geometry ---------------- */

{
  const line = [[0, 0], [3, 4], [3, 10]]
  ok('cumulative lengths', JSON.stringify(cumulativeLengths(line)) === '[0,5,11]')
  const mid = pointAtDistance(line, 8)
  ok('point at distance lands on the second segment', near(mid.point[0], 3) && near(mid.point[1], 7) && mid.index === 1)
  const smooth = catmullRomSample([[0, 0], [10, 5], [20, 0], [30, 8]], 8)
  const controlsHit = [[0, 0], [10, 5], [20, 0], [30, 8]].every((control) => smooth.some((p) => near(p[0], control[0]) && near(p[1], control[1])))
  ok('a Catmull–Rom curve passes through every control point', controlsHit)
  ok('the curve is longer than the polyline it smooths', polylineLength(smooth) >= polylineLength([[0, 0], [10, 5], [20, 0], [30, 8]]) - 1e-9)
  const square = [[0, 0], [10, 0], [10, 10], [0, 10]]
  const hole = [[4, 4], [6, 4], [6, 6], [4, 6]]
  ok('shoelace area', ringArea(square) === 100)
  ok('a hole is subtracted', regionArea([square, hole]) === 96)
  ok('a point in the hole is outside the region', !pointInRegion([5, 5], [square, hole]) && pointInRegion([2, 2], [square, hole]))
  const cuts = segmentRingCrossings([-5, 5], [15, 5], square)
  ok('a segment through a square crosses it twice, in order', cuts.length === 2 && near(cuts[0], 0.25) && near(cuts[1], 0.75))
  const nearest = nearestOnPolyline(line, [0, 7])
  ok('nearest point on a polyline', near(nearest.point[0], 3) && near(nearest.point[1], 7) && nearest.index === 1)
  const noisy = [[0, 0], [1, 0.01], [2, -0.01], [3, 0], [3, 5]]
  ok('Douglas–Peucker drops points within epsilon', simplifyDP(noisy, 0.1).length === 3)
  ok('Chaikin keeps an open line’s ends', JSON.stringify(chaikin([[0, 0], [10, 0], [10, 10]], 2).at(-1)) === '[10,10]')
}

/* ---------------- units, spaces, calibration ---------------- */

{
  ok('fifty miles is 80.4672 km', near(toKm(50, 'mi'), 80.4672))
  ok('km back to miles', near(fromKm(80.4672, 'mi'), 50))
  ok('a custom unit is honoured', near(toKm(2, 'league', { scale: { customUnits: [{ id: 'league', km: 5 }] } }), 10))
  ok('calibration: 100 px is 50 mi → 0.804672 km/px', near(calibrationKmPerUnit([0, 0], [100, 0], toKm(50, 'mi')), 0.804672))
  const plane = createSpace({ mapKind: 'image', scale: { kmPerUnit: 2 } })
  ok('a plane space scales by km per unit', plane.distanceKm([0, 0], [3, 4]) === 10)
  ok('distances format with units', formatDistance(80.4672, 'mi') === '50 mi')
  ok('durations read like a writer would say them', formatDuration(3.5) === '3 days 12 hours' && formatDuration(0.25) === '6 hours')
}

/* ---------------- the Earth ---------------- */

{
  const london = [-0.1278, 51.5074]
  const newYork = [-74.006, 40.7128]
  const km = haversineKm(london, newYork)
  ok(`London–New York ≈ 5570 km (got ${km.toFixed(0)})`, within(km, 5570, 0.005))
  const dense = densifyGreatCircle(london, newYork, 50)
  const steps = dense.slice(1).map((point, index) => haversineKm(dense[index], point))
  ok('a densified great circle has even steps under the limit', steps.every((step) => step <= 50.0001 && near(step, steps[0], 1e-6)))
  const across = densifyGreatCircle([179, 0], [-179, 0], 50)
  const earth = createSpace({ mapKind: 'earth' })
  ok('a route across the antimeridian is short, not the long way round', within(measuredLine(earth, [[179, 0], [-179, 0]]).totalKm, haversineKm([179, 0], [-179, 0]), 1e-9) && across.length < 10)
  const half = interpolateGreatCircle([0, 0], [90, 0], 0.5)
  ok('halfway along the equator', near(half[0], 45, 1e-9) && near(half[1], 0, 1e-9))
  ok('due east is 90°', near(initialBearing([0, 0], [10, 0]), 90, 1e-9))

  for (const projection of ['equalEarth', 'equirectangular', 'mercator', 'naturalEarth', 'orthographic']) {
    const projector = createProjector({ mapKind: 'earth', earth: { projection, rotate: [0, 0] } })
    const world = projector.toWorld([12.5, 41.9])
    const back = projector.fromWorld(world)
    ok(`${projection}: project → invert round-trips Rome`, back && near(back[0], 12.5, 1e-6) && near(back[1], 41.9, 1e-6))
  }
  const globe = createProjector({ mapKind: 'earth', earth: { projection: 'orthographic', rotate: [0, 0] } })
  ok('the far side of the globe is not drawn', globe.toWorld([180, 0]) === null)
}

/* ---------------- travel ---------------- */

{
  const map = normalizeMap({
    mapKind: 'image',
    scale: { kmPerUnit: 1 },
    pins: [{ id: 'a', at: [0, 50] }, { id: 'b', at: [100, 50] }],
    terrains: [{ id: 'forest', multipliers: { horse: 0.5 } }, { id: 'road', multipliers: { '*land': 2 } }, { id: 'lake', multipliers: { '*land': 0 } }],
    regions: [
      { id: 'woods', terrain: 'forest', rings: [[[25, 0], [75, 0], [75, 100], [25, 100]]] },
    ],
  })
  const space = createSpace(map)
  const horse = resolveTransport(map, 'horse')
  const line = measuredLine(space, [[0, 50], [100, 50]])
  const profile = travelProfile(map, space, line, horse)
  ok('a line through a forest is cut exactly at its edges', profile.pieces.length === 3 && near(profile.pieces[0].toKm, 25) && near(profile.pieces[1].toKm, 75))
  // 50 km at 8 km/h + 50 km at 4 km/h = 6.25 + 12.5 = 18.75 h → at 8 h a day, 2.34 days.
  ok('the forest halves a horse’s speed', near(profile.hours, 18.75) && near(profile.days, 18.75 / 8))
  const walk = travelProfile(map, space, line, resolveTransport(map, 'walk'))
  ok('terrain only slows the transports it names', near(walk.hours, 20))
  ok('the topmost region wins where regions overlap', (() => {
    const layered = { ...map, regions: [...map.regions, { id: 'r2', terrain: 'road', rings: [[[40, 0], [60, 0], [60, 100], [40, 100]]] }] }
    return terrainAt(layered, space, [50, 50])?.id === 'road' && terrainAt(layered, space, [30, 50])?.id === 'forest'
  })())
  const blocked = { ...map, regions: [{ id: 'l', terrain: 'lake', rings: [[[40, 0], [60, 0], [60, 100], [40, 100]]] }] }
  const crossing = travelProfile(blocked, space, line, horse)
  ok('impassable terrain is flagged but still takes finite time', crossing.impassable && Number.isFinite(crossing.days))
  // A quarter of the 18.75 h is 4.6875 h: 3.125 h across the open first 25 km, then
  // 1.5625 h into the forest at 4 km/h — 6.25 km, not the 12.5 an even pace would give.
  ok('a traveller slows in the forest rather than moving at an average pace', near(kmAfter(profile, profile.days / 4), 31.25))
  const custom = normalizeMap({ ...map, transports: [{ id: 'horse', name: 'Warhorse', kmh: 12, hoursPerDay: 10 }] })
  ok('a map’s own transport overrides the built-in', resolveTransport(custom, 'horse').kmh === 12)
  ok('γ at 0.9c is 2.294', near(lorentzGamma(0.9), 2.294157338705618, 1e-12))
  ok('a traveller at 0.9c ages less', near(properTimeDays(10, 0.9), 10 / 2.294157338705618, 1e-12))
  ok('light fractions become km/h', near(effectiveKmh(resolveTransport(map, 'light50')), 0.5 * 1079252848.8))
  const matrix = distanceMatrix(map, space, ['a', 'b'], 'walk')
  ok('the distance matrix is symmetric with a zero diagonal', matrix[0][0].km === 0 && near(matrix[0][1].km, matrix[1][0].km) && near(matrix[0][1].km, 100))
  const leg = legTravel(map, space, { from: 'b', to: 'a', route: null, transport: 'horse' }, 0)
  ok('a leg with no route goes straight', near(leg.line.totalKm, 100))
}

/* ---------------- routes ---------------- */

{
  const map = normalizeMap({
    pins: [{ id: 'a', at: [0, 0] }, { id: 'b', at: [30, 40] }],
    routes: [{ id: 'r', nodes: [{ pin: 'a' }, { at: [0, 40] }, { pin: 'b' }] }],
  })
  const space = createSpace(map)
  ok('a route through a pin follows the pin', JSON.stringify(routeCoords(map, space, map.routes[0])) === '[[0,0],[0,40],[30,40]]')
  const leg = legTravel(map, space, { from: 'b', to: 'a', route: 'r', transport: 'walk' }, 0)
  ok('a route travelled backwards is reversed, not jumped', near(leg.line.totalKm, 70) && JSON.stringify(leg.line.points[0]) === '[30,40]')
  const at = pointAtKm(space, measuredLine(space, [[0, 0], [0, 40], [30, 40]]), 55)
  ok('the point 55 km along', near(at.point[0], 15) && near(at.point[1], 40))
}

/* ---------------- calendar ---------------- */

{
  ok('the Unix epoch is day 0', daysFromCivil(1970, 1, 1) === 0)
  ok('2000-03-01 is day 11017', daysFromCivil(2000, 3, 1) === 11017)
  let roundTrips = true
  for (let z = -100000; z <= 100000; z += 997) {
    const { year, month, day } = civilFromDays(z)
    if (daysFromCivil(year, month, day) !== z) roundTrips = false
  }
  ok('civil dates round-trip over ±10⁵ days', roundTrips)
  const gregorian = normalizeCalendar({ mode: 'gregorian', gregorianEpoch: '1850-03-01' })
  ok('day 0 of an 1850 story is 1 March 1850', formatDay(gregorian, 0) === '1 March 1850')
  ok('and day 365 is 1 March 1851', formatDay(gregorian, 365) === '1 March 1851')
  ok('1 March 1850 was a Friday', toParts(gregorian, 0).weekday === 'Friday')
  ok('a time of day is shown when asked', formatDay(gregorian, 0.5, { withTime: true }) === '1 March 1850, 12:00')
  const custom = normalizeCalendar({
    mode: 'custom',
    custom: { months: [{ name: 'Ice', days: 10 }, { name: 'Sun', days: 20 }], yearZero: 100, era: 'AR', leap: { every: 4, days: 1, month: 1 } },
  })
  let customRoundTrips = true
  for (let day = -3000; day <= 3000; day += 7) {
    if (fromParts(custom, toParts(custom, day)) !== day) customRoundTrips = false
  }
  ok('a custom calendar with leap days round-trips', customRoundTrips)
  ok('a custom calendar writes its own dates', formatDay(custom, 0) === '1 Ice, Year 100 AR')
  ok('year 0 of a 4-year leap cycle has the leap day', formatDay(custom, 10) === '11 Ice, Year 100 AR' && formatDay(custom, 11) === '1 Sun, Year 100 AR')
  ok('day mode counts from Day 1', formatDay(normalizeCalendar(null), 0) === 'Day 1')
}

/* ---------------- timeline ---------------- */

{
  const map = normalizeMap({
    scale: { kmPerUnit: 1 },
    pins: [{ id: 'a', at: [0, 0], doc: 'Settings/A' }, { id: 'b', at: [40, 0], doc: 'Settings/B' }, { id: 'c', at: [80, 0] }],
    travelers: [
      {
        id: 'anna', doc: 'Characters/Anna', startPin: 'a', startDay: 2,
        legs: [
          { id: 'l1', from: 'a', to: 'b', transport: 'walk' },
          { id: 'l2', from: 'b', to: 'c', transport: 'walk', restDays: 1 },
        ],
      },
    ],
  })
  const space = createSpace(map)
  const schedule = buildSchedule(map, space, map.travelers[0])
  // 40 km at 5 km/h, 8 h a day = 1 day per leg.
  ok('arrival is departure plus travel time', near(schedule.intervals[0].to, 3))
  ok('rest days sit between legs', near(schedule.intervals[1].from, 3) && near(schedule.intervals[1].to, 4) && schedule.intervals[1].kind === 'stay')
  ok('the traveller stays where they end up', schedule.intervals.at(-1).to === Infinity && schedule.intervals.at(-1).pin === 'c')
  ok('before the start, nowhere', travelerPositionAt(map, space, schedule, 1) === null)
  const halfway = travelerPositionAt(map, space, schedule, 2.5)
  ok('halfway through a leg, halfway along it', near(halfway.point[0], 20) && near(halfway.point[1], 0))
  ok('resting at the second place', JSON.stringify(travelerPositionAt(map, space, schedule, 3.5).point) === '[40,0]')
  ok('no conflicts in a sound itinerary', mapConflicts(map, space).length === 0)

  const broken = normalizeMap({
    ...map,
    travelers: [{
      id: 'anna', doc: 'Characters/Anna', startPin: 'a', startDay: 2,
      legs: [
        { id: 'l1', from: 'a', to: 'b', transport: 'walk' },
        { id: 'l2', from: 'c', to: 'a', transport: 'walk', departDay: 2.5 },
      ],
    }],
  })
  const kinds = mapConflicts(broken, space).map((conflict) => conflict.kind).sort()
  ok('an early departure and a teleport are both caught', JSON.stringify(kinds) === '["discontinuity","overlap"]')

  const twice = normalizeMap({
    ...map,
    travelers: [
      { id: 't1', doc: 'Characters/Anna', startPin: 'a', startDay: 0, legs: [] },
      { id: 't2', doc: 'Characters/Anna', startPin: 'c', startDay: 5, legs: [] },
    ],
  })
  const two = mapConflicts(twice, space).filter((conflict) => conflict.kind === 'twoPlaces')
  ok('one character in two places at once', two.length === 1 && two[0].from === 5)

  // Across maps: the same place on two maps is the same place.
  const scheduleA = buildSchedule(twice, space, { id: 'x', doc: 'Characters/Bo', startPin: 'a', startDay: 0, legs: [] })
  const scheduleB = buildSchedule(twice, space, { id: 'y', doc: 'Characters/Bo', startPin: 'a', startDay: 0, legs: [] })
  const sharedPlace = crossScheduleConflicts([
    { mapPath: 'One.map', schedule: scheduleA, pinDocs: new Map([['a', 'Settings/A']]) },
    { mapPath: 'Two.map', schedule: scheduleB, pinDocs: new Map([['a', 'Settings/A']]) },
  ])
  ok('the same location doc on two maps is not a conflict', sharedPlace.length === 0)
}

/* ---------------- orbits and stars ---------------- */

{
  ok(`the Earth's year is 365.25 days (${periodDays(1, 1).toFixed(3)})`, near(periodDays(1, 1), 365.256363, 1e-9))
  let worst = 0
  for (const e of [0, 0.1, 0.5, 0.9, 0.95]) {
    for (let M = 0; M < Math.PI * 2; M += 0.37) {
      const E = solveKepler(M, e)
      worst = Math.max(worst, Math.abs(E - e * Math.sin(E) - M))
    }
  }
  ok(`Kepler's equation is solved to 1e-12 (worst ${worst.toExponential(1)})`, worst < 1e-12)
  const system = normalizeMap({
    mapKind: 'system',
    system: {
      bodies: [
        { id: 'sun', kind: 'star', massSun: 1 },
        { id: 'earth', parent: 'sun', kind: 'planet', orbit: { aAU: 1, e: 0 } },
        { id: 'moon', parent: 'earth', kind: 'moon', orbit: { aAU: 0.00257, e: 0 } },
      ],
    },
  }).system
  const start = systemPositionsAt(system, 0).get('earth')
  const period = orbitPeriod(system.bodies[1], new Map(system.bodies.map((body) => [body.id, body])))
  const later = systemPositionsAt(system, period).get('earth')
  ok('a year later the Earth is back where it started', near(start[0], later[0], 1e-9) && near(start[1], later[1], 1e-9))
  const quarter = systemPositionsAt(system, period / 4).get('earth')
  ok('a circular orbit keeps its radius, and runs counter-clockwise', near(Math.hypot(...quarter), 1, 1e-9) && quarter[1] > 0.99)
  const moon = systemPositionsAt(system, 10).get('moon')
  const earthAt10 = systemPositionsAt(system, 10).get('earth')
  ok('the Moon rides along with the Earth', near(Math.hypot(moon[0] - earthAt10[0], moon[1] - earthAt10[1]), 0.00257, 1e-12))
  const fast = interceptDays((id, day) => systemPositionsAt(system, day).get(id), 'earth', 'moon', 0, 0.1 * 1079252848.8, 149597870.7)
  ok('an intercept at 0.1c settles', !fast.approximate && fast.days < 1)
  // A target whipping round at 1 AU a day, chased at walking pace from outside its orbit.
  const slow = interceptDays((id, day) => (id === 'a' ? [2, 0] : [Math.cos(day), Math.sin(day)]), 'a', 'b', 0, 1, 149597870.7)
  ok('a hopeless intercept says it is approximate', slow.approximate)
  ok('a barycenter weighs its stars', bodyMass({ id: 'bc', kind: 'barycenter' }, new Map([['s1', { id: 's1', kind: 'star', massSun: 1, parent: 'bc' }], ['s2', { id: 's2', kind: 'star', massSun: 0.5, parent: 'bc' }]])) === 1.5)
  let continuous = true
  for (const edge of [0.43, 2, 55]) {
    const below = massToLuminosity(edge - 1e-9)
    const above = massToLuminosity(edge + 1e-9)
    if (Math.abs(above - below) / above > 0.2) continuous = false
  }
  ok('the mass–luminosity law has no wild jumps at its breakpoints', continuous)
  ok('the Sun is yellow-white', temperatureToColor(5772).startsWith('#ff'))
  const zone = habitableZoneAU(1)
  ok('the Sun’s habitable zone contains the Earth', zone[0] < 1 && zone[1] > 1)
  const display = { radial: 'log', pxPerAU: 100 }
  const drawn = systemToWorld([3, 4], display)
  const back = worldToSystem(drawn, display)
  ok('the log-radial display scale inverts', near(back[0], 3, 1e-9) && near(back[1], 4, 1e-9))
  ok('1 AU is drawn at pxPerAU on either scale', near(systemToWorld([1, 0], display)[0], 100, 1e-9) && near(systemToWorld([1, 0], { radial: 'linear', pxPerAU: 100 })[0], 100))
}

/* ---------------- viewport ---------------- */

{
  const before = { x: 20, y: -80, zoom: 3 }
  const anchor = screenToWorld(400, 300, before)
  const after = zoomMapAt(before, 400, 300, 2.5)
  const screen = worldToScreen(anchor.x, anchor.y, after)
  ok('zooming keeps the point under the cursor', near(screen.x, 400) && near(screen.y, 300))
  ok('the map zooms far past the canvas limits', clampMapZoom(200) === 200 && clampMapZoom(0.03) === 0.03)
  const fit = fitMapBounds({ x: 0, y: 0, width: 4000, height: 3000 }, 800, 600, 0)
  const center = worldToScreen(2000, 1500, fit)
  ok('fit centers the sheet', near(center.x, 400) && near(center.y, 300))
}

// roughen: a wobble baked into route geometry, in place of a turbulence filter
{
  const { roughenPath, parsePath, ROUGH_STYLE, hashSeed } = await import('../../src/lib/map/roughen.js')
  const straight = 'M0,0L100,0'
  const rough = roughenPath(straight, ROUGH_STYLE, hashSeed('r1'))
  const [line] = parsePath(rough)
  ok('roughen keeps the line one subpath', parsePath(rough).length === 1)
  ok('roughen keeps both ends where they were', line.points[0][0] === 0 && line.points[0][1] === 0 && line.points.at(-1)[0] === 100 && line.points.at(-1)[1] === 0)
  ok('roughen wobbles in between, within its amplitude', line.points.some(([, y]) => Math.abs(y) > 0.01) && line.points.every(([, y]) => Math.abs(y) <= ROUGH_STYLE.amplitude + 1e-9))
  ok('roughen is the same for the same seed', roughenPath(straight, ROUGH_STYLE, 7) === roughenPath(straight, ROUGH_STYLE, 7))
  ok('roughen reads pathData\'s spaced form and keeps subpaths', parsePath(roughenPath('M0 0L10 0M20 0L30 0', ROUGH_STYLE, 1)).length === 2)
  ok('roughen of nothing is nothing', roughenPath('', ROUGH_STYLE, 1) === '')
}

/* ---------------- maps in three dimensions (format 2) ---------------- */

{
  const { readPoint, GALAXY_TYPES } = await import('../../src/lib/map/mapModel.js')
  const { orbitOffset } = await import('../../src/lib/map/orbits.js')
  const { KM_PER_LIGHT_YEAR, formatLightTime } = await import('../../src/lib/map/mapUnits.js')

  // A file from before the third dimension opens unchanged, and saves as format 2.
  const old = normalizeMap({ formatVersion: 1, mapKind: 'earth', earth: { projection: 'orthographic' }, pins: [{ id: 'p', at: [2, 51] }] })
  ok('an old file reads as format 2', old.formatVersion === 2)
  ok('an old globe opens as the globe, an old flat map flat', old.earth.view === 'globe' && normalizeMap({ mapKind: 'earth' }).earth.view === 'flat')
  ok('its points stay two-dimensional', old.pins[0].at.length === 2)
  ok('and nothing new is on it', old.layers.length === 0 && old.views.length === 0 && old.pins[0].from === null && old.pins[0].layer === null)

  ok('a point keeps a height', readPoint([1, 2, 3]).join() === '1,2,3')
  ok('a height that is not a number drops, the point stays', readPoint([1, 2, 'z']).join() === '1,2')
  ok('anything past the height drops', readPoint([1, 2, 3, 4]).join() === '1,2,3')

  for (const kind of ['planet', 'galaxy', 'universe', 'model']) {
    ok(`a ${kind} map can be made`, createEmptyMap(kind).mapKind === kind)
  }
  ok('a galaxy is one of the known shapes', GALAXY_TYPES.includes(normalizeMap({ galaxy: { type: 'blob' } }).galaxy.type))
  const surface = normalizeMap({ mapKind: 'planet', surface: { radiusKm: 3389.5, look: { seaLevel: 3 } } }).surface
  ok('a planet keeps its size and clamps its sea', surface.radiusKm === 3389.5 && surface.look.seaLevel === 1)

  // Distances at every level.
  const mars = createSpace({ mapKind: 'planet', surface: { radiusKm: 3389.5 } })
  const earth = createSpace({ mapKind: 'earth' })
  const pole = [[0, 0], [0, 90]]
  ok('a quarter of the way round Mars is a quarter of Mars', near(mars.distanceKm(...pole), (Math.PI / 2) * 3389.5, 1e-6))
  ok('the same quarter on the Earth is longer by the ratio of their sizes', near(earth.distanceKm(...pole) / mars.distanceKm(...pole), 6371.0088 / 3389.5, 1e-9))
  const galaxy = createSpace({ mapKind: 'galaxy' })
  ok('a galaxy measures in light-years, in three dimensions', near(galaxy.distanceKm([0, 0, 0], [3, 0, 4]), 5 * KM_PER_LIGHT_YEAR, 1))
  ok('from Sol to Alpha Centauri, light takes four years and a bit', /^4\.\d+ years$/.test(formatLightTime(4.37 * KM_PER_LIGHT_YEAR)))
  ok('a ruler across a galaxy reads in light-years', /ly$/.test(formatDistance(4.37 * KM_PER_LIGHT_YEAR, 'auto')))
  ok('across the universe, in millions', /Mly$/.test(formatDistance(2.5e6 * KM_PER_LIGHT_YEAR, 'auto')))
  const model = createSpace({ mapKind: 'model', model: { metresPerUnit: 2 } })
  ok('a model measures in its own metres', near(model.distanceKm([0, 0, 0], [0, 10, 0]), 0.02, 1e-12))

  // Orbits out of the plane.
  const flat = { id: 'p', orbit: { aAU: 1, e: 0.2, periapsisDeg: 30, meanAnomalyDeg: 10, periodDays: 365, retrograde: false } }
  const bodies = new Map([['p', flat]])
  const before = orbitOffset(flat, bodies, 40)
  ok('an orbit in the plane stays in it', before[2] === 0)
  const tilted = { ...flat, orbit: { ...flat.orbit, inclinationDeg: 30 } }
  const after = orbitOffset(tilted, new Map([['p', tilted]]), 40)
  ok('a tilted orbit leaves the plane', Math.abs(after[2]) > 0.01)
  ok('and keeps its distance from what it orbits', near(Math.hypot(...before), Math.hypot(...after), 1e-12))

  // Linked maps: a body's surface follows its map's moves.
  const system = normalizeMap({ mapKind: 'system', system: { bodies: [{ id: 'e', surface: 'Worlds/Earth.map' }] } })
  ok('a body’s surface counts as a link', mapDocRefs(system).includes('Worlds/Earth.map'))
  const moved = rewriteMapDocRefs(system, 'Worlds', 'Places', 'folder')
  ok('and follows its folder when it moves', moved.changed && moved.map.system.bodies[0].surface === 'Places/Earth.map')
}

/* ---------------- the Earth as a globe ---------------- */

{
  const { isItemShown, isAtDay, hiddenLayers } = await import('../../src/lib/map/mapVisibility.js')
  const { unwrapLongitudes, regionFeatures, routeFeatures } = await import('../../src/lib/map/globeFeatures.js')
  const { viewMenuFor, viewOptionPatch, choosesOnline, VIEW_COMMAND_TITLES } = await import('../../src/map/mapViewMenu.js')

  // A place founded on day 10 and gone on day 20 is there for days 10–19.
  const city = { from: 10, until: 20 }
  ok('an item is absent before it appears', !isAtDay(city, 9) && isAtDay(city, 10))
  ok('and gone on its last day', isAtDay(city, 19.5) && !isAtDay(city, 20))
  ok('an item with no dates is always there', isAtDay({ from: null, until: null }, -1e6))
  const layered = normalizeMap({ mapKind: 'earth', layers: [{ id: 'old', name: 'Old', visible: false }], pins: [{ id: 'p', at: [0, 0], layer: 'old' }, { id: 'q', at: [0, 0] }] })
  ok('a hidden layer hides what is on it', hiddenLayers(layered).has('old') && !isItemShown(layered, layered.pins[0], 0) && isItemShown(layered, layered.pins[1], 0))

  // A route across the Pacific stays a short line, not one around the world.
  const unwrapped = unwrapLongitudes([[170, 0], [-170, 0], [-160, 0]])
  ok('longitudes unwrap across the antimeridian', unwrapped[1][0] === 190 && unwrapped[2][0] === 200)

  const world = normalizeMap({
    mapKind: 'earth',
    pins: [{ id: 'lon', at: [-0.12, 51.5] }, { id: 'nyc', at: [-74, 40.7] }],
    routes: [{ id: 'r', nodes: [{ pin: 'lon' }, { pin: 'nyc' }], until: 5 }],
    regions: [{ id: 'g', rings: [[[-10, 40], [10, 40], [10, 55]]] }],
  })
  const regions = regionFeatures(world, { kind: 'region', id: 'g' }, 0)
  const ring = regions.features[0].geometry.coordinates[0]
  ok('a region is a closed polygon', ring.length === 4 && ring[0][0] === ring[3][0] && ring[0][1] === ring[3][1])
  ok('carrying its id and selection', regions.features[0].properties.id === 'g' && regions.features[0].properties.selected)
  const routes = routeFeatures(world, createSpace(world), 0, null)
  const line = routes.features[0].geometry.coordinates
  ok('a route follows its great circle', line.length > 2 && Math.max(...line.map((point) => point[1])) > 51.5)
  ok('and leaves the globe when it ends', routeFeatures(world, createSpace(world), 5, null).features.length === 0)

  // The View menu: a globe offers satellite pictures; a flat map does not.
  const globe = normalizeMap({ mapKind: 'earth', earth: { view: 'globe' } })
  const menu = viewMenuFor(globe)
  const byId = (items, id) => items.find((entry) => entry.id === id)
  ok('the View menu checks the globe', byId(menu, 'earth.view.globe').checked && !byId(menu, 'earth.view.flat').checked)
  ok('satellite is offered on the globe only', !byId(menu, 'earth.imagery.satellite').disabled && byId(viewMenuFor({ ...globe, earth: { ...globe.earth, view: 'flat' } }), 'earth.imagery.satellite').disabled)
  ok('a globe that could not start offers the flat map', byId(viewMenuFor(globe, { globeAvailable: false }), 'earth.view.flat').checked)
  ok('a map that is not the Earth has no View menu', viewMenuFor(normalizeMap({ mapKind: 'blank' })).length === 0)
  ok('a projection lays the globe flat', viewOptionPatch(globe, 'earth.projection.mercator').view === 'flat')
  ok('an unknown projection is refused', viewOptionPatch(globe, 'earth.projection.dymaxion') === null)
  ok('satellite pictures bring the globe back', viewOptionPatch({ ...globe, earth: { ...globe.earth, view: 'flat' } }, 'earth.imagery.satellite').view === 'globe')
  ok('satellite pictures ask before going online', choosesOnline(globe, 'earth.imagery.satellite') && !choosesOnline(globe, 'earth.graticule'))
  ok('turning terrain off does not ask', !choosesOnline({ ...globe, earth: { ...globe.earth, terrain3d: true } }, 'earth.terrain'))
  ok('every View choice is a command', menu.every((entry) => VIEW_COMMAND_TITLES[entry.id]))
}

/* ---------------- bodies that all pull on each other ---------------- */

{
  const { createRun, energy, runFor, stabilityOf, stateFromOrbits, toNbody } = await import('../../src/lib/map/nbody.js')
  const { presetSystem, SYSTEM_PRESETS } = await import('../../src/lib/map/systemPresets.js')
  const { STAR_PRESETS, starFields, starLook, variableAt } = await import('../../src/lib/map/stars.js')
  const systemOf = (id, options) => normalizeMap({ mapKind: 'system', system: presetSystem(id, options) }).system

  // The figure eight: equal stars, one path, back where they began after a period.
  const eight = systemOf('figureEight')
  const run = createRun(eight)
  const period = 6.32591398 * Math.sqrt(1 / (0.01720209895 ** 2))
  const start = run.positionsAt(0).get('a')
  const later = run.positionsAt(period).get('a')
  ok('the figure eight comes round again', Math.hypot(start[0] - later[0], start[1] - later[1]) < 1e-4)
  const e0 = energy(run.checkpoint(0), run.eps2)
  const e1 = energy(run.checkpoint(Math.ceil((period * 10) / run.span)), run.eps2)
  ok('and keeps its energy over ten turns', Math.abs((e1 - e0) / e0) < 1e-6)
  ok('the same system goes the same way, bit for bit', createRun(eight).positionsAt(1234.5).get('c').join() === run.positionsAt(1234.5).get('c').join())
  const resumed = run.positionsAt(800.3).get('b').join()
  ok('resuming from a checkpoint matches a straight run', createRun(eight).positionsAt(800.3).get('b').join() === resumed)
  ok('it runs backwards from day 0 too', run.positionsAt(-150).get('a').every(Number.isFinite))

  // Every template says truly whether it holds together.
  for (const preset of SYSTEM_PRESETS.filter((candidate) => candidate.dynamics === 'nbody' && candidate.id !== 'encounter' && candidate.id !== 'butterfly')) {
    ok(`${preset.label} ${preset.stable ? 'holds together' : 'comes apart'}`, stabilityOf(systemOf(preset.id)).stable === preset.stable)
  }
  const burrau = stabilityOf(systemOf('pythagorean'))
  ok('Burrau’s three flings one away within the story', burrau.ejected && burrau.ejected.day < 3650)
  ok('a random encounter differs by seed', JSON.stringify(systemOf('encounter', { seed: 1 }).bodies) !== JSON.stringify(systemOf('encounter', { seed: 2 }).bodies))
  ok('a nudge changes the start', JSON.stringify(systemOf('figureEight', { perturb: 0.05 }).bodies) !== JSON.stringify(eight.bodies))

  // A Kepler system turned N-body starts exactly where it was.
  const sol = normalizeMap({ mapKind: 'system', system: presetSystem('sol') }).system
  const states = stateFromOrbits(sol)
  const kepler = systemPositionsAt(sol, 0)
  ok('state vectors start on the orbits', Math.hypot(...states.get('earth').pos.map((value, axis) => value - kepler.get('earth')[axis])) < 1e-12)
  const earthSpeed = Math.hypot(...states.get('earth').vel) * 149597870.7 / 86400
  ok('and move at the orbit’s speed (Earth ≈ 29.8 km/s)', Math.abs(earthSpeed - 29.8) < 0.6)
  const pulled = normalizeMap({ mapKind: 'system', system: toNbody(sol) }).system
  const after = systemPositionsAt(pulled, 30).get('earth')
  const onOrbit = systemPositionsAt(sol, 30).get('earth')
  ok('and stay close to them a month on', Math.hypot(after[0] - onOrbit[0], after[1] - onOrbit[1], after[2] - onOrbit[2]) < 0.01)
  ok('an N-body system is cached by what moves it', runFor(pulled) === runFor({ ...pulled }))

  // Star templates.
  ok('every star has a look', STAR_PRESETS.every((preset) => typeof preset.look === 'string'))
  const pulsar = STAR_PRESETS.find((preset) => preset.id === 'PSR')
  ok('a pulsar spins', starFields(pulsar).spinSeconds > 0 && starLook({ star: starFields(pulsar) }) === 'pulsar')
  const cepheid = starFields(STAR_PRESETS.find((preset) => preset.id === 'CEP'))
  const pulses = [0, 1, 2, 3, 4, 5].map((day) => variableAt(cepheid, day).brightness)
  ok('a Cepheid brightens and fades', Math.max(...pulses) > 1.1 && Math.min(...pulses) < 0.9)
  ok('a steady star does not', variableAt(starFields(STAR_PRESETS[4]), 3).brightness === 1)
}

/* ---------------- a star system in 3D ---------------- */

{
  const { systemToScene, sceneToSystem, readSpaceCamera, DEFAULT_SPACE_CAMERA } = await import('../../src/map/space/spaceMath.js')
  const { viewMenuFor, viewOptionEdit } = await import('../../src/map/mapViewMenu.js')
  const display = { radial: 'log', pxPerAU: 100 }
  // Seen from straight above, the 3D layout is the flat map's: scene x is the page's
  // x, scene z is the page's y (down), at 1 drawn-AU per pxPerAU world units.
  const samePlace = [[1, 0], [0.4, -2.5], [-30, 12]].every((point) => {
    const scene = systemToScene([point[0], point[1], 0], display)
    const flat = systemToWorld(point, display)
    return Math.abs(scene[0] * 100 - flat[0]) < 1e-9 && Math.abs(scene[2] * 100 - flat[1]) < 1e-9 && scene[1] === 0
  })
  ok('face-on, the 3D system is laid out as the flat map', samePlace)
  const back = sceneToSystem(systemToScene([3, -4, 1.5], display), display)
  ok('scene and system points convert both ways', Math.hypot(back[0] - 3, back[1] + 4, back[2] - 1.5) < 1e-9)
  ok('above the plane is up in the scene', systemToScene([0, 0, 2], { radial: 'linear' })[1] === 2)
  ok('a malformed camera falls back to the default', readSpaceCamera({ center: [0, 0], zoom: 3 }).fov === DEFAULT_SPACE_CAMERA.fov)
  ok('a saved camera is kept', readSpaceCamera({ position: [1, 2, 3], target: [0, 0, 0], fov: 50 }).position[2] === 3)

  const system = normalizeMap({ mapKind: 'system', system: { display: { view: '3d' } } })
  ok('a system offers 3D and flat', viewMenuFor(system).find((entry) => entry.id === 'system.view.3d').checked)
  ok('an old system opens flat', normalizeMap({ mapKind: 'system' }).system.display.view === 'flat')
  const edit = viewOptionEdit(system, 'system.radial.linear')
  ok('distances to scale is an edit to the system', edit.section === 'system' && edit.patch.display.radial === 'linear' && edit.patch.display.view === '3d')
  ok('a 3D view that could not start offers flat only', viewMenuFor(system, { spaceAvailable: false }).find((entry) => entry.id === 'system.view.3d').disabled)
}

/* ---------------- planets and stars as worlds ---------------- */

{
  const { planetTexture, MASK_WATER, MASK_LAND } = await import('../../src/lib/map/planetTexture.js')
  const { presetSurface, surfaceForBody, PLANET_PRESETS } = await import('../../src/lib/map/planetPresets.js')
  const { lonLatToUnit, unitToLonLat, subsolarPoint } = await import('../../src/map/space/spaceMath.js')
  const { presetSystem } = await import('../../src/lib/map/systemPresets.js')
  const size = { width: 64, height: 32 }
  const look = normalizeMap({ mapKind: 'planet', surface: presetSurface('earthlike', 5) }).surface.look
  const a = planetTexture(look, size)
  ok('the same seed draws the same world', a.color.join() === planetTexture(look, size).color.join())
  ok('another seed draws another', a.color.join() !== planetTexture({ ...look, seed: 6 }, size).color.join())
  const seaShare = (surface) => {
    const { relief } = planetTexture(surface, size)
    const level = Math.round(surface.seaLevel * 255)
    return [...relief].filter((value) => value <= level).length / relief.length
  }
  ok('a higher sea drowns more of the world', seaShare({ ...look, seaLevel: 0.75 }) > seaShare({ ...look, seaLevel: 0.3 }) + 0.2)
  const mask = new Uint8Array(size.width * size.height)
  mask.fill(MASK_WATER)
  const drowned = planetTexture(look, { ...size, mask })
  ok('drawn water is sea', [...drowned.relief].every((value) => value <= Math.round(look.seaLevel * 255)))
  mask.fill(MASK_LAND)
  const raised = planetTexture(look, { ...size, mask })
  ok('drawn land rises out of it', [...raised.relief].every((value) => value > Math.round(look.seaLevel * 255)))
  const gas = planetTexture({ kind: 'gas', palette: 'jovian', seed: 3, roughness: 0.5 }, size)
  ok('a giant is drawn in bands', new Set(gas.color.filter((_, index) => index % 4 === 0)).size > 8)
  ok('every preset reads cleanly', PLANET_PRESETS.every((preset) => normalizeMap({ mapKind: 'planet', surface: presetSurface(preset.id) }).surface.radiusKm > 0))

  const sol = normalizeMap({ mapKind: 'system', system: presetSystem('sol') }).system
  const bodies = new Map(sol.bodies.map((body) => [body.id, body]))
  const mars = surfaceForBody(bodies.get('mars'), bodies)
  ok('red Mars opens as a rust world', mars.look.palette === 'rust' && mars.look.kind === 'generated')
  ok('with its own year', Math.abs(mars.yearDays - 687) < 2)
  ok('Jupiter opens as a giant', surfaceForBody(bodies.get('jupiter'), bodies).look.kind === 'gas')
  ok('the Sun opens as a star', surfaceForBody(bodies.get('sun'), bodies).look.kind === 'star')
  ok('a body opens the same world every time', surfaceForBody(bodies.get('earth'), bodies).look.seed === surfaceForBody(bodies.get('earth'), bodies).look.seed)

  const round = unitToLonLat(lonLatToUnit([123, -45]))
  ok('longitude and latitude survive the trip to 3D', Math.abs(round[0] - 123) < 1e-9 && Math.abs(round[1] + 45) < 1e-9)
  const tilted = { dayHours: 24, yearDays: 360, axialTiltDeg: 23 }
  ok('noon is on the prime meridian on day 0', Math.abs(subsolarPoint(tilted, 0)[0]) < 1e-9)
  ok('and has moved west six hours later', Math.abs(subsolarPoint(tilted, 0.25)[0] + 90) < 1e-9)
  ok('the sun reaches the tropic at midsummer', Math.abs(subsolarPoint(tilted, 90)[1] - 23) < 1e-9)
  ok('an upright world has no seasons', subsolarPoint({ ...tilted, axialTiltDeg: 0 }, 90)[1] === 0)
}

/* ---------------- where a map sits ---------------- */

{
  const { parentIndex, trailFor } = await import('../../src/lib/map/mapAncestry.js')
  const galaxy = normalizeMap({ mapKind: 'blank', pins: [{ id: 's', at: [1, 1], doc: 'Space/Sol.map' }, { id: 'n', at: [2, 2], doc: 'Notes/Chapter' }] })
  const sol = normalizeMap({ mapKind: 'system', system: { bodies: [{ id: 'e', name: 'Earth', kind: 'planet', surface: 'Space/Earth.map' }] } })
  const earth = normalizeMap({ mapKind: 'planet' })
  const index = parentIndex([{ path: 'Space/Milky Way.map', map: galaxy }, { path: 'Space/Sol.map', map: sol }, { path: 'Space/Earth.map', map: earth }])
  const trail = trailFor('Space/Earth.map', index)
  ok('a world sits in its system, and the system in its galaxy', trail.map((step) => step.path).join(' > ') === 'Space/Milky Way.map > Space/Sol.map > Space/Earth.map')
  ok('each step knows its kind', trail[1].kind === 'system' && trail[2].kind === 'planet')
  ok('a pin on a document is not a parent', !index.parents.has('Notes/Chapter'))
  const loop = parentIndex([{ path: 'A.map', map: normalizeMap({ mapKind: 'blank', pins: [{ id: 'p', at: [0, 0], doc: 'B.map' }] }) }, { path: 'B.map', map: normalizeMap({ mapKind: 'blank', pins: [{ id: 'p', at: [0, 0], doc: 'A.map' }] }) }])
  ok('maps that link to each other end the trail', trailFor('A.map', loop).length === 2)
}

/* ---------------- galaxies, and groups of them ---------------- */

{
  const { generateGalaxy, galaxyStats, galaxyShape, GALAXY_TYPE_NAMES } = await import('../../src/lib/map/galaxyGen.js')
  const { fillUniverse } = await import('../../src/lib/map/universeGen.js')
  const { GALAXY_TYPES } = await import('../../src/lib/map/mapModel.js')
  const make = (type, seed = 4, extra = {}) => generateGalaxy({ type, seed, radiusLy: 50000, thicknessLy: 1000, ...extra }, { count: 12000 })
  const stats = (type, seed) => galaxyStats(make(type, seed), 50000)

  ok('every type draws, and has a name', GALAXY_TYPES.every((type) => make(type).count > 0 && GALAXY_TYPE_NAMES[type]))
  ok('the same seed draws the same galaxy, point for point', make('Sb').positions.join() === make('Sb').positions.join())
  ok('another seed draws another', make('Sb', 4).positions.join() !== make('Sb', 5).positions.join())
  ok('a round elliptical has no bar', [1, 2, 3, 4].every((seed) => stats('E0', seed).barAspect < 1.15))
  ok('an elliptical has no dust', make('E5').dust.count === 0)
  ok('the higher the class, the flatter the elliptical', stats('E7').flatness < stats('E3').flatness && stats('E3').flatness < stats('E0').flatness)
  ok('a spiral is a thin disc', stats('Sc').flatness < 0.15)
  ok('an Sa has more bulge than an Sd', [1, 2, 3].every((seed) => stats('Sa', seed).bulgeShare > stats('Sd', seed).bulgeShare))
  ok('a barred spiral has a bar, an unbarred one none', [1, 2, 3, 4].every((seed) => stats('SBb', seed).barAspect > 1.8 && stats('Sb', seed).barAspect < 1.4))
  ok('a fixed shape survives a reroll', galaxyShape({ type: 'Sc', seed: 9, params: { arms: 5 } }).arms === 5 && galaxyShape({ type: 'Sc', seed: 10, params: { arms: 5 } }).arms === 5)
  ok('a dwarf is sparse', make('dwarf').count < make('Sb').count / 2)

  const group = fillUniverse({ seed: 8, count: 200, extentMpc: 40 })
  ok('a group of galaxies is drawn from its seed', JSON.stringify(group) === JSON.stringify(fillUniverse({ seed: 8, count: 200, extentMpc: 40 })))
  ok('every galaxy has a name, a place and a look', group.every((pin) => pin.name && pin.at.length === 3 && GALAXY_TYPES.includes(pin.galaxy.type)))
  ok('they stay inside the region', group.every((pin) => pin.at.every((value) => Math.abs(value) <= 20)))
  const elliptical = (pins) => pins.filter((pin) => /^E|S0/.test(pin.galaxy.type)).length / pins.length
  ok('ellipticals are a minority overall', elliptical(group) < 0.6)
  ok('a galaxy pin reads cleanly', normalizeMap({ mapKind: 'universe', pins: group.slice(0, 3) }).pins[0].galaxy.type === group[0].galaxy.type)
}

/* ---------------- layers, and places that come and go ---------------- */

{
  const { hiddenKey, withoutHidden, hiddenIds, isItemLocked } = await import('../../src/lib/map/mapVisibility.js')
  const { eventDay } = await import('../../src/map/inspector/whenSections.js')
  const map = normalizeMap({
    layers: [{ id: 'old', name: 'Old roads', visible: false }, { id: 'war', name: 'The war', locked: true }],
    pins: [{ id: 'a', at: [0, 0], layer: 'old' }, { id: 'b', at: [1, 1], from: 10 }, { id: 'c', at: [2, 2], layer: 'war' }],
    routes: [{ id: 'r', nodes: [{ pin: 'a' }, { pin: 'c' }], layer: 'old' }],
    labels: [{ id: 'l', text: 'Gone', at: [3, 3], until: 5 }],
  })
  ok('a hidden layer and a day outside a span hide their items', hiddenIds(hiddenKey(map, 0)).has('a') && hiddenIds(hiddenKey(map, 0)).has('b') && hiddenIds(hiddenKey(map, 0)).has('r'))
  ok('a span opens on its day, and closes on its until', !hiddenIds(hiddenKey(map, 10)).has('b') && hiddenIds(hiddenKey(map, 5)).has('l') && !hiddenIds(hiddenKey(map, 4)).has('l'))
  const shown = withoutHidden(map, hiddenKey(map, 0))
  ok('hidden routes leave, pins stay for what leans on them', shown.routes.length === 0 && shown.pins.length === 3)
  ok('nothing hidden gives back the same map', withoutHidden(map, '') === map)
  ok('a locked layer holds its items', isItemLocked(map, 'pin', 'c') && !isItemLocked(map, 'pin', 'b'))
  ok('an item follows an event: in at its start, gone at its end', eventDay({ start: 3, end: 9 }, 'from') === 3 && eventDay({ start: 3, end: 9 }, 'until') === 9 && eventDay({ start: 3, end: null }, 'until') === 4)
}

/* ---------------- the key ---------------- */

{
  const { legendEntries } = await import('../../src/map/mapLegend.js')
  const map = normalizeMap({
    terrains: [{ id: 'forest', name: 'Forest', fill: '#4a7a3a' }],
    pins: [{ id: 'a', at: [0, 0], icon: 'city' }, { id: 'b', at: [1, 0], icon: 'city' }, { id: 'c', at: [2, 0], icon: 'castle', from: 50 }],
    regions: [{ id: 'f', rings: [[[0, 0], [1, 0], [1, 1]]], terrain: 'forest' }, { id: 'g', rings: [[[0, 0], [2, 0], [2, 2]]], terrain: 'forest' }],
    routes: [{ id: 'r', name: 'King’s road', nodes: [{ pin: 'a' }, { pin: 'b' }] }],
  })
  const labels = (day) => legendEntries(map, day).map((entry) => entry.label)
  ok('the key lists each kind of place once', labels(0).filter((label) => label === 'City').length === 1)
  ok('a terrain is named once, however many regions wear it', labels(0).filter((label) => label === 'Forest').length === 1)
  ok('a few routes are listed by name', labels(0).includes('King’s road'))
  ok('what is not there on the day is not in the key', !labels(0).includes('Castle') && labels(60).includes('Castle'))
  const many = normalizeMap({ pins: [{ id: 'a', at: [0, 0] }, { id: 'b', at: [1, 0] }], routes: Array.from({ length: 6 }, (_, index) => ({ id: `r${index}`, name: `Road ${index}`, nodes: [{ pin: 'a' }, { pin: 'b' }] })) })
  ok('many routes drawn alike gather into one row', legendEntries(many).filter((entry) => entry.kind === 'route').length === 1)
}

/* ---------------- GeoJSON and KML ---------------- */

{
  const { JSDOM } = await import('jsdom')
  globalThis.DOMParser = new JSDOM('').window.DOMParser
  const { mapToGeoJSON, mapToKml, geoJSONToItems, kmlToGeoJSON, readGeoFile } = await import('../../src/lib/map/geoInterchange.js')
  const earth = normalizeMap({
    mapKind: 'earth',
    pins: [{ id: 'p', name: 'Paris', at: [2.35, 48.85], icon: 'city' }, { id: 'l', name: 'London', at: [-0.13, 51.5] }],
    routes: [{ id: 'r', name: 'Ferry', nodes: [{ pin: 'l' }, { pin: 'p' }] }],
    regions: [{ id: 'g', name: 'Île', rings: [[[2, 48], [3, 48], [3, 49]]], from: 10 }],
  })
  const json = mapToGeoJSON(earth, createSpace(earth))
  ok('out: places, routes and regions become features', json.features.map((feature) => feature.geometry.type).join() === 'Point,Point,LineString,Polygon')
  ok('out: a route follows its places', JSON.stringify(json.features[2].geometry.coordinates) === JSON.stringify([[-0.13, 51.5], [2.35, 48.85]]))
  ok('out: a polygon ring is closed, and a day kept', json.features[3].geometry.coordinates[0].length === 4 && json.features[3].properties.from === 10)
  const back = geoJSONToItems(json, earth)
  ok('in: what went out comes back', back.pins.length === 2 && back.routes.length === 1 && back.regions.length === 1 && back.pins[0].name === 'Paris' && back.pins[0].icon === 'city')
  ok('in: a ring is opened again, and lands where it says on the Earth', back.regions[0].rings[0].length === 3 && back.regions[0].rings[0][0][0] === 2)
  const kml = mapToKml(earth, createSpace(earth), { name: 'Trip' })
  const fromKml = kmlToGeoJSON(kml)
  ok('KML out and in again keeps names and shapes', fromKml.features.length === 4 && fromKml.features[0].properties.name === 'Paris' && fromKml.features[3].geometry.type === 'Polygon')
  ok('a file is read by its look', readGeoFile(kml, 'trip.kml').features.length === 4 && readGeoFile(JSON.stringify(json)).features.length === 4)
  const sheet = normalizeMap({ mapKind: 'blank' })
  const fitted = geoJSONToItems({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'MultiPoint', coordinates: [[10, 50], [12, 52]] }, properties: {} }] }, sheet)
  const [south, north] = fitted.pins
  ok('on a drawn map an import is fitted to the sheet, north up', fitted.pins.length === 2 && north.at[1] < south.at[1] && south.at.every((value) => value > 0 && value < 4000))
  ok('nonsense is counted, not imported', geoJSONToItems({ type: 'Feature', geometry: { type: 'Point', coordinates: ['a', 1] } }, earth).skipped === 1)
}

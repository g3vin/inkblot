/**
 * distanceSections.js — Travel ▸ Distance over time: pick two things (places, bodies,
 * travellers) and see how far apart they are across the story, closest and
 * farthest, with light's travel time in space. Click the chart to go to that day.
 */
import { getDocDisplayName } from '../../lib/docKind'
import { formatDay } from '../../lib/map/calendar'
import { distanceEnds, distanceOn, distanceSeries, distanceSpan, LIGHT_KM_PER_DAY } from '../../lib/map/distanceOverTime'
import { formatDistance, formatDuration } from '../../lib/map/mapUnits'
import { unitFor } from '../mapOptions'

const SPACE_KINDS = new Set(['system', 'galaxy', 'universe'])

export function distanceOverTimeSections(ui, { map, space, day, calendar, extent, state, setState, onDay }) {
  const ends = distanceEnds(map, getDocDisplayName)
  // Only worth a chart where something moves: bodies in orbit, travellers on their way.
  if (ends.length < 2 || !(map.mapKind === 'system' || map.travelers.length)) return []
  const a = ends.some((end) => end.value === state.a) ? state.a : ends[0].value
  const b = ends.some((end) => end.value === state.b) && state.b !== a ? state.b : ends.find((end) => end.value !== a).value
  const fields = [
    ui.choice('distanceOverTime.a', 'From', a, ends, (value) => setState({ ...state, a: value })),
    ui.choice('distanceOverTime.b', 'To', b, ends.filter((end) => end.value !== a), (value) => setState({ ...state, b: value })),
  ]
  if (!state.show) {
    return [ui.section('distanceOverTime', 'Distance over time', [
      ...fields,
      ui.note('How far apart two things are across the story: two worlds in their orbits, a traveller and home.'),
    ], [ui.button('distanceOverTime.toggle', 'Show', () => setState({ ...state, show: true }))])]
  }

  const unit = unitFor(map)
  const span = distanceSpan(map, a, b, extent)
  const series = distanceSeries(map, space, a, b, span)
  const today = distanceOn(map, space, a, b, day)
  const light = (km) => (SPACE_KINDS.has(map.mapKind) ? ` (light takes ${formatDuration(km / LIGHT_KM_PER_DAY)})` : '')
  if (!series?.points.length) {
    fields.push(ui.note('These two are never both on the map at once.'))
  } else {
    const { closest, farthest } = series
    const summary = [
      `Closest ${formatDistance(closest.km, unit, map)} on ${formatDay(calendar, closest.day)}`,
      `farthest ${formatDistance(farthest.km, unit, map)} on ${formatDay(calendar, farthest.day)}.`,
    ].join('; ')
    fields.push(
      ui.chart('distanceOverTime.chart', {
        points: series.points,
        marker: day,
        xFrom: formatDay(calendar, span.from),
        xTo: formatDay(calendar, span.to),
        yMin: formatDistance(closest.km, unit, map),
        yMax: formatDistance(farthest.km, unit, map),
        summary,
      }, onDay),
      today !== null ? ui.stat('Now', `${formatDistance(today, unit, map)}${light(today)}`) : null,
      ui.buttons([
        ui.button('distanceOverTime.closest', 'Go to closest', () => onDay?.(closest.day)),
        ui.button('distanceOverTime.farthest', 'Go to farthest', () => onDay?.(farthest.day)),
      ]),
    )
  }
  return [ui.section('distanceOverTime', 'Distance over time', fields, [ui.button('distanceOverTime.toggle', 'Hide', () => setState({ ...state, show: false }))])]
}

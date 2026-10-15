/**
 * whenSections.js — where an item is kept and when it is there: its layer, the day
 * it appears and the day it is gone (a city founded in year 300, a border that moved
 * in 1871), or the timeline events it comes and goes with.
 *
 * An item that follows an event (`fromEvent`, `untilEvent`) keeps its `from` and
 * `until` in step with it: MapSurface moves them when the event moves.
 */
import { formatDay } from '../../lib/map/calendar'
import { calendarShape, dayToParts, partsToDay } from './travelSections'

/** The day an item following `event` appears, or is gone: an event's start, or its end. */
export const eventDay = (event, edge) => {
  if (!event || !Number.isFinite(event.start)) return null
  return edge === 'from' ? event.start : Number.isFinite(event.end) ? event.end : event.start + 1
}

export function whenSections(ui, { map, item, calendar, events = [], patch, onDay }) {
  const dated = events.filter((event) => Number.isFinite(event.start))
  const eventChoices = (current) => [
    { value: '', label: 'No event' },
    ...dated.map((event) => ({ value: event.id, label: event.title || 'Untitled event', group: 'Timeline events' })),
    // An event since undated or deleted stays named, so the choice still reads.
    ...(current && !dated.some((event) => event.id === current) ? [{ value: current, label: 'An event no longer dated' }] : []),
  ]
  const follow = (edge, eventId) => {
    const key = edge === 'from' ? 'fromEvent' : 'untilEvent'
    const event = dated.find((candidate) => candidate.id === eventId)
    patch({ [key]: eventId || null, ...(event ? { [edge]: eventDay(event, edge) } : {}) })
  }
  const dateRow = (edge, label, placeholder) =>
    ui.date(`when.${edge}`, label, dayToParts(calendar, item[edge]), calendarShape(calendar), (parts) => patch({ [edge]: partsToDay(calendar, parts) }), {
      allowEmpty: true,
      placeholder,
    })
  const jump = (edge, label) =>
    Number.isFinite(item[edge]) ? ui.stat(label, formatDay(calendar, item[edge]), ui.button(`when.${edge}.go`, formatDay(calendar, item[edge]), () => onDay?.(item[edge]))) : null

  const layerChoices = [{ value: '', label: 'None' }, ...map.layers.map((layer) => ({ value: layer.id, label: layer.name }))]
  return [
    ui.section('when', 'When', [
      map.layers.length ? ui.choice('when.layer', 'Layer', item.layer || '', layerChoices, (layer) => patch({ layer: layer || null })) : null,
      item.fromEvent ? jump('from', 'Appears on') : dateRow('from', 'Appears on', 'From the start'),
      dated.length || item.fromEvent ? ui.choice('when.fromEvent', 'Or with', item.fromEvent || '', eventChoices(item.fromEvent), (eventId) => follow('from', eventId)) : null,
      item.untilEvent ? jump('until', 'Gone from') : dateRow('until', 'Gone from', 'Never'),
      dated.length || item.untilEvent ? ui.choice('when.untilEvent', 'Or with', item.untilEvent || '', eventChoices(item.untilEvent), (eventId) => follow('until', eventId)) : null,
      Number.isFinite(item.from) || Number.isFinite(item.until)
        ? ui.note('Scrub the timeline to watch it come and go. It is hidden on days outside these.')
        : null,
    ]),
  ]
}

/**
 * A place's events: the timeline events set here (an event's `place`), each opening
 * the timeline at it, and Add an event here, on the day the map is at.
 */
export function eventsHereSections(ui, { pin, docPath, calendar, events = [], onShowEvent, onAddEvent }) {
  const here = events
    .filter((event) => event.place?.map === docPath && event.place?.pin === pin.id)
    .sort((a, b) => (a.start ?? Infinity) - (b.start ?? Infinity))
  return [
    ui.section('eventsHere', 'Events here', [
      ...here.map((event) =>
        ui.listRow(`eventsHere.${event.id}`, event.title || 'Untitled event', () => onShowEvent?.(event.id), {
          subtitle: Number.isFinite(event.start) ? formatDay(calendar, event.start) : 'Undated',
          swatch: event.color || undefined,
        })
      ),
      here.length ? null : ui.note('Nothing on the timeline happens here yet.'),
    ], [onAddEvent ? ui.button('eventsHere.add', 'Add', onAddEvent, { icon: 'add' }) : null]),
  ]
}

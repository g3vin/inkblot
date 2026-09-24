/**
 * timeline.js — where every traveller is on any day, and what cannot be true.
 *
 * A traveller starts at a place on a day and then takes legs in order. A leg leaves
 * on its own `departDay` if it names one, otherwise when the previous leg arrived
 * plus its rest days; it arrives after its travel time (travel.js). That makes a
 * schedule of intervals — staying somewhere, or travelling a leg — and a position at
 * any day is read off it: a pin's place during a stay, a point along the line during
 * travel, found by inverting the leg's time profile so a traveller visibly slows in
 * a forest.
 *
 * The conflicts are the things a reader would catch:
 *
 *   overlap        a leg set to leave before the previous one arrives
 *   discontinuity  a leg that starts somewhere other than where the last one ended
 *   impassable     a leg crossing terrain its transport cannot
 *   beforeStart    a leg set to leave before the traveller's own start
 *   twoPlaces      one character (by doc) in two different places at once — across
 *                  travellers and across maps
 *
 * Mirrored in `inkblot_core::map::timeline`.
 */
import { kmAfter, legTravel } from './travel'
import { pointAtKm, resolvePin } from './mapSpace'
import { properTimeDays } from './transports'

/** A travel or stay interval of a traveller's schedule. */
const stay = (from, to, pinId) => ({ kind: 'stay', from, to, pin: pinId })

/**
 * A traveller's schedule on a map: `{ travelerId, doc, start, end, intervals,
 * conflicts }`. The last stay runs to Infinity — a traveller stays where they end up.
 */
export function buildSchedule(map, space, traveler) {
  const intervals = []
  const conflicts = []
  const start = Number.isFinite(traveler.startDay) ? traveler.startDay : 0
  let clock = start
  let here = traveler.startPin || traveler.legs?.[0]?.from || null

  for (const leg of traveler.legs || []) {
    const planned = clock + (leg.restDays || 0)
    let depart = planned
    if (Number.isFinite(leg.departDay)) {
      depart = leg.departDay
      if (leg.departDay < start) {
        conflicts.push({ kind: 'beforeStart', travelerId: traveler.id, legId: leg.id, from: leg.departDay, to: start })
      } else if (leg.departDay < clock) {
        conflicts.push({ kind: 'overlap', travelerId: traveler.id, legId: leg.id, from: leg.departDay, to: clock })
      }
    }
    if (here && leg.from && leg.from !== here) {
      conflicts.push({ kind: 'discontinuity', travelerId: traveler.id, legId: leg.id, from: depart, to: depart, expected: here, actual: leg.from })
    }
    if (depart > clock && here) intervals.push(stay(clock, depart, here))

    const travel = legTravel(map, space, leg, depart)
    const days = travel.profile.days
    if (travel.profile.impassable) {
      conflicts.push({ kind: 'impassable', travelerId: traveler.id, legId: leg.id, from: depart, to: depart + days })
    }
    intervals.push({
      kind: 'travel',
      from: depart,
      to: depart + days,
      legId: leg.id,
      fromPin: leg.from,
      toPin: leg.to,
      transport: travel.transport,
      line: travel.line,
      profile: travel.profile,
      approximate: travel.approximate,
      properDays: properTimeDays(days, travel.transport.fractionC || 0),
    })
    clock = depart + days
    here = leg.to || here
  }

  if (here) intervals.push(stay(clock, Infinity, here))
  return { travelerId: traveler.id, doc: traveler.doc || null, start, end: clock, intervals, conflicts }
}

/** Schedules for every traveller on a map. */
export const buildSchedules = (map, space) => (map.travelers || []).map((traveler) => buildSchedule(map, space, traveler))

/**
 * Where a traveller is on `day`: `{ point, heading, interval, progress }` in stored
 * coordinates, or null before they start. `heading` is in the stored space (radians).
 */
export function travelerPositionAt(map, space, schedule, day) {
  if (!schedule || day < schedule.start) return null
  const pins = new Map((map.pins || []).map((pin) => [pin.id, pin]))
  for (const interval of schedule.intervals) {
    if (day < interval.from || day >= interval.to) continue
    if (interval.kind === 'stay') {
      const point = resolvePin(map, space, pins.get(interval.pin), day)
      return point ? { point, heading: null, interval, progress: null } : null
    }
    const elapsed = day - interval.from
    const km = kmAfter(interval.profile, elapsed)
    const at = pointAtKm(space, interval.line, km)
    if (!at) return null
    const { points } = interval.line
    const a = points[at.index]
    const b = points[Math.min(points.length - 1, at.index + 1)]
    const heading = a && b ? Math.atan2(b[1] - a[1], b[0] - a[0]) : null
    const progress = interval.profile.km > 0 ? km / interval.profile.km : 1
    // `index` is the segment of the leg's line they are on — what a trail is cut at.
    return { point: at.point, heading, interval, progress, index: at.index }
  }
  return null
}

/** The place (pin) a schedule is at on `day`, or null when travelling or not yet started. */
function placeAt(schedule, day) {
  for (const interval of schedule.intervals) {
    if (day >= interval.from && day < interval.to) return interval.kind === 'stay' ? interval.pin : null
  }
  return null
}

/**
 * Conflicts between schedules: one character (same `doc`) somewhere different at
 * the same time. `entries` is `[{ mapPath, schedule, pinDocs }]`, where `pinDocs`
 * maps a pin id to the location doc it stands for — two pins for the same place on
 * two maps are the same place.
 */
export function crossScheduleConflicts(entries) {
  const byDoc = new Map()
  for (const entry of entries) {
    if (!entry.schedule.doc) continue
    if (!byDoc.has(entry.schedule.doc)) byDoc.set(entry.schedule.doc, [])
    byDoc.get(entry.schedule.doc).push(entry)
  }

  const conflicts = []
  for (const [doc, group] of byDoc) {
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const a = group[i]
        const b = group[j]
        const overlapFrom = Math.max(a.schedule.start, b.schedule.start)
        const overlapTo = Math.min(
          a.schedule.intervals.length ? a.schedule.intervals[a.schedule.intervals.length - 1].to : a.schedule.start,
          b.schedule.intervals.length ? b.schedule.intervals[b.schedule.intervals.length - 1].to : b.schedule.start,
        )
        if (!(overlapTo > overlapFrom)) continue
        // Walk the joint boundaries; any stretch where the two are not in the same
        // place (one moving counts as elsewhere) is a conflict.
        const cuts = new Set([overlapFrom])
        for (const interval of [...a.schedule.intervals, ...b.schedule.intervals]) {
          if (interval.from > overlapFrom && interval.from < overlapTo) cuts.add(interval.from)
          if (interval.to > overlapFrom && interval.to < overlapTo) cuts.add(interval.to)
        }
        const sorted = [...cuts].sort((left, right) => left - right)
        let open = null
        for (let index = 0; index < sorted.length; index += 1) {
          const from = sorted[index]
          const to = index + 1 < sorted.length ? sorted[index + 1] : overlapTo
          const probe = Number.isFinite(to) ? (from + to) / 2 : from + 1
          const placeA = placeAt(a.schedule, probe)
          const placeB = placeAt(b.schedule, probe)
          const same = placeA && placeB && (
            (a.mapPath === b.mapPath && placeA === placeB) ||
            (a.pinDocs.get(placeA) && a.pinDocs.get(placeA) === b.pinDocs.get(placeB))
          )
          if (!same) {
            if (open && open.to === from) open.to = to
            else {
              open = { kind: 'twoPlaces', doc, from, to, travelers: [a.schedule.travelerId, b.schedule.travelerId], maps: [a.mapPath, b.mapPath] }
              conflicts.push(open)
            }
          }
        }
      }
    }
  }
  return conflicts
}

/** Every conflict on one map: each schedule's own, and two-places ones within the map. */
export function mapConflicts(map, space, mapPath = '') {
  const schedules = buildSchedules(map, space)
  const pinDocs = new Map((map.pins || []).filter((pin) => pin.doc).map((pin) => [pin.id, pin.doc]))
  return [
    ...schedules.flatMap((schedule) => schedule.conflicts),
    ...crossScheduleConflicts(schedules.map((schedule) => ({ mapPath, schedule, pinDocs }))),
  ]
}

/** The span of days a map's journeys cover, for the scrubber: `{ from, to }`. */
export function timelineExtent(schedules, fallbackDay = 0) {
  let from = Infinity
  let to = -Infinity
  for (const schedule of schedules) {
    from = Math.min(from, schedule.start)
    to = Math.max(to, schedule.end)
  }
  if (!Number.isFinite(from)) return { from: fallbackDay, to: fallbackDay + 30 }
  if (to <= from) to = from + 1
  return { from, to }
}

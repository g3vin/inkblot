/**
 * useMapChronology — the map's side of the story's timeline: the events placed at its
 * pins that the day is inside (drawn on the map), and keeping the two in step:
 *
 *   - a leg moved from a timeline view is edited here, since this map owns its document
 *   - places tied to an event's start or end follow the event when it moves
 *   - events linked to a leg leave when the leg now leaves
 *
 * Returns the project's `timeline` and this map's `timelineEvents`.
 */
import { useEffect, useMemo } from 'react'
import { useStoryTimeline } from '../timeline/useStoryTimeline'
import { eventCovers, placeTarget, setEventTime } from '../lib/timeline/timelineModel'
import { peekStoryTimeline, replaceStoryTimeline } from '../lib/timeline/timelineStore'
import { MAP_SET_LEG_EVENT } from '../lib/timeline/journeys'
import { eventDay } from './inspector/whenSections'

export function useMapChronology({ projectName, docPath, map, mapRef, dispatch, day, schedules }) {
  // Timeline events placed at this map's pins, drawn while the day is inside them.
  const timeline = useStoryTimeline(projectName)
  const timelineEvents = useMemo(() => {
    if (!timeline) return []
    const laneColor = new Map(timeline.lanes.map((lane) => [lane.id, lane.color]))
    return timeline.events
      .filter((event) => placeTarget(event.place)?.map === docPath && eventCovers(event, day))
      .map((event) => {
        const target = placeTarget(event.place)
        return { id: event.id, title: event.title, kind: target.kind, item: target.id, color: event.color || laneColor.get(event.laneId) || null }
      })
  }, [day, docPath, timeline])

  // A leg moved from a timeline view: this map owns its document, so it makes the edit.
  useEffect(() => {
    const onSetLeg = (event) => {
      const { projectName: from, docPath: target, travelerId, legId, departDay } = event.detail || {}
      if (from !== projectName || target !== docPath) return
      const traveler = mapRef.current.travelers.find((item) => item.id === travelerId)
      if (!traveler?.legs.some((leg) => leg.id === legId)) return
      event.detail.claimed = true
      dispatch({
        type: 'items/patch',
        collection: 'travelers',
        patches: { [travelerId]: { legs: traveler.legs.map((leg) => (leg.id === legId ? { ...leg, departDay } : leg)) } },
      })
    }
    window.addEventListener(MAP_SET_LEG_EVENT, onSetLeg)
    return () => window.removeEventListener(MAP_SET_LEG_EVENT, onSetLeg)
  }, [dispatch, docPath, mapRef, projectName])

  // Places that come and go with an event: when the event moves, so do they.
  useEffect(() => {
    if (!timeline) return
    const events = new Map(timeline.events.map((event) => [event.id, event]))
    for (const collection of ['pins', 'routes', 'regions', 'labels']) {
      const patches = {}
      for (const item of map[collection]) {
        const patch = {}
        for (const [edge, key] of [['from', 'fromEvent'], ['until', 'untilEvent']]) {
          if (!item[key]) continue
          const next = eventDay(events.get(item[key]), edge)
          if (next !== null && next !== item[edge]) patch[edge] = next
        }
        if (Object.keys(patch).length) patches[item.id] = patch
      }
      if (Object.keys(patches).length) dispatch({ type: 'items/patch', collection, patches, meta: { upkeep: true, coalesce: 'follow-events' } })
    }
  }, [dispatch, map, timeline])

  // A leg moved here: events linked to it leave when it now leaves.
  useEffect(() => {
    const current = peekStoryTimeline(projectName)
    if (!current) return
    const departures = new Map()
    for (const schedule of schedules) {
      for (const interval of schedule.intervals) {
        if (interval.kind === 'travel') departures.set(`${schedule.travelerId}|${interval.legId}`, interval.from)
      }
    }
    const moves = []
    for (const event of current.events) {
      for (const link of event.links) {
        if (link.kind !== 'mapLeg' || link.map !== docPath) continue
        const depart = departures.get(`${link.traveler}|${link.leg}`)
        if (Number.isFinite(depart) && depart !== event.start) moves.push({ id: event.id, depart, length: event.end === null ? null : event.end - event.start })
      }
    }
    if (!moves.length) return
    void replaceStoryTimeline(projectName, (tl) =>
      moves.reduce((acc, move) => setEventTime(acc, move.id, move.depart, move.length === null ? null : move.depart + move.length), tl))
  }, [docPath, projectName, schedules])

  return { timeline, timelineEvents }
}

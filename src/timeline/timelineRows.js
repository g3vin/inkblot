/**
 * timelineRows.js — how a timeline view stacks events into lanes and rows.
 *
 * Lanes are the chronology's own (plotlines, points of view), then "No lane" for the
 * events in none, then one lane per map traveller when the view shows journeys. In a
 * lane, events that would overlap on screen — by their span or by their label — stack
 * into rows, greedily, in sequence order.
 */
import { eventMatchesFilter, eventById } from '../lib/timeline/timelineModel'

/** The lane names' column, left of the plot. */
export const GUTTER = 168
export const ROW_HEIGHT = 30
export const LANE_GAP = 10
export const LANE_HEADER = 22
export const NO_LANE = ''

/** A bar's least width on screen: a dot for a point, room for some of its title. */
export const itemMinWidth = (title) => Math.min(220, 28 + String(title || '').length * 6.4)

function pack(items, toX) {
  const rowEnds = []
  return items.map((item) => {
    const x0 = toX(item.start)
    const x1 = Math.max(toX(item.end), x0 + itemMinWidth(item.title))
    let row = rowEnds.findIndex((end) => end + 6 <= x0)
    if (row < 0) {
      row = rowEnds.length
      rowEnds.push(x1)
    } else rowEnds[row] = x1
    return { ...item, row }
  })
}

/**
 * The lanes a view draws, top to bottom: `[{ key, kind, laneId?, journey?, title,
 * color, collapsed, top, height, rows, items }]`. Items carry `{ id, start, end,
 * title, row, dated }` in axis units; `toX` turns a unit into pixels, which is what
 * decides what overlaps.
 */
export function buildLanes({ timeline, layout, view, journeys = [], toX }) {
  const filter = view.filter
  const collapsed = new Set(view.collapsedLanes)
  const laneFilter = filter.lanes.length ? new Set(filter.lanes) : null

  const lanes = [
    ...timeline.lanes.map((lane) => ({ key: `lane:${lane.id}`, kind: 'lane', laneId: lane.id, title: lane.name, color: lane.color })),
    { key: 'lane:', kind: 'lane', laneId: NO_LANE, title: timeline.lanes.length ? 'No lane' : 'Events', color: null },
  ].filter((lane) => !laneFilter || laneFilter.has(lane.laneId))

  const out = []
  let top = 0
  for (const lane of lanes) {
    const events = layout
      .map((item) => ({ item, event: eventById(timeline, item.id) }))
      .filter(({ event }) => (event.laneId || NO_LANE) === lane.laneId && eventMatchesFilter(event, filter))
      .map(({ item, event }) => ({ id: event.id, start: item.start, end: item.end, dated: item.dated, title: event.title }))
    // "No lane" with nothing in it is not worth a lane once there are others.
    if (lane.laneId === NO_LANE && !events.length && timeline.lanes.length && !laneFilter) continue
    const isCollapsed = collapsed.has(lane.key)
    const items = pack(events, toX)
    const rows = isCollapsed ? 0 : Math.max(1, ...items.map((item) => item.row + 1))
    const height = LANE_HEADER + rows * ROW_HEIGHT + LANE_GAP
    out.push({ ...lane, collapsed: isCollapsed, top, height, rows, items: isCollapsed ? [] : items })
    top += height
  }

  if (view.showJourneys && !filter.lanes.length) {
    const participants = filter.participants.length ? new Set(filter.participants) : null
    for (const journey of journeys) {
      if (participants && !participants.has(journey.doc)) continue
      const key = `journey:${journey.key}`
      const isCollapsed = collapsed.has(key)
      const items = isCollapsed ? [] : journey.intervals.map((interval, index) => ({
        id: `${journey.key}|${index}`,
        start: interval.from,
        end: interval.to,
        dated: true,
        title: interval.label,
        interval,
        row: 0,
      }))
      const height = LANE_HEADER + (isCollapsed ? 0 : ROW_HEIGHT) + LANE_GAP
      out.push({ key, kind: 'journey', journey, title: `${journey.name} · ${journey.mapName}`, color: journey.color, collapsed: isCollapsed, top, height, rows: isCollapsed ? 0 : 1, items })
      top += height
    }
  }

  return out
}

/** The lane whose band holds `y` (content pixels), or null. */
export const laneAt = (lanes, y) => lanes.find((lane) => y >= lane.top && y < lane.top + lane.height) || null

export const lanesHeight = (lanes) => (lanes.length ? lanes[lanes.length - 1].top + lanes[lanes.length - 1].height : 0)

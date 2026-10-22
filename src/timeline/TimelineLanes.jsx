/**
 * TimelineLanes.jsx — the chronology as lanes of events, and every drag on them.
 *
 * On a date axis:
 *   - drag a dated event to move it in time (its window goes with it); drag either
 *     end of a window to resize it — or the end of a moment to make it a window
 *   - drag up or down into another lane to move it there
 *   - drop a dated event on the Undated tray to take its date away
 *   - drag an undated event to reorder it; hold ⌥ as you drop to date it where it lands
 *   - drag a journey's leg to change when it leaves (its map is edited)
 * In sequence, every drag reorders. Let go over a canvas in the other pane and the
 * event goes onto it as a card instead.
 *
 * A drag previews the chronology everywhere (the editor's highlights, maps, other
 * views follow it live) and is committed, as one undo step, on release. Escape
 * cancels it.
 */
import { useMemo, useRef, useState } from 'react'
import { canvasSurfaceAt, dispatchCanvasDropTimelineEvent } from '../canvas/canvasEvents'
import { formatDay } from '../lib/map/calendar'
import { readLegDepart, setLegDepart } from '../lib/timeline/journeys'
import { eventById, isDated, moveEventBetween, setEventTime, updateEvent } from '../lib/timeline/timelineModel'
import { cancelTimelinePreview, previewStoryTimeline } from '../lib/timeline/timelineStore'
import { snapTo, snapUnit } from '../lib/timeline/timelineScale'
import { buildLanes, GUTTER, laneAt, lanesHeight, LANE_HEADER, NO_LANE, ROW_HEIGHT } from './timelineRows'
import { describeWhen } from './useTimelinePanel'
import { inkColor } from '../lib/palette'

const DRAG_THRESHOLD = 4

function eventColor(event, timeline) {
  if (event.color) return inkColor(event.color)
  const lane = timeline.lanes.find((item) => item.id === event.laneId)
  if (lane?.color) return inkColor(lane.color)
  const tag = timeline.tags.find((item) => event.tagIds.includes(item.id) && item.color)
  return tag ? inkColor(tag.color) : null
}

export default function TimelineLanes({
  projectName, timeline, calendar, view, axis, toX, toUnit, px, plotWidth, selection, onSelect, onAddAt, onRefreshMaps,
  patchView, layout, journeys, commit,
}) {
  const scrollRef = useRef(null)
  const trayRef = useRef(null)
  const [drag, setDrag] = useState(null)
  const [journeyShift, setJourneyShift] = useState(null)

  const lanes = useMemo(() => buildLanes({ timeline, layout, view, journeys, toX }), [journeys, layout, timeline, toX, view])
  const unit = axis === 'time' ? snapUnit(calendar, px) : 1

  /** Pointer → x in the plot and y in the (scrolled) lane content. */
  const locate = (clientX, clientY) => {
    const rect = scrollRef.current.getBoundingClientRect()
    return { x: clientX - rect.left - GUTTER, y: clientY - rect.top + scrollRef.current.scrollTop }
  }

  const overTray = (clientX, clientY) => {
    const rect = trayRef.current?.getBoundingClientRect()
    return Boolean(rect && clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom)
  }

  const startEventDrag = (item, mode) => (pointer) => {
    if (pointer.button !== 0) return
    pointer.stopPropagation()
    pointer.preventDefault()
    scrollRef.current?.closest('.timeline-surface')?.focus({ preventScroll: true })
    onSelect(item.id)
    const event = eventById(timeline, item.id)
    if (!event) return
    const baseLayout = layout.filter((placed) => placed.id !== event.id)
    const origin = { x: pointer.clientX, y: pointer.clientY }
    let moved = false
    let lastEdit = null
    let label = 'Move event'

    const edit = (move) => {
      const dx = (move.clientX - origin.x) / px
      const { x, y } = locate(move.clientX, move.clientY)
      const lane = laneAt(lanes, y)
      const laneId = lane?.kind === 'lane' ? lane.laneId || null : event.laneId
      let indicator = null
      let undating = false
      let fn
      if (mode === 'start' || mode === 'end') {
        const end = event.end ?? event.start
        label = 'Resize event'
        fn = mode === 'start'
          ? (tl) => setEventTime(tl, event.id, Math.min(snapTo(event.start + dx, unit), end - unit), end)
          : (tl) => setEventTime(tl, event.id, event.start, Math.max(snapTo(end + dx, unit), event.start + unit))
      } else if (axis === 'time' && isDated(event) && overTray(move.clientX, move.clientY)) {
        undating = true
        label = 'Remove date'
        fn = (tl) => setEventTime(tl, event.id, null)
      } else if (axis === 'time' && isDated(event)) {
        const start = snapTo(event.start + dx, unit)
        label = 'Move event'
        fn = (tl) => setEventTime(tl, event.id, start, event.end === null ? null : start + (event.end - event.start))
      } else if (axis === 'time' && move.altKey) {
        const start = snapTo(toUnit(x), unit)
        label = 'Date event'
        indicator = x
        fn = (tl) => setEventTime(tl, event.id, start, null)
      } else {
        // Reorder: after the last event left of the pointer, as things stood at the start.
        const at = toUnit(x)
        const before = baseLayout.filter((placed) => (placed.start + placed.end) / 2 <= at).pop() || null
        const first = baseLayout[0] || null
        label = 'Reorder event'
        indicator = x
        fn = (tl) => moveEventBetween(tl, event.id, before?.id ?? null, before ? null : first?.id ?? null)
      }
      const laneChanged = laneId !== (event.laneId || null) && !undating
      if (laneChanged && (mode === 'move')) {
        const inner = fn
        fn = (tl) => updateEvent(inner(tl), event.id, { laneId })
        if (label === 'Move event' && dx === 0) label = 'Move to lane'
      }
      return { fn, indicator, undating }
    }

    const onMove = (move) => {
      if (!moved && Math.hypot(move.clientX - origin.x, move.clientY - origin.y) < DRAG_THRESHOLD) return
      moved = true
      const { fn, indicator, undating } = edit(move)
      lastEdit = fn
      setDrag({ id: event.id, indicator, undating, dating: isDated(event) && axis === 'time' })
      previewStoryTimeline(projectName, fn)
    }
    const finish = (commitIt) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('keydown', onKey, true)
      setDrag(null)
      if (commitIt && moved && lastEdit) commit(label, lastEdit)
      else cancelTimelinePreview(projectName)
    }
    const onUp = (up) => {
      // Let go over a canvas: the event goes onto it as a card, and stays where it was.
      const canvas = moved ? canvasSurfaceAt(up.clientX, up.clientY) : null
      if (canvas) {
        finish(false)
        dispatchCanvasDropTimelineEvent(canvas, { eventId: event.id, clientX: up.clientX, clientY: up.clientY })
        return
      }
      finish(true)
    }
    const onCancel = () => finish(false)
    const onKey = (key) => {
      if (key.key !== 'Escape') return
      key.stopPropagation()
      finish(false)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onKey, true)
  }

  const startJourneyDrag = (lane, item) => (pointer) => {
    if (pointer.button !== 0 || item.interval.kind !== 'travel') return
    pointer.stopPropagation()
    pointer.preventDefault()
    const { journey } = lane
    const originX = pointer.clientX
    let delta = 0
    const onMove = (move) => {
      delta = snapTo((move.clientX - originX) / px, unit)
      setJourneyShift({ id: item.id, delta })
    }
    const onUp = async () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setJourneyShift(null)
      if (!delta) return
      const legId = item.interval.legId
      const next = item.interval.from + delta
      const old = await readLegDepart(projectName, journey.mapPath, journey.travelerId, legId)
      if (old === undefined) return
      const linked = timeline.events.filter((event) =>
        event.links.some((link) => link.kind === 'mapLeg' && link.map === journey.mapPath && link.traveler === journey.travelerId && link.leg === legId))
      if (linked.length) {
        // Moving the linked events moves the leg with them (timelineEdits.js).
        await commit('Move journey', (tl) => linked.reduce((acc, event) => setEventTime(acc, event.id, next, event.end === null ? null : next + (event.end - event.start)), tl))
      } else {
        await setLegDepart(projectName, journey.mapPath, journey.travelerId, legId, next)
        await commit('Move journey', (tl) => tl, [{
          redo: () => setLegDepart(projectName, journey.mapPath, journey.travelerId, legId, next),
          undo: () => setLegDepart(projectName, journey.mapPath, journey.travelerId, legId, old),
        }])
      }
      onRefreshMaps()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const onBodyDoubleClick = (pointer) => {
    if (pointer.target.closest('.timeline-event, .timeline-lane-head, .timeline-journey-item')) return
    const { x, y } = locate(pointer.clientX, pointer.clientY)
    if (x < 0) return
    const lane = laneAt(lanes, y)
    const laneId = lane?.kind === 'lane' ? lane.laneId || null : null
    onAddAt({ unit: axis === 'time' ? snapTo(toUnit(x), snapUnit(calendar, px)) : toUnit(x), laneId })
  }

  const toggleLane = (key) => {
    const collapsed = view.collapsedLanes.includes(key) ? view.collapsedLanes.filter((item) => item !== key) : [...view.collapsedLanes, key]
    patchView({ collapsedLanes: collapsed })
  }

  const renderEvent = (lane, item) => {
    const event = eventById(timeline, item.id)
    if (!event) return null
    const x0 = toX(item.start)
    const x1 = toX(item.end)
    const isPoint = item.start === item.end
    if (x1 < -300 || x0 > plotWidth + 300) return null
    const passages = event.links.filter((link) => link.kind === 'text').length
    const color = eventColor(event, timeline)
    const selected = selection === event.id
    const dated = axis === 'time' && item.dated
    const noteTicks = dated && !isPoint ? event.notes.filter((note) => note.at !== null && note.at >= item.start && note.at <= item.end) : []
    return (
      <div
        key={event.id}
        className={`timeline-event${isPoint ? ' is-point' : ' is-window'}${axis === 'time' && !item.dated ? ' is-undated' : ''}${selected ? ' is-selected' : ''}${drag?.id === event.id ? ' is-dragging' : ''}`}
        style={{ left: x0, top: LANE_HEADER + item.row * ROW_HEIGHT + 3, width: isPoint ? undefined : Math.max(6, x1 - x0), ...(color ? { '--event': color } : {}) }}
        onPointerDown={startEventDrag(item, 'move')}
        title={`${event.title || 'Untitled'}\n${describeWhen(event, calendar)}${event.summary ? `\n\n${event.summary}` : ''}`}
        role="button"
        aria-pressed={selected}
      >
        {dated && !isPoint ? <span className="timeline-event-edge is-start" onPointerDown={startEventDrag(item, 'start')} /> : null}
        {isPoint ? <span className="timeline-event-dot" /> : null}
        <span className="timeline-event-label">{event.title || 'Untitled'}</span>
        {passages || event.notes.length ? (
          <span className="timeline-event-badges">
            {passages ? <span title={`${passages} linked passage${passages === 1 ? '' : 's'}`}>¶{passages > 1 ? passages : ''}</span> : null}
            {event.notes.length ? <span title={`${event.notes.length} note${event.notes.length === 1 ? '' : 's'}`}>✎{event.notes.length > 1 ? event.notes.length : ''}</span> : null}
          </span>
        ) : null}
        {noteTicks.map((note) => <span key={note.id} className="timeline-note-tick" style={{ left: toX(note.at) - x0 }} title={note.text || 'Note'} />)}
        {dated ? <span className="timeline-event-edge is-end" onPointerDown={startEventDrag(item, 'end')} title={isPoint ? 'Drag to make this a span of time' : undefined} /> : null}
      </div>
    )
  }

  const renderJourneyItem = (lane, item) => {
    const shift = journeyShift?.id === item.id ? journeyShift.delta : 0
    const x0 = toX(item.start + shift)
    const x1 = toX(item.end + shift)
    if (x1 < -300 || x0 > plotWidth + 300) return null
    const travel = item.interval.kind === 'travel'
    return (
      <div
        key={item.id}
        className={`timeline-journey-item${travel ? ' is-travel' : ' is-stay'}`}
        style={{ left: x0, width: Math.max(4, x1 - x0), top: LANE_HEADER + 5, ...(lane.color ? { '--event': inkColor(lane.color) } : {}) }}
        title={`${item.title}\n${formatDay(calendar, item.start, { withTime: true })} → ${formatDay(calendar, item.end, { withTime: true })}${travel ? '\nDrag to change when this leg leaves' : ''}`}
        onPointerDown={travel ? startJourneyDrag(lane, item) : undefined}
      >
        <span className="timeline-event-label">{item.title}</span>
      </div>
    )
  }

  const undatedCount = axis === 'time' ? layout.filter((item) => !item.dated).length : 0

  return (
    <div
      ref={scrollRef}
      className="timeline-lanes"
      onDoubleClick={onBodyDoubleClick}
      onPointerDown={(pointer) => {
        if (!pointer.target.closest('.timeline-event, .timeline-journey-item, .timeline-lane-head')) onSelect(null)
      }}
    >
      <div className="timeline-lanes-content" style={{ height: lanesHeight(lanes) + 48 }}>
        {lanes.map((lane) => (
          <div key={lane.key} className={`timeline-lane is-${lane.kind}${lane.collapsed ? ' is-collapsed' : ''}`} style={{ top: lane.top, height: lane.height }}>
            <button type="button" className="timeline-lane-head" onClick={() => toggleLane(lane.key)} title={lane.collapsed ? 'Show this lane' : 'Fold this lane away'}>
              <span className="timeline-lane-chevron">{lane.collapsed ? '▸' : '▾'}</span>
              {lane.color ? <span className="timeline-lane-swatch" style={{ background: inkColor(lane.color) }} /> : null}
              <span className="timeline-lane-title">{lane.title}</span>
              <span className="timeline-lane-count">{lane.kind === 'lane' ? timeline.events.filter((event) => (event.laneId || NO_LANE) === lane.laneId).length : ''}</span>
            </button>
            <div className="timeline-lane-body" style={{ left: GUTTER }}>
              {lane.items.map((item) => (lane.kind === 'journey' ? renderJourneyItem(lane, item) : renderEvent(lane, item)))}
            </div>
          </div>
        ))}
      </div>
      {drag?.indicator !== null && drag?.indicator !== undefined ? <div className="timeline-drop-line" style={{ left: GUTTER + drag.indicator }} /> : null}
      {axis === 'time' && (drag?.dating || undatedCount) ? (
        <div ref={trayRef} className={`timeline-undated-tray${drag?.undating ? ' is-over' : ''}${drag?.dating ? ' is-target' : ''}`}>
          {drag?.dating
            ? 'Drop here to take the date away'
            : `${undatedCount} undated — shown in order between the dated events. Hold ⌥ while dragging one to date it.`}
        </div>
      ) : null}
    </div>
  )
}

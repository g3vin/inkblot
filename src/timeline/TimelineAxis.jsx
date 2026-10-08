/**
 * TimelineAxis.jsx — the ruler along the top of a timeline view, and what runs the
 * full height of it: era bands, the story's "now", and the time lens.
 *
 *   ticks   in the project calendar (timelineScale.js), or numbered positions
 *   now     the day every map and view is looking at; press or drag on the ruler to
 *           move it (a date axis only)
 *   lens    the window the editor highlights passages in; while the lens is being
 *           edited, drag it to move it and its edges to resize it
 */
import { useRef } from 'react'
import { calendarTicks, sequenceTicks, snapTo, snapUnit } from '../lib/timeline/timelineScale'
import { formatDay } from '../lib/map/calendar'
import { inkColor, inkVar } from '../lib/palette'
import { effectiveLens } from '../lib/timeline/timelineModel'

export const AXIS_HEIGHT = 40

export default function TimelineAxis({ timeline, calendar, axis, toX, toUnit, px, plotWidth, cursor, onScrub, onLens, view }) {
  const trackRef = useRef(null)
  const dragRef = useRef(null)
  const from = toUnit(0)
  const to = toUnit(plotWidth)
  const ticks = axis === 'time' ? calendarTicks(calendar, from, to, px) : sequenceTicks(from, to, px)
  const unit = axis === 'time' ? snapUnit(calendar, px) : 1
  const placed = cursor.lens.on ? effectiveLens(timeline, cursor.lens) : null
  const lens = placed && placed.scale === axis ? placed : null
  const showEras = axis === 'time' && view.scale !== 'manuscript'

  const unitAt = (clientX) => {
    const rect = trackRef.current.getBoundingClientRect()
    return toUnit(clientX - rect.left)
  }

  const startDrag = (kind) => (event) => {
    if (event.button !== 0) return
    event.stopPropagation()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const at = unitAt(event.clientX)
    dragRef.current = { kind, at, lens: lens ? { from: lens.from, to: lens.to } : null }
    if (kind === 'scrub') onScrub(snapTo(at, unit))
  }

  const onMove = (event) => {
    const drag = dragRef.current
    if (!drag) return
    const at = unitAt(event.clientX)
    if (drag.kind === 'scrub') {
      onScrub(snapTo(at, unit))
      return
    }
    const delta = snapTo(at - drag.at, unit)
    if (drag.kind === 'lens') onLens({ from: drag.lens.from + delta, to: drag.lens.to + delta })
    else if (drag.kind === 'lens-from') onLens({ from: Math.min(drag.lens.from + delta, drag.lens.to - unit), to: drag.lens.to })
    else if (drag.kind === 'lens-to') onLens({ from: drag.lens.from, to: Math.max(drag.lens.to + delta, drag.lens.from + unit) })
  }

  const endDrag = () => {
    dragRef.current = null
  }

  const nowX = axis === 'time' && Number.isFinite(cursor.day) ? toX(cursor.day) : null

  return (
    <>
      <div className="timeline-axis" style={{ height: AXIS_HEIGHT }}>
        <div className="timeline-axis-corner">{axis === 'time' ? calendarName(calendar) : 'In order'}</div>
        <div
          ref={trackRef}
          className={`timeline-axis-track${axis === 'time' ? ' can-scrub' : ''}`}
          onPointerDown={axis === 'time' ? startDrag('scrub') : undefined}
          onPointerMove={onMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          title={axis === 'time' ? 'Press or drag to move the story’s “now”' : undefined}
        >
          {showEras ? timeline.eras.map((era) => {
            const x0 = Math.max(0, toX(era.start))
            const x1 = Math.min(plotWidth, toX(era.end))
            if (x1 <= x0) return null
            return (
              <div key={era.id} className="timeline-era-label" style={{ left: x0, width: x1 - x0, '--era': inkColor(era.color, inkVar('amber')) }} title={`${era.name}: ${formatDay(calendar, era.start)} – ${formatDay(calendar, era.end)}`}>
                {era.name}
              </div>
            )
          }) : null}
          {ticks.map((tick) => (
            <div key={`${tick.at}`} className="timeline-tick" style={{ left: toX(tick.at) }}>
              <span>{tick.label}</span>
            </div>
          ))}
          {nowX !== null && nowX >= 0 && nowX <= plotWidth ? (
            <div className="timeline-now-head" style={{ left: nowX }} title={formatDay(calendar, cursor.day, { withTime: true })} />
          ) : null}
        </div>
      </div>

      <div className="timeline-overlay" style={{ top: AXIS_HEIGHT }}>
        {showEras ? timeline.eras.map((era) => {
          const x0 = Math.max(0, toX(era.start))
          const x1 = Math.min(plotWidth, toX(era.end))
          return x1 > x0 ? <div key={era.id} className="timeline-era-band" style={{ left: x0, width: x1 - x0, '--era': inkColor(era.color, inkVar('amber')) }} /> : null
        }) : null}
        {lens ? (
          <div
            className={`timeline-lens${lens.editing ? ' is-editing' : ''}`}
            style={{ left: toX(lens.from), width: Math.max(2, toX(lens.to) - toX(lens.from)) }}
            onPointerDown={lens.editing ? startDrag('lens') : undefined}
            onPointerMove={onMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            title={lens.editing ? 'Drag to move the lens; drag an edge to resize it' : 'Passages in this window are highlighted in the editor'}
          >
            {lens.editing ? (
              <>
                <span className="timeline-lens-edge is-from" onPointerDown={startDrag('lens-from')} />
                <span className="timeline-lens-edge is-to" onPointerDown={startDrag('lens-to')} />
              </>
            ) : null}
          </div>
        ) : null}
        {nowX !== null && nowX >= 0 && nowX <= plotWidth ? <div className="timeline-now-line" style={{ left: nowX }} /> : null}
      </div>
    </>
  )
}

function calendarName(calendar) {
  if (calendar?.mode === 'gregorian') return 'Dates'
  if (calendar?.mode === 'custom') return calendar.custom?.era ? `Calendar (${calendar.custom.era})` : 'Calendar'
  return 'Story days'
}

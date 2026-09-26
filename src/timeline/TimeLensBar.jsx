/**
 * TimeLensBar.jsx — the time lens, over a document.
 *
 * A slim bar across the top of a text pane while the lens is on: the whole chronology
 * as a track, a tick per event, and the lens's window over it. Every passage attached
 * to an event inside the window is lit in the text below, the rest fade. With "Move"
 * on, drag the window to slide it through the story, or its edges to widen it — the
 * highlights follow as it goes. The same lens shows in every timeline view.
 */
import { useMemo, useRef } from 'react'
import { formatDay } from '../lib/map/calendar'
import { setRangeEditing, setTimeLens } from '../lib/timeline/storyCursor'
import { effectiveLens, eventsInWindow } from '../lib/timeline/timelineModel'
import { snapTo } from '../lib/timeline/timelineScale'
import { useStoryCalendar } from '../map/useMapProject'
import { useStoryCursor, useStoryTimeline } from './useStoryTimeline'
import './Timeline.css'

export default function TimeLensBar({ projectName }) {
  const timeline = useStoryTimeline(projectName)
  const cursor = useStoryCursor(projectName)
  const [calendar] = useStoryCalendar(projectName)
  const trackRef = useRef(null)
  const lens = cursor.lens

  const lensWindow = useMemo(() => (timeline ? effectiveLens(timeline, lens) : null), [lens, timeline])
  const covered = timeline && lensWindow ? eventsInWindow(timeline, lensWindow).length : 0

  if (!lens.on || !timeline || !lensWindow) return null

  const { scale, layout, extent: [from, to] } = lensWindow

  const span = Math.max(to - from, 1e-6)
  const pct = (unit) => `${((unit - from) / span) * 100}%`
  const unitAt = (clientX) => {
    const rect = trackRef.current.getBoundingClientRect()
    return from + ((clientX - rect.left) / Math.max(rect.width, 1)) * span
  }
  const step = scale === 'sequence' ? 1 : span > 3650 ? 30 : 1

  const startDrag = (kind) => (pointer) => {
    if (!lens.editing || pointer.button !== 0) return
    pointer.preventDefault()
    pointer.stopPropagation()
    const start = unitAt(pointer.clientX)
    const base = { from: lensWindow.from, to: lensWindow.to }
    const onMove = (move) => {
      const delta = snapTo(unitAt(move.clientX) - start, step)
      if (kind === 'move') setTimeLens(projectName, { scale, from: base.from + delta, to: base.to + delta }, 'lens-bar')
      else if (kind === 'from') setTimeLens(projectName, { scale, from: Math.min(base.from + delta, base.to - step), to: base.to }, 'lens-bar')
      else setTimeLens(projectName, { scale, from: base.from, to: Math.max(base.to + delta, base.from + step) }, 'lens-bar')
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // Clicking the track (editing) centres the window there.
  const onTrackDown = (pointer) => {
    if (!lens.editing || pointer.target !== trackRef.current) return
    const at = unitAt(pointer.clientX)
    const half = (lensWindow.to - lensWindow.from) / 2
    setTimeLens(projectName, { scale, from: snapTo(at - half, step), to: snapTo(at + half, step) }, 'lens-bar')
  }

  const label = scale === 'sequence'
    ? `Events ${Math.max(1, Math.ceil(lensWindow.from + 0.5))}–${Math.max(1, Math.floor(lensWindow.to + 0.5) + 1)}`
    : `${formatDay(calendar, lensWindow.from)} – ${formatDay(calendar, lensWindow.to)}`

  return (
    <div className="timeline-lens-bar" role="group" aria-label="Time lens">
      <span title="Passages attached to events in this window are highlighted">Lens</span>
      <div ref={trackRef} className="timeline-lens-track" onPointerDown={onTrackDown}>
        {layout.map((item) => <span key={item.id} className="timeline-lens-mark" style={{ left: pct(item.start) }} />)}
        <div
          className={`timeline-lens-window${lens.editing ? ' is-editing' : ''}`}
          style={{ left: pct(Math.max(from, lensWindow.from)), width: `${(Math.max(0, Math.min(to, lensWindow.to) - Math.max(from, lensWindow.from)) / span) * 100}%` }}
          onPointerDown={startDrag('move')}
        >
          {lens.editing ? (
            <>
              <span className="timeline-lens-edge is-from" onPointerDown={startDrag('from')} />
              <span className="timeline-lens-edge is-to" onPointerDown={startDrag('to')} />
            </>
          ) : null}
        </div>
      </div>
      <span style={{ whiteSpace: 'nowrap' }}>{label} · {covered} event{covered === 1 ? '' : 's'}</span>
      <button type="button" className={lens.editing ? 'is-active' : ''} aria-pressed={lens.editing} title="Drag the window to move it through the story" onClick={() => setTimeLens(projectName, { scale: lensWindow.scale, from: lensWindow.from, to: lensWindow.to, editing: !lens.editing }, 'lens-bar')}>
        Move
      </button>
      <button type="button" className={cursor.editingRanges ? 'is-active' : ''} aria-pressed={cursor.editingRanges} title="Show handles to drag where each passage starts and stops" onClick={() => setRangeEditing(projectName, !cursor.editingRanges, 'lens-bar')}>
        Passages
      </button>
      <button type="button" title="Hide the time lens" aria-label="Hide the time lens" onClick={() => setTimeLens(projectName, { on: false, editing: false }, 'lens-bar')}>
        ×
      </button>
    </div>
  )
}

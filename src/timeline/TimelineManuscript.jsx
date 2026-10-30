/**
 * TimelineManuscript.jsx — the manuscript against the chronology.
 *
 * Along the top, the book as a reader meets it: chapters in order, and in each the
 * passages attached to events, evenly spaced. Along the bottom, the chronology, on the
 * same axis as the view's ruler (zoom and pan move it; reading order stays put). A line
 * joins every passage to when it happens, so the shape of the telling is visible:
 *
 *   straight-ish, left to right   the story told in order
 *   running back left             a flashback (and the passage is marked)
 *   leaping far right             a flash-forward, past events told only later
 *
 * Click a passage to go to it; click an event to edit it; drag an event along the
 * chronology to move it — every passage's line follows, here and everywhere.
 */
import { useMemo, useRef, useState } from 'react'
import { GESTURE } from '../ui/physics.js'
import { canvasSurfaceAt, dispatchCanvasDropTimelineEvent } from '../canvas/canvasEvents'
import { getDocDisplayName } from '../lib/docKind'
import { formatDay } from '../lib/map/calendar'
import { eventById, isDated, moveEventBetween, setEventTime } from '../lib/timeline/timelineModel'
import { cancelTimelinePreview, previewStoryTimeline } from '../lib/timeline/timelineStore'
import { snapTo, snapUnit } from '../lib/timeline/timelineScale'
import { GUTTER } from './timelineRows'
import { inkColor } from '../lib/palette'

const CHAPTER_Y = 10
const CHAPTER_H = 26
const PASSAGE_Y = 64
const CHRONO_Y = 250
const HEIGHT = 330

const JUMP_LABELS = { back: 'Flashback', forward: 'Flash-forward' }

export default function TimelineManuscript({
  projectName, timeline, calendar, axis, toX, toUnit, px, plotWidth, selection, onSelect, layout, threads, manuscriptDocs,
  onJumpToPassage, commit,
}) {
  const rootRef = useRef(null)
  const [hover, setHover] = useState(null)
  const count = threads.length
  const step = count ? plotWidth / count : plotWidth
  const passageX = (index) => (index + 0.5) * step

  const chapters = useMemo(() => {
    const out = []
    threads.forEach((thread, index) => {
      const last = out[out.length - 1]
      if (last && last.doc === thread.doc) last.to = index
      else out.push({ doc: thread.doc, from: index, to: index, first: thread })
    })
    return out
  }, [threads])

  const told = useMemo(() => new Set(threads.map((thread) => thread.eventId)), [threads])
  const jumps = useMemo(() => ({
    back: threads.filter((thread) => thread.jump === 'back').length,
    forward: threads.filter((thread) => thread.jump === 'forward').length,
  }), [threads])

  const startDrag = (item) => (pointer) => {
    if (pointer.button !== 0) return
    pointer.stopPropagation()
    pointer.preventDefault()
    onSelect(item.id)
    const event = eventById(timeline, item.id)
    if (!event) return
    const originX = pointer.clientX
    const base = layout.filter((placed) => placed.id !== event.id)
    const unit = axis === 'time' ? snapUnit(calendar, px) : 1
    let moved = false
    let lastEdit = null
    let label = 'Move event'
    const onMove = (move) => {
      if (!moved && Math.abs(move.clientX - originX) < GESTURE.slop.pointer) return
      moved = true
      const dx = (move.clientX - originX) / px
      if (axis === 'time' && isDated(event)) {
        const start = snapTo(event.start + dx, unit)
        lastEdit = (tl) => setEventTime(tl, event.id, start, event.end === null ? null : start + (event.end - event.start))
      } else {
        const at = item.start + dx
        const before = base.filter((placed) => placed.start <= at).pop() || null
        label = 'Reorder event'
        lastEdit = (tl) => moveEventBetween(tl, event.id, before?.id ?? null, before ? null : base[0]?.id ?? null)
      }
      previewStoryTimeline(projectName, lastEdit)
    }
    const onUp = (up) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      const canvas = moved ? canvasSurfaceAt(up.clientX, up.clientY) : null
      if (canvas) {
        cancelTimelinePreview(projectName)
        dispatchCanvasDropTimelineEvent(canvas, { eventId: event.id, clientX: up.clientX, clientY: up.clientY })
      } else if (moved && lastEdit) commit(label, lastEdit)
      else cancelTimelinePreview(projectName)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  const eventX = (thread) => toX(thread.at)
  const active = hover || selection

  // Event labels under the chronology, stacked into rows so near events do not overprint,
  // and kept inside the plot at its edges.
  const labels = useMemo(() => {
    const rowEnds = []
    const out = new Map()
    const placed = layout
      .map((item) => ({ item, x: toX(item.start), event: eventById(timeline, item.id) }))
      .filter(({ event, x }) => event && x >= -200 && x <= plotWidth + 200)
      .sort((a, b) => a.x - b.x)
    for (const { item, x, event } of placed) {
      const width = 12 + (event.title || 'Untitled').length * 6.2
      const center = Math.min(Math.max(x, width / 2), plotWidth - width / 2)
      let row = rowEnds.findIndex((end) => end + 8 <= center - width / 2)
      if (row < 0) {
        row = rowEnds.length
        rowEnds.push(center + width / 2)
      } else rowEnds[row] = center + width / 2
      out.set(item.id, { offset: center - x, top: 12 + row * 16 })
    }
    return out
  }, [layout, plotWidth, timeline, toX])
  const laneColor = useMemo(() => new Map(timeline.lanes.map((lane) => [lane.id, lane.color])), [timeline])

  return (
    <div ref={rootRef} className="timeline-manuscript" onPointerDown={(pointer) => {
      if (!pointer.target.closest('.timeline-ms-event, .timeline-ms-passage, .timeline-ms-chapter')) onSelect(null)
    }}>
      <div className="timeline-ms-content" style={{ height: HEIGHT }}>
        <div className="timeline-ms-gutter">
          <div style={{ top: CHAPTER_Y + 4 }}>Manuscript</div>
          <div style={{ top: PASSAGE_Y - 8 }}>Passages</div>
          <div style={{ top: CHRONO_Y - 8 }}>Happens</div>
          {count ? (
            <div className="timeline-ms-summary" style={{ top: CHRONO_Y + 40 }}>
              {jumps.back ? <span className="is-back">{jumps.back} flashback{jumps.back === 1 ? '' : 's'}</span> : null}
              {jumps.forward ? <span className="is-forward">{jumps.forward} flash-forward{jumps.forward === 1 ? '' : 's'}</span> : null}
              {!jumps.back && !jumps.forward ? <span>Told in order</span> : null}
            </div>
          ) : null}
        </div>

        <div className="timeline-ms-plot" style={{ left: GUTTER }}>
          <svg className="timeline-ms-lines" width={plotWidth} height={HEIGHT} aria-hidden="true">
            {threads.map((thread, index) => {
              const x1 = passageX(index)
              const x2 = eventX(thread)
              const mid = (PASSAGE_Y + CHRONO_Y) / 2
              const lit = active && (active === thread.eventId || active === thread.id)
              return (
                <path
                  key={thread.id}
                  d={`M ${x1} ${PASSAGE_Y + 6} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${CHRONO_Y - 6}`}
                  className={`timeline-ms-line${thread.jump ? ` is-${thread.jump}` : ''}${lit ? ' is-lit' : ''}${active && !lit ? ' is-dim' : ''}`}
                />
              )
            })}
            <line x1={0} x2={plotWidth} y1={CHRONO_Y} y2={CHRONO_Y} className="timeline-ms-baseline" />
          </svg>

          {chapters.map((chapter) => (
            <button
              key={`${chapter.doc}:${chapter.from}`}
              type="button"
              className="timeline-ms-chapter"
              style={{ left: chapter.from * step + 2, width: Math.max(8, (chapter.to - chapter.from + 1) * step - 4), top: CHAPTER_Y, height: CHAPTER_H }}
              title={`${getDocDisplayName(chapter.doc)} — open`}
              onClick={() => onJumpToPassage(chapter.first.eventId, chapter.doc, chapter.first.id)}
            >
              {getDocDisplayName(chapter.doc)}
            </button>
          ))}

          {threads.map((thread, index) => {
            const event = eventById(timeline, thread.eventId)
            return (
              <button
                key={thread.id}
                type="button"
                className={`timeline-ms-passage${thread.jump ? ` is-${thread.jump}` : ''}${active === thread.eventId || active === thread.id ? ' is-lit' : ''}`}
                style={{ left: passageX(index), top: PASSAGE_Y }}
                onPointerEnter={() => setHover(thread.id)}
                onPointerLeave={() => setHover(null)}
                onClick={() => onJumpToPassage(thread.eventId, thread.doc, thread.id)}
                title={`${JUMP_LABELS[thread.jump] ? `${JUMP_LABELS[thread.jump]} · ` : ''}${event?.title || 'Untitled'}\n“${thread.anchor.slice(0, 140)}${thread.anchor.length > 140 ? '…' : ''}”\n${getDocDisplayName(thread.doc)} — click to go there`}
                aria-label={`Passage in ${getDocDisplayName(thread.doc)}: ${event?.title || 'Untitled'}`}
              >
                {thread.jump ? <span className="timeline-ms-jump">{thread.jump === 'back' ? '↶' : '↷'}</span> : null}
              </button>
            )
          })}

          {layout.map((item) => {
            const event = eventById(timeline, item.id)
            if (!event) return null
            const x = toX(item.start)
            if (x < -200 || x > plotWidth + 200) return null
            const isTold = told.has(event.id)
            const lit = active === event.id
            return (
              <div
                key={event.id}
                className={`timeline-ms-event${isTold ? '' : ' is-untold'}${selection === event.id ? ' is-selected' : ''}${lit ? ' is-lit' : ''}`}
                style={{ left: x, top: CHRONO_Y, ...((event.color || laneColor.get(event.laneId)) ? { '--event': inkColor(event.color || laneColor.get(event.laneId)) } : {}) }}
                onPointerDown={startDrag(item)}
                onPointerEnter={() => setHover(event.id)}
                onPointerLeave={() => setHover(null)}
                title={`${event.title || 'Untitled'}\n${isDated(event) ? formatDay(calendar, event.start) : 'Undated'}${isTold ? '' : '\nNo passage tells this yet'}`}
              >
                <span className="timeline-ms-event-dot" />
                <span className="timeline-ms-event-label" style={{ top: labels.get(event.id)?.top ?? 12, marginLeft: labels.get(event.id)?.offset ?? 0 }}>{event.title || 'Untitled'}</span>
              </div>
            )
          })}

          {!manuscriptDocs.length ? null : <div className="timeline-ms-axis-note" style={{ top: CHRONO_Y + 64 }}>{toUnit && axis === 'sequence' ? 'Nothing is dated yet, so the chronology is shown in order.' : ''}</div>}
        </div>
      </div>
    </div>
  )
}

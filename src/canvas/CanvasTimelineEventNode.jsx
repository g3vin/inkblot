/**
 * CanvasTimelineEventNode.jsx — a timeline event on a canvas.
 *
 * The card is a window onto the event, not a copy of it: its title, when it happens,
 * its lane and summary are read from the project's chronology as they are now, so
 * moving the event in a timeline view redates the card here in the same frame.
 * Double-click shows the event in the timeline.
 */
import { formatDay } from '../lib/map/calendar'
import { eventById, isDated } from '../lib/timeline/timelineModel'
import { useStoryCalendar } from '../map/useMapProject'
import { requestTimelineReveal } from '../timeline/timelineEvents'
import { useStoryTimeline } from '../timeline/useStoryTimeline'

export default function CanvasTimelineEventNode({ node, projectName }) {
  const timeline = useStoryTimeline(projectName)
  const [calendar] = useStoryCalendar(projectName)
  const event = timeline ? eventById(timeline, node.inkblotTimelineEventId) : null
  const lane = event && timeline.lanes.find((item) => item.id === event.laneId)
  const color = event?.color || lane?.color || null

  if (!timeline) return <div className="canvas-doc canvas-timeline-event" />
  if (!event) {
    return (
      <div className="canvas-doc canvas-timeline-event is-missing">
        <div className="canvas-doc-header">
          <span className="canvas-doc-title">Event not found</span>
          <span className="canvas-doc-kind">timeline</span>
        </div>
        <div className="canvas-doc-body">It was deleted from the timeline.</div>
      </div>
    )
  }

  const when = isDated(event)
    ? event.end === null ? formatDay(calendar, event.start) : `${formatDay(calendar, event.start)} – ${formatDay(calendar, event.end)}`
    : 'Undated'

  return (
    <div
      className="canvas-doc canvas-timeline-event"
      style={color ? { borderTop: `3px solid ${color}` } : undefined}
      onDoubleClick={(pointer) => {
        pointer.stopPropagation()
        requestTimelineReveal(event.id)
      }}
      title="Double-click to show in the timeline"
    >
      <div className="canvas-doc-header">
        <span className="canvas-doc-title">{event.title || 'Untitled'}</span>
        <span className="canvas-doc-kind">{lane?.name || 'event'}</span>
      </div>
      <div className="canvas-doc-body">
        <div style={{ fontWeight: 600, fontSize: 12, color: color || 'var(--text-muted)' }}>{when}</div>
        {event.summary ? <div style={{ marginTop: 4 }}>{event.summary}</div> : null}
      </div>
    </div>
  )
}

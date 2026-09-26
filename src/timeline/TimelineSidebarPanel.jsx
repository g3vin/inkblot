/**
 * TimelineSidebarPanel.jsx — the timeline beside a document, in the right sidebar.
 *
 * What the document in front of the writer has to do with the chronology: every
 * passage in it attached to an event, in reading order, with when it happens (and a
 * mark where the telling jumps back or ahead). Click one to go to it; the event's name
 * shows it in a timeline view. Below: attach the selection to an event, and the time
 * lens and passage handles, switched on and off.
 */
import { useEffect, useMemo, useState } from 'react'
import { getTimelineAnchors, removeTimelineRanges, TIMELINE_ANCHORS_KEY } from '../extensions/TimelineAnchors'
import { attachSelectionToEvent, revealPassage } from '../hooks/useEditorTimeline'
import { isTextDoc } from '../lib/docKind'
import { setRangeEditing, setTimeLens } from '../lib/timeline/storyCursor'
import { eventById, manuscriptThreads, sortedEvents } from '../lib/timeline/timelineModel'
import { useStoryCalendar } from '../map/useMapProject'
import { requestTimelineReveal } from './timelineEvents'
import { describeWhen } from './useTimelinePanel'
import { useStoryCursor, useStoryTimeline } from './useStoryTimeline'
import './Timeline.css'

/** The editor's ranges, as React state that follows every transaction. */
function useEditorRanges(editor, docPath) {
  const [ranges, setRanges] = useState([])
  useEffect(() => {
    if (!editor || editor.isDestroyed) {
      setRanges([])
      return undefined
    }
    const read = () => {
      const state = getTimelineAnchors(editor)
      setRanges(state.docPath === docPath ? state.ranges : [])
    }
    read()
    const onTransaction = ({ transaction }) => {
      if (transaction.docChanged || transaction.getMeta(TIMELINE_ANCHORS_KEY)) read()
    }
    editor.on('transaction', onTransaction)
    return () => {
      if (!editor.isDestroyed) editor.off('transaction', onTransaction)
    }
  }, [docPath, editor])
  return ranges
}

export default function TimelineSidebarPanel({ projectName, docPath, editor }) {
  const timeline = useStoryTimeline(projectName)
  const cursor = useStoryCursor(projectName)
  const [calendar] = useStoryCalendar(projectName)
  const ranges = useEditorRanges(editor, docPath)
  const [choice, setChoice] = useState('')

  const threads = useMemo(
    () => (timeline ? manuscriptThreads(timeline, ranges.map((range) => ({ ...range, doc: docPath })), { scale: 'sequence' }) : []),
    [docPath, ranges, timeline]
  )

  if (!projectName || !docPath || !isTextDoc(docPath)) {
    return <div className="timeline-side is-empty">Open a document to see where it sits in the timeline.</div>
  }
  if (!timeline) return <div className="timeline-side is-empty">Loading…</div>

  const attach = async () => {
    await attachSelectionToEvent({ editor, projectName, docPath, eventId: choice || null })
    setChoice('')
  }
  const hasSelection = Boolean(editor && !editor.isDestroyed && !editor.state.selection.empty)

  return (
    <div className="timeline-side">
      <section>
        <h3>In this document</h3>
        {!threads.length ? (
          <p className="timeline-side-hint">Nothing here is attached to the timeline yet. Select a passage and attach it to an event below.</p>
        ) : (
          <ol className="timeline-side-list">
            {threads.map((thread) => {
              const event = eventById(timeline, thread.eventId)
              return (
                <li key={thread.id} className={thread.jump ? `is-${thread.jump}` : ''}>
                  <button type="button" className="timeline-side-passage" onClick={() => revealPassage(editor, thread.eventId, thread.id)} title={`“${thread.anchor}”`}>
                    <span className="timeline-side-anchor">“{thread.anchor.slice(0, 80)}{thread.anchor.length > 80 ? '…' : ''}”</span>
                  </button>
                  <div className="timeline-side-event">
                    <button type="button" className="timeline-side-link" onClick={() => requestTimelineReveal(thread.eventId)} title="Show in the timeline">
                      {event?.title || 'Untitled'}
                    </button>
                    <span className="timeline-side-when">{event ? describeWhen(event, calendar) : ''}</span>
                    {thread.jump ? <span className="timeline-side-jump">{thread.jump === 'back' ? '↶ flashback' : '↷ flash-forward'}</span> : null}
                    <button type="button" className="timeline-side-remove" onClick={() => removeTimelineRanges(editor, [thread.id])} title="Detach this passage" aria-label="Detach this passage">×</button>
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </section>

      <section>
        <h3>Attach the selection</h3>
        <select value={choice} onChange={(event) => setChoice(event.target.value)} aria-label="Event">
          <option value="">A new event</option>
          {sortedEvents(timeline).map((event) => <option key={event.id} value={event.id}>{event.title || 'Untitled'}</option>)}
        </select>
        <button type="button" disabled={!hasSelection} onClick={attach}>Attach</button>
      </section>

      <section className="timeline-side-toggles">
        <label>
          <input type="checkbox" checked={Boolean(cursor.lens.on)} onChange={(event) => setTimeLens(projectName, { on: event.target.checked }, 'sidebar')} />
          Time lens — highlight passages in a window of time
        </label>
        <label>
          <input type="checkbox" checked={Boolean(cursor.editingRanges)} onChange={(event) => setRangeEditing(projectName, event.target.checked, 'sidebar')} />
          Show handles to drag where passages start and end
        </label>
      </section>
    </div>
  )
}

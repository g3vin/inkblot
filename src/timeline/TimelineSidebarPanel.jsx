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
import { Button, EmptyState, FormRow, IconButton, Section, SelectMenu, Toggle } from '../ui'
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
    return <EmptyState icon="timeline" title="No document open." hint="Open a document to see where it sits in the timeline." />
  }
  if (!timeline) return <EmptyState compact title="Loading the timeline…" />

  const attach = async () => {
    await attachSelectionToEvent({ editor, projectName, docPath, eventId: choice || null })
    setChoice('')
  }
  const hasSelection = Boolean(editor && !editor.isDestroyed && !editor.state.selection.empty)
  const events = [{ value: '', label: 'A new event' }, ...sortedEvents(timeline).map((event) => ({ value: event.id, label: event.title || 'Untitled' }))]

  return (
    <div className="timeline-side" data-help="timeline.panel">
      <Section id="timeline.passages" title="In this document" help="timeline.passages">
        {!threads.length ? (
          <EmptyState compact title="Nothing attached yet." hint="Select a passage, then attach it to an event below." />
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
                    <span className="timeline-side-when ib-meta">{event ? describeWhen(event, calendar) : ''}</span>
                    {thread.jump ? <span className="timeline-side-jump">{thread.jump === 'back' ? 'Flashback' : 'Flash-forward'}</span> : null}
                    <IconButton icon="close" label="Detach this passage" size="capsule" iconSize={16} onClick={() => removeTimelineRanges(editor, [thread.id])} />
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </Section>

      <Section
        id="timeline.attach"
        title="Attach the selection"
        help="timeline.attach"
        accessory={<Button variant="tinted" disabled={!hasSelection} onClick={attach}>Attach</Button>}
      >
        <FormRow label="To">
          <SelectMenu label="Event" value={choice} onChange={setChoice} options={events} />
        </FormRow>
      </Section>

      <Section id="timeline.view" title="On the page" help="timeline.lens">
        <FormRow label="Time lens" help="timeline.lens">
          <Toggle label="Time lens" checked={Boolean(cursor.lens.on)} onChange={(on) => setTimeLens(projectName, { on }, 'sidebar')} />
        </FormRow>
        <FormRow label="Passage handles" help="timeline.handles">
          <Toggle label="Passage handles" checked={Boolean(cursor.editingRanges)} onChange={(on) => setRangeEditing(projectName, on, 'sidebar')} />
        </FormRow>
      </Section>
    </div>
  )
}

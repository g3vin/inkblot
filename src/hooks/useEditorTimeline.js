/**
 * useEditorTimeline — the editors and the chronology, kept pointing at each other.
 *
 * Inward, into each editor (TimelineAnchors.js): every event's title, date and colour,
 * which of them the time lens covers, and whether passage handles are showing. All of
 * it follows the chronology live — drag an event in a timeline view and the passages
 * in the open chapter light up or fade as it crosses the lens.
 *
 * Outward, from each editor:
 *   - its ranges are published as they change (`publishLiveRanges`), so a manuscript
 *     view redraws from what is on screen rather than what was last saved
 *   - a change that moved no text (a passage attached, a handle dragged) is saved on
 *     its own, since the text autosave never hears of it
 *   - an event with no passage left in this document loses its link to it
 *   - passages of an event that no longer exists are removed
 *   - "go to passage" requests (passageJump.js) are claimed and scrolled to
 *
 * Nothing here runs while a pane is loading: a load replaces the whole document, and
 * its ranges arrive with it (useEditorDocCache).
 */
import { useEffect, useRef } from 'react'
import { documentSurface } from '../bridge'
import { getTimelineAnchors, removeTimelineRanges, setTimelineContext, addTimelineRange } from '../extensions/TimelineAnchors'
import { saveDocumentTimeline } from '../lib/FileSystem'
import { isEditorReady } from '../lib/editorUtils'
import { normalizeCalendar } from '../lib/map/calendar'
import { loadStoryCalendar, STORY_CALENDAR_CHANGED_EVENT } from '../lib/map/storyCalendarStore'
import { getStoryCursor, subscribeStoryCursor } from '../lib/timeline/storyCursor'
import { addEvent, addLink, effectiveLens, eventById, eventsInWindow, removeLink } from '../lib/timeline/timelineModel'
import { commitTimelineEdit } from '../lib/timeline/timelineEdits'
import { forgetLiveRanges, publishLiveRanges } from '../lib/timeline/timelineRanges'
import { loadStoryTimeline, peekStoryTimeline, replaceStoryTimeline, subscribeTimeline } from '../lib/timeline/timelineStore'
import { describeWhen } from '../timeline/useTimelinePanel'
import { PASSAGE_JUMP_EVENT, takePassageJump } from '../timeline/passageJump'

const SAVE_DELAY_MS = 400

function eventContext(timeline, calendar) {
  const events = new Map()
  if (!timeline) return events
  const laneColor = new Map(timeline.lanes.map((lane) => [lane.id, lane.color]))
  for (const event of timeline.events) {
    events.set(event.id, {
      title: event.title,
      color: event.color || laneColor.get(event.laneId) || null,
      when: describeWhen(event, calendar),
    })
  }
  return events
}

/** Select and scroll to a passage of `eventId` (a particular range when `rangeId`). */
export function revealPassage(editor, eventId, rangeId = null) {
  if (!isEditorReady(editor)) return false
  const { ranges } = getTimelineAnchors(editor)
  const range = ranges.find((item) => item.id === rangeId) || ranges.find((item) => item.eventId === eventId)
  if (!range) return false
  editor.chain().focus().setTextSelection({ from: range.from, to: range.to }).scrollIntoView().run()
  return true
}

function usePaneTimeline({ projectName, docPath, editor, paneId, isPaneLoading }) {
  const lastRangesRef = useRef(null)
  const saveTimerRef = useRef(null)
  const calendarRef = useRef(normalizeCalendar(null))

  // The chronology, the calendar and the cursor → how this editor draws its passages.
  useEffect(() => {
    if (!isEditorReady(editor) || !projectName || !docPath) return undefined
    let live = true

    const push = () => {
      if (!live || !isEditorReady(editor)) return
      const timeline = peekStoryTimeline(projectName)
      const cursor = getStoryCursor(projectName)
      const lensIds = cursor.lens.on && timeline ? new Set(eventsInWindow(timeline, effectiveLens(timeline, cursor.lens))) : null
      setTimelineContext(editor, {
        events: eventContext(timeline, calendarRef.current),
        lensIds,
        editing: Boolean(cursor.editingRanges),
        showChips: true,
      })
      // Passages of events that are gone (deleted, or their creation undone) go too.
      if (timeline && !isPaneLoading(paneId)) {
        const { docPath: rangesDoc, ranges } = getTimelineAnchors(editor)
        const orphans = rangesDoc === docPath ? ranges.filter((range) => !eventById(timeline, range.eventId)).map((range) => range.id) : []
        if (orphans.length) removeTimelineRanges(editor, orphans)
      }
    }

    loadStoryTimeline(projectName).then(push)
    loadStoryCalendar(projectName).then((calendar) => {
      calendarRef.current = calendar
      push()
    })
    const onCalendar = (event) => {
      if (event.detail?.projectName !== projectName) return
      calendarRef.current = event.detail.calendar
      push()
    }
    const unsubscribeTimeline = subscribeTimeline(projectName, push)
    const unsubscribeCursor = subscribeStoryCursor(projectName, push)
    window.addEventListener(STORY_CALENDAR_CHANGED_EVENT, onCalendar)
    return () => {
      live = false
      unsubscribeTimeline()
      unsubscribeCursor()
      window.removeEventListener(STORY_CALENDAR_CHANGED_EVENT, onCalendar)
    }
  }, [docPath, editor, isPaneLoading, paneId, projectName])

  // Ranges that changed → published, saved when no text moved, links kept honest.
  useEffect(() => {
    if (!isEditorReady(editor) || !projectName || !docPath) return undefined
    lastRangesRef.current = getTimelineAnchors(editor).docPath === docPath ? getTimelineAnchors(editor).ranges : null

    const handler = ({ transaction }) => {
      if (!isEditorReady(editor) || isPaneLoading(paneId)) return
      const state = getTimelineAnchors(editor)
      if (state.docPath !== docPath) return
      const previous = lastRangesRef.current
      if (state.ranges === previous) return
      lastRangesRef.current = state.ranges
      publishLiveRanges(projectName, docPath, state.ranges)
      documentSurface.publishTimelineRanges({ docPath, ranges: state.ranges.map(({ id, eventId, from, to, anchor }) => ({ id, eventId, from, to, anchor })) })

      if (!transaction.docChanged) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = setTimeout(() => {
          const latest = getTimelineAnchors(editor)
          if (latest.docPath === docPath) void saveDocumentTimeline(projectName, docPath, latest.ranges.map(({ id, eventId, from, to, anchor }) => ({ id, eventId, from, to, anchor })))
        }, SAVE_DELAY_MS)
      }

      // An event whose last passage here is gone no longer links to this document.
      if (previous) {
        const remaining = new Set(state.ranges.map((range) => range.eventId))
        const lost = [...new Set(previous.map((range) => range.eventId))].filter((id) => !remaining.has(id))
        if (lost.length) {
          void replaceStoryTimeline(projectName, (timeline) =>
            lost.reduce((acc, eventId) => (eventById(acc, eventId) ? removeLink(acc, eventId, { kind: 'text', doc: docPath }) : acc), timeline))
        }
      }
    }

    editor.on('transaction', handler)
    return () => {
      if (!editor.isDestroyed) editor.off('transaction', handler)
      clearTimeout(saveTimerRef.current)
      forgetLiveRanges(projectName, docPath)
    }
  }, [docPath, editor, isPaneLoading, paneId, projectName])

  // "Go to passage": a request waiting for this document, or one arriving while it is open.
  useEffect(() => {
    if (!isEditorReady(editor) || !projectName || !docPath) return undefined
    let frame = 0
    const tryPending = () => {
      if (isPaneLoading(paneId)) {
        frame = requestAnimationFrame(tryPending)
        return
      }
      const jump = takePassageJump(projectName, docPath)
      if (jump) revealPassage(editor, jump.eventId, jump.rangeId)
    }
    tryPending()
    const onJump = (event) => {
      if (event.detail?.docPath !== docPath) return
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(tryPending)
    }
    window.addEventListener(PASSAGE_JUMP_EVENT, onJump)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener(PASSAGE_JUMP_EVENT, onJump)
    }
  }, [docPath, editor, isPaneLoading, paneId, projectName])
}

export function useEditorTimeline({ projectName, currentDoc, editor, secondaryDoc, secondaryEditor, splitView, docCache }) {
  const { isPaneLoading } = docCache
  usePaneTimeline({ projectName, docPath: currentDoc, editor, paneId: 'primary', isPaneLoading })
  usePaneTimeline({
    projectName,
    docPath: splitView === 'editor' ? secondaryDoc : null,
    editor: splitView === 'editor' ? secondaryEditor : null,
    paneId: 'secondary',
    isPaneLoading,
  })
}

/**
 * Attach the editor's selection to an event: an existing one (`eventId`), or a new
 * one titled `title` (or after the words chosen). A new event goes in sequence just
 * after the event of the passage before it in this document, so attaching as you read
 * through a draft builds the chronology in reading order. Resolves to the event id.
 */
export async function attachSelectionToEvent({ editor, projectName, docPath, eventId = null, title = null }) {
  if (!isEditorReady(editor) || !projectName || !docPath) return null
  const { from, to } = editor.state.selection
  if (to <= from) return null
  const words = editor.state.doc.textBetween(from, to, ' ').trim().replace(/\s+/g, ' ')
  const link = { kind: 'text', doc: docPath }
  let id = eventId
  if (id) {
    await commitTimelineEdit(projectName, 'Attach passage', (timeline) => addLink(timeline, id, link))
  } else {
    const { ranges } = getTimelineAnchors(editor)
    const before = ranges.filter((range) => range.to <= from).pop()
    await commitTimelineEdit(projectName, 'Add event from passage', (timeline) => {
      const placement = before && eventById(timeline, before.eventId) ? { after: before.eventId } : {}
      const result = addEvent(timeline, { title: title || (words.length > 60 ? `${words.slice(0, 57)}…` : words) || 'New event', links: [link] }, placement)
      id = result.id
      return result.timeline
    })
  }
  if (!id) return null
  addTimelineRange(editor, id, { from, to })
  return id
}

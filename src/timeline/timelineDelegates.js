/**
 * timelineDelegates.js — the timeline's bridge commands, served by the page.
 *
 * Each needs the open project, which the document surface does not know, so the app
 * registers these beside the canvas's and map's (EditorCanvas). A command for a view
 * that is no longer mounted is dropped, as a map's is.
 */
import { attachSelectionToEvent } from '../hooks/useEditorTimeline'
import { setRangeEditing, setTimeLens } from '../lib/timeline/storyCursor'
import { requestPassageJump } from './passageJump'
import { dispatchTimelineCommand, requestTimelineReveal, timelineSurfaceById } from './timelineEvents'

export function createTimelineDelegates({ projectName, openDoc }) {
  return {
    timelineCommand({ surfaceId, command, detail }) {
      const surface = timelineSurfaceById(surfaceId)
      if (surface) dispatchTimelineCommand(surface, command, detail ?? {})
    },
    attachTimelineEvent({ eventId, title }, editor, docPath) {
      void attachSelectionToEvent({ editor, projectName, docPath, eventId: eventId ?? null, title: title ?? null })
    },
    jumpToTimelinePassage({ docPath, eventId, rangeId }) {
      openDoc?.(docPath)
      requestPassageJump({ projectName, docPath, eventId, rangeId: rangeId ?? null })
    },
    revealTimelineEvent({ eventId }) {
      requestTimelineReveal(eventId)
    },
    setTimeLens({ on, editing }) {
      const patch = {}
      if (typeof on === 'boolean') patch.on = on
      if (typeof editing === 'boolean') patch.editing = editing
      setTimeLens(projectName, patch, 'shell')
    },
    setTimelineRangeEditing({ on }) {
      setRangeEditing(projectName, on, 'shell')
    },
  }
}

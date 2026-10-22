/**
 * timelineMenu.js — the timeline's part of right-clicking inside a document.
 *
 * With text selected: attach it to a timeline event — a new one named after it, or
 * one already in the chronology (those already told in this document first). With
 * the caret in an attached passage: show its event, or detach it. Always: the time
 * lens, and handles for dragging where passages start and stop.
 */
import { getTimelineAnchors, removeTimelineRanges } from '../../extensions/TimelineAnchors'
import { isTextDoc } from '../../lib/docKind'
import { getStoryCursor, setRangeEditing, setTimeLens } from '../../lib/timeline/storyCursor'
import { loadStoryTimeline } from '../../lib/timeline/timelineStore'
import { sortedEvents } from '../../lib/timeline/timelineModel'
import { attachSelectionToEvent } from '../useEditorTimeline'
import { requestTimelineReveal } from '../../timeline/timelineEvents'

const MAX_EVENTS = 24

const truncate = (text, length) => (text.length > length ? `${text.slice(0, length - 1)}…` : text)

export async function timelineMenu(ctx) {
  const { MenuItem, PredefinedMenuItem, Submenu, editor, items, activeDoc, currentDoc, projectName, fileItem, openRightSidebarTab } = ctx
  const docPath = activeDoc || currentDoc
  if (fileItem || !editor || !projectName || !docPath || !isTextDoc(docPath)) return
  if (!ctx.e.target.closest?.('.editor, .pane')) return

  const { from, to } = editor.state.selection
  const hasSelection = to > from && editor.state.doc.textBetween(from, to, ' ').trim()
  const { ranges } = getTimelineAnchors(editor)
  const under = ranges.filter((range) => range.from <= from && range.to >= to)
  const timeline = await loadStoryTimeline(projectName)
  const out = []

  if (hasSelection) {
    const here = new Set(timeline.events.filter((event) => event.links.some((link) => link.kind === 'text' && link.doc === docPath)).map((event) => event.id))
    const ordered = sortedEvents(timeline)
    const choices = [...ordered.filter((event) => here.has(event.id)), ...ordered.filter((event) => !here.has(event.id))].slice(0, MAX_EVENTS)
    const attach = (eventId) => async () => {
      await attachSelectionToEvent({ editor, projectName, docPath, eventId })
    }
    const submenuItems = [
      await MenuItem.new({ text: 'New event from selection', action: attach(null) }),
    ]
    if (choices.length) {
      submenuItems.push(await PredefinedMenuItem.new({ item: 'Separator' }))
      for (const event of choices) {
        submenuItems.push(await MenuItem.new({ text: truncate(event.title || 'Untitled', 48), action: attach(event.id) }))
      }
    }
    out.push(await Submenu.new({ text: 'Attach to timeline event', items: submenuItems }))
  }

  for (const range of under.slice(0, 3)) {
    const event = timeline.events.find((item) => item.id === range.eventId)
    const name = truncate(event?.title || 'event', 32)
    out.push(
      await MenuItem.new({
        text: `Show “${name}” in Timeline`,
        action: () => {
          requestTimelineReveal(range.eventId)
          openRightSidebarTab?.('timeline')
        },
      }),
      await MenuItem.new({ text: `Detach from “${name}”`, action: () => removeTimelineRanges(editor, [range.id]) }),
    )
  }

  const cursor = getStoryCursor(projectName)
  out.push(
    await MenuItem.new({
      text: cursor.lens.on ? 'Hide time lens' : 'Show time lens',
      action: () => setTimeLens(projectName, { on: !cursor.lens.on }, 'editor'),
    }),
    await MenuItem.new({
      text: cursor.editingRanges ? 'Stop editing timeline passages' : 'Edit timeline passages',
      action: () => setRangeEditing(projectName, !cursor.editingRanges, 'editor'),
    }),
  )

  items.push(...out, await PredefinedMenuItem.new({ item: 'Separator' }))
}

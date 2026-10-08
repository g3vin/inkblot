/**
 * TimelineAnchors.js — passages of text attached to timeline events.
 *
 * The ranges live in this plugin's state, per editor: `{ id, eventId, from, to,
 * anchor }` (timelineRanges.js). Keeping them in the EditorState rather than in React
 * is what keeps them right: every transaction maps them (the start sticks after text
 * typed at it, the end before), the per-document state cache (useEditorDocCache)
 * brings them back with the text they point into, and the autosave reads them off the
 * same state it saves (`readEditorTimelineRanges`). A range whose text is deleted
 * collapses and is dropped, as a quote note is.
 *
 * What they look like comes from outside, pushed in as `context` by useEditorTimeline:
 *
 *   - each passage is underlined in its event's colour, with a small chip naming the
 *     event where it ends; clicking the chip shows the event in the timeline
 *   - with the time lens on, passages whose event is inside the lens are lit and the
 *     rest fade — "highlight everything in this window of time"
 *   - with range editing on, each passage grows a handle at either end that can be
 *     dragged to move where it starts or stops
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { newId } from '../lib/map/mapModel'
import { normalizeRanges } from '../lib/timeline/timelineRanges'
import { requestTimelineReveal } from '../timeline/timelineEvents'
import '../timeline/Timeline.css'

export const TIMELINE_ANCHORS_KEY = new PluginKey('timelineAnchors')

const EMPTY_CONTEXT = { events: new Map(), lensIds: null, editing: false, activeEventId: null, showChips: true }

const EMPTY = { docPath: null, ranges: [], context: EMPTY_CONTEXT, decorations: DecorationSet.empty }

const truncate = (text, length) => (text.length > length ? `${text.slice(0, length - 1)}…` : text)

function chipWidget(range, event, color) {
  return (view) => {
    const chip = document.createElement('span')
    chip.className = 'timeline-range-chip'
    chip.contentEditable = 'false'
    chip.textContent = truncate(event?.title || 'Event', 26)
    chip.title = `${event?.title || 'Event'}${event?.when ? ` — ${event.when}` : ''}\nShow in the timeline`
    if (color) chip.style.setProperty('--timeline-range', color)
    chip.addEventListener('mousedown', (pointer) => {
      pointer.preventDefault()
      pointer.stopPropagation()
      requestTimelineReveal(range.eventId)
      view.dom.dispatchEvent(new CustomEvent('timeline:chip', { bubbles: true, detail: { eventId: range.eventId, rangeId: range.id } }))
    })
    return chip
  }
}

/** A drag handle at one end of a range: pointer → document position, live. */
function handleWidget(range, end, color) {
  return (view) => {
    const handle = document.createElement('span')
    handle.className = `timeline-range-handle is-${end}`
    handle.contentEditable = 'false'
    handle.title = end === 'from' ? 'Drag to move where this passage starts' : 'Drag to move where this passage ends'
    if (color) handle.style.setProperty('--timeline-range', color)
    handle.addEventListener('pointerdown', (pointer) => {
      pointer.preventDefault()
      pointer.stopPropagation()
      handle.setPointerCapture?.(pointer.pointerId)
      const onMove = (move) => {
        const found = view.posAtCoords({ left: move.clientX, top: move.clientY })
        if (!found) return
        const current = TIMELINE_ANCHORS_KEY.getState(view.state)?.ranges.find((item) => item.id === range.id)
        if (!current) return
        const pos = found.pos
        const patch = end === 'from' ? { from: Math.min(pos, current.to - 1) } : { to: Math.max(pos, current.from + 1) }
        view.dispatch(view.state.tr.setMeta(TIMELINE_ANCHORS_KEY, { type: 'patch', id: range.id, patch }).setMeta('addToHistory', false))
      }
      const onUp = () => {
        handle.removeEventListener('pointermove', onMove)
        handle.removeEventListener('pointerup', onUp)
        handle.removeEventListener('pointercancel', onUp)
        view.dom.dispatchEvent(new CustomEvent('timeline:range-edited', { bubbles: true, detail: { rangeId: range.id } }))
      }
      handle.addEventListener('pointermove', onMove)
      handle.addEventListener('pointerup', onUp)
      handle.addEventListener('pointercancel', onUp)
    })
    return handle
  }
}

function buildDecorations(doc, ranges, context) {
  const decorations = []
  for (const range of ranges) {
    if (range.to > doc.content.size) continue
    const event = context.events.get(range.eventId)
    const color = event?.color || null
    const inLens = context.lensIds ? context.lensIds.has(range.eventId) : null
    const classes = ['timeline-range']
    if (inLens === true) classes.push('is-in-lens')
    if (inLens === false) classes.push('is-dimmed')
    if (context.activeEventId === range.eventId) classes.push('is-in-lens')
    decorations.push(Decoration.inline(range.from, range.to, {
      class: classes.join(' '),
      'data-timeline-event': range.eventId,
      ...(color ? { style: `--timeline-range: ${color}` } : {}),
    }))
    if (context.showChips && inLens !== false) {
      decorations.push(Decoration.widget(range.to, chipWidget(range, event, color), { side: 1, key: `chip:${range.id}:${event?.title || ''}:${color || ''}`, ignoreSelection: true }))
    }
    if (context.editing) {
      decorations.push(Decoration.widget(range.from, handleWidget(range, 'from', color), { side: -1, key: `from:${range.id}`, ignoreSelection: true }))
      decorations.push(Decoration.widget(range.to, handleWidget(range, 'to', color), { side: 1, key: `to:${range.id}`, ignoreSelection: true }))
    }
  }
  return DecorationSet.create(doc, decorations)
}

const textOf = (doc, from, to) => {
  try {
    return doc.textBetween(from, to, ' ')
  } catch {
    return ''
  }
}

function mapRanges(ranges, tr) {
  let changed = false
  const out = []
  for (const range of ranges) {
    const from = tr.mapping.map(range.from, 1)
    const to = tr.mapping.map(range.to, -1)
    if (from >= to) {
      changed = true
      continue
    }
    if (from !== range.from || to !== range.to) {
      changed = true
      out.push({ ...range, from, to, anchor: textOf(tr.doc, from, to) })
    } else out.push(range)
  }
  return changed ? out : ranges
}

export const TimelineAnchors = Extension.create({
  name: 'timelineAnchors',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: TIMELINE_ANCHORS_KEY,
        state: {
          init: () => EMPTY,
          apply(tr, value, _oldState, newState) {
            const meta = tr.getMeta(TIMELINE_ANCHORS_KEY)
            let { docPath, ranges, context } = value
            if (meta?.type === 'set') {
              docPath = meta.docPath
              ranges = normalizeRanges(meta.ranges).filter((range) => range.to <= newState.doc.content.size)
            } else if (tr.docChanged) {
              ranges = mapRanges(ranges, tr)
            }
            if (meta?.type === 'context') context = { ...context, ...meta.context }
            if (meta?.type === 'add') ranges = normalizeRanges([...ranges, meta.range])
            if (meta?.type === 'remove') ranges = ranges.filter((range) => !meta.ids.includes(range.id))
            if (meta?.type === 'patch') {
              ranges = normalizeRanges(ranges.map((range) => {
                if (range.id !== meta.id) return range
                const next = { ...range, ...meta.patch }
                return { ...next, anchor: textOf(newState.doc, next.from, next.to) }
              }))
            }
            if (docPath === value.docPath && ranges === value.ranges && context === value.context && !tr.docChanged) return value
            return { docPath, ranges, context, decorations: buildDecorations(newState.doc, ranges, context) }
          },
        },
        props: {
          decorations: (state) => TIMELINE_ANCHORS_KEY.getState(state)?.decorations ?? DecorationSet.empty,
        },
      }),
    ]
  },
})

/* ---------------- reading and writing from outside ---------------- */

const dispatchMeta = (editor, meta) => {
  if (!editor || editor.isDestroyed || !editor.view) return
  editor.view.dispatch(editor.state.tr.setMeta(TIMELINE_ANCHORS_KEY, meta).setMeta('addToHistory', false))
}

/** The plugin's state for an editor: `{ docPath, ranges }`. */
export const getTimelineAnchors = (editor) => (editor && !editor.isDestroyed ? TIMELINE_ANCHORS_KEY.getState(editor.state) : null) || EMPTY

/** Put a document's saved ranges into an editor that has just loaded it. */
export const setTimelineRanges = (editor, docPath, ranges) => dispatchMeta(editor, { type: 'set', docPath, ranges: ranges || [] })

/** How the ranges are drawn: event titles and colours, the lens, handle editing. */
export const setTimelineContext = (editor, context) => dispatchMeta(editor, { type: 'context', context })

export const removeTimelineRanges = (editor, ids) => dispatchMeta(editor, { type: 'remove', ids })

/**
 * The ranges to save with `docPath`, or undefined when this editor's ranges belong to
 * another document (or it never loaded any) — `saveDocument` then keeps what the file
 * has.
 */
export function readEditorTimelineRanges(editor, docPath) {
  const state = getTimelineAnchors(editor)
  if (!state.docPath || state.docPath !== docPath) return undefined
  return state.ranges.map(({ id, eventId, from, to, anchor }) => ({ id, eventId, from, to, anchor }))
}

/**
 * Attach the selection to an event. Returns the new range, or null when nothing is
 * selected. The caller links the event to the document (useEditorTimeline).
 */
export function addTimelineRange(editor, eventId, { from, to } = {}) {
  if (!editor || editor.isDestroyed) return null
  const selection = editor.state.selection
  const start = from ?? selection.from
  const end = to ?? selection.to
  if (end <= start) return null
  const range = { id: newId(), eventId, from: start, to: end, anchor: textOf(editor.state.doc, start, end) }
  dispatchMeta(editor, { type: 'add', range })
  return range
}

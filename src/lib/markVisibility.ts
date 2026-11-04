/**
 * markVisibility.ts — which of the marks drawn over the writer's text are shown: name
 * tags, note dots, bubble chips and timeline passages (the toolbar's Show menu).
 *
 * None of them is content, so hiding one is a view setting, saved as a preference and
 * never in a document. Names are hidden by the EntityMentions plugin itself, so a
 * hidden layer costs no scanning; the rest are hidden by CSS keyed on
 * `data-hide-marks` on the root element (`components/EditorMarks.css`), so nothing is rebuilt.
 */
import { useSyncExternalStore } from 'react'
import { getObjectPreference, setPreference } from './preferences'
import type { MarkVisibility } from '../types/inkblot-core'

export type MarkLayerId = keyof MarkVisibility

export const MARK_VISIBILITY_KEY = 'inkblot-mark-visibility'

/** The layers in the order the Show menu lists them. */
export const MARK_LAYERS: { id: MarkLayerId; label: string; icon: string }[] = [
  { id: 'names', label: 'Names', icon: 'characters' },
  { id: 'notes', label: 'Note dots', icon: 'note' },
  { id: 'bubbles', label: 'Bubble icons', icon: 'chats' },
  { id: 'timeline', label: 'Timeline passages', icon: 'timeline' },
]

const ALL_SHOWN: MarkVisibility = { names: true, notes: true, bubbles: true, timeline: true }

const read = (): MarkVisibility => {
  const stored = getObjectPreference<Partial<Record<MarkLayerId, unknown>>>(MARK_VISIBILITY_KEY)
  // Anything but an explicit `false` is shown: a layer added later starts visible.
  return { names: stored.names !== false, notes: stored.notes !== false, bubbles: stored.bubbles !== false, timeline: stored.timeline !== false }
}

// Read on first use, not at import: preferences are hydrated after modules load.
let state: MarkVisibility | null = null
const listeners = new Set<() => void>()

const reflectOnRoot = (marks: MarkVisibility) => {
  if (typeof document === 'undefined') return
  const hidden = MARK_LAYERS.filter(({ id }) => !marks[id]).map(({ id }) => id)
  if (hidden.length) document.documentElement.dataset.hideMarks = hidden.join(' ')
  else delete document.documentElement.dataset.hideMarks
}

export function getMarkVisibility(): MarkVisibility {
  if (!state) {
    state = read()
    reflectOnRoot(state)
  }
  return state
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Every layer's visibility, re-rendering when one changes. */
export function useMarkVisibility(): MarkVisibility {
  return useSyncExternalStore(subscribe, getMarkVisibility, getMarkVisibility)
}

/** Hear every change (the surface publishes them as `viewOptions.marks`). */
export const onMarkVisibilityChange = subscribe

function commit(next: MarkVisibility) {
  const current = getMarkVisibility()
  if (MARK_LAYERS.every(({ id }) => current[id] === next[id])) return
  state = next
  setPreference(MARK_VISIBILITY_KEY, JSON.stringify(next))
  reflectOnRoot(next)
  listeners.forEach((listener) => listener())
}

export function setMarkVisible(layer: MarkLayerId, visible: boolean): void {
  commit({ ...getMarkVisibility(), [layer]: Boolean(visible) })
}

export function setAllMarksVisible(visible: boolean): void {
  commit(visible ? { ...ALL_SHOWN } : { names: false, notes: false, bubbles: false, timeline: false })
}

export const allMarksShown = (marks: MarkVisibility): boolean => MARK_LAYERS.every(({ id }) => marks[id])

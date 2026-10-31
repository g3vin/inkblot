/**
 * undoHistory.ts — undo and redo layered over a document reducer, shared by the canvas
 * (src/canvas/canvasReducer.ts) and the map (src/map/mapReducer.ts).
 *
 * History is whole-document snapshots. The reducers never mutate, so a snapshot costs
 * one new top-level object, and undoing a compound edit (a node and every edge touching
 * it) brings all of it back as one step.
 */

/** What an action says about how it should land in history, rather than what it does. */
export interface ActionMeta {
  /** Loading a document is not an edit — it resets the stacks instead of pushing. */
  silent?: boolean
  /** Edits sharing a key collapse into the one history entry they started. */
  coalesce?: string | null
  /** Not the writer's edit (a linked document moved), so a locked document takes it too. */
  upkeep?: boolean
}

/** Every action that moves through history without changing the document itself. */
export type HistoryAction =
  | { type: 'history/undo'; meta?: ActionMeta }
  | { type: 'history/redo'; meta?: ActionMeta }
  | { type: 'history/breakCoalesce'; meta?: ActionMeta }

/** The undo stack, the document, and the redo stack. */
export interface History<Doc> {
  past: Doc[]
  present: Doc
  future: Doc[]
  coalesceKey: string | null
}

const HISTORY_LIMIT = 100

const isHistoryAction = (action: { type: string }): action is HistoryAction => action.type.startsWith('history/')

export const createHistory = <Doc>(present: Doc): History<Doc> => ({
  past: [],
  present,
  future: [],
  coalesceKey: null,
})

export const canUndo = (history: History<unknown>): boolean => history.past.length > 0
export const canRedo = (history: History<unknown>): boolean => history.future.length > 0

/** `docReducer` with undo and redo: edits push a snapshot (or join a coalesced one), silent ones reset the stacks. */
export function withHistory<Doc, DocAction extends { type: string; meta?: ActionMeta }>(
  docReducer: (doc: Doc, action: DocAction) => Doc,
) {
  return (history: History<Doc>, action: DocAction | HistoryAction): History<Doc> => {
    if (isHistoryAction(action)) {
      if (action.type === 'history/undo') {
        if (!history.past.length) return history
        return {
          past: history.past.slice(0, -1),
          present: history.past[history.past.length - 1],
          future: [history.present, ...history.future],
          coalesceKey: null,
        }
      }
      if (action.type === 'history/redo') {
        if (!history.future.length) return history
        return {
          past: [...history.past, history.present],
          present: history.future[0],
          future: history.future.slice(1),
          coalesceKey: null,
        }
      }
      // Fired after an idle gap so a long run of coalesced edits (typing in a card,
      // dragging a colour slider) breaks into more than one undo step.
      return history.coalesceKey ? { ...history, coalesceKey: null } : history
    }

    const next = docReducer(history.present, action)
    if (next === history.present) return history

    const meta = action.meta || {}
    if (meta.silent) return { past: [], present: next, future: [], coalesceKey: null }

    if (meta.coalesce && meta.coalesce === history.coalesceKey && history.past.length) {
      return { ...history, present: next, future: [] }
    }

    const past = [...history.past, history.present]
    if (past.length > HISTORY_LIMIT) past.shift()
    return { past, present: next, future: [], coalesceKey: meta.coalesce || null }
  }
}

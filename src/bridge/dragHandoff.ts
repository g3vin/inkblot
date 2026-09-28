/**
 * dragHandoff.ts — the one owner of an in-app drag between components.
 *
 * A drag in Inkblot is often started by one component and finished by another, and
 * the DOM's own drag events cannot carry the payload between them: a drag from the
 * clipboard panel into an editor has to survive a `dragstart` in one React tree and a
 * `drop` in another, and `dataTransfer` is unreadable during `dragover` — exactly when
 * the editor needs it to decide whether to show a drop caret. `useEditorDnd`,
 * `ClipboardPanel`, `EditorCanvas` and `Editor` all share the session held here.
 *
 * The hand-off is messages rather than a shared object, so either end of a drag could
 * be something other than this page. This module is the page's half: one session at
 * a time, a claim protocol, and every transition reported on the bridge.
 *
 * **`claim()` is test-and-set.** Two drop targets can see the same drop (an editor
 * and the clipboard panel underneath it). The first caller gets `true` and everyone
 * after it gets `false`, so which target handles the drop does not depend on the order
 * their listeners happen to run in.
 */
import { DragPayloadKind } from '../types'
import type { DragEnded, DragMoved, DragStarted, TextAnchor } from '../types'

export interface DragOrigin {
  kind: DragPayloadKind
  /** The plain text being dragged, where there is any. */
  text?: string
  /** The clipboard entry, document or note the drag came from. */
  sourceId?: string | null
  docPath?: string | null
  /** Where the selection came from, for a drag that will move rather than copy. */
  anchor?: TextAnchor | null
  /** Anything the drop target needs that the fields above do not model. */
  detail?: unknown
}

export interface DragSession extends DragStarted {
  /** Set once some target has taken responsibility for the payload. */
  claimed: boolean
}

export interface DragPoint {
  x: number
  y: number
}

export type Unsubscribe = () => void

export interface DragHandoff {
  /** Start a drag. Replaces any session still open — a stuck one must not block a new drag. */
  begin(origin: DragOrigin): DragSession
  current(): DragSession | null
  /** The last pointer position seen during the drag. What `__inkblot_dragPoint` held. */
  point(): DragPoint | null
  moveTo(x: number, y: number): DragMoved | null
  /** Take responsibility for the payload. True for the first caller only. */
  claim(): boolean
  isClaimed(): boolean
  /** End the drag, however it ended. Returns the report, or null if none was open. */
  end(at?: Partial<DragPoint>): DragEnded | null
  /** Fires on begin, claim and end — not on every move. */
  onChange(handler: (session: DragSession | null) => void): Unsubscribe
}

let nextDragId = 0

export function createDragHandoff(): DragHandoff {
  let session: DragSession | null = null
  let point: DragPoint | null = null
  const listeners = new Set<(session: DragSession | null) => void>()

  const announce = () => {
    for (const listener of [...listeners]) listener(session)
  }

  return {
    begin(origin) {
      session = {
        dragId: `d${nextDragId++}`,
        kind: origin.kind,
        text: origin.text ?? '',
        sourceId: origin.sourceId ?? undefined,
        docPath: origin.docPath ?? undefined,
        anchor: origin.anchor ?? undefined,
        detail: origin.detail,
        claimed: false,
      }
      point = null
      announce()
      return session
    },

    current: () => session,
    point: () => point,

    moveTo(x, y) {
      if (!session) return null
      point = { x, y }
      // Deliberately does not announce: a move is not a state change anyone re-renders
      // for, and it fires at pointer rate. The caller emits `dragMoved` on the bridge,
      // coalesced to one per frame.
      return { dragId: session.dragId, clientX: x, clientY: y }
    },

    claim() {
      if (!session || session.claimed) return false
      session = { ...session, claimed: true }
      announce()
      return true
    },

    isClaimed: () => Boolean(session?.claimed),

    end(at) {
      if (!session) return null
      const report: DragEnded = {
        dragId: session.dragId,
        handled: session.claimed,
        clientX: at?.x ?? point?.x ?? undefined,
        clientY: at?.y ?? point?.y ?? undefined,
      }
      session = null
      point = null
      announce()
      return report
    },

    onChange(handler) {
      listeners.add(handler)
      return () => { listeners.delete(handler) }
    },
  }
}

/**
 * The app's drag hand-off.
 *
 * A module singleton rather than React context for the same reason the globals were
 * globals: a TipTap `handleDrop` runs inside a ProseMirror plugin with no React tree
 * above it, and a canvas node view is not a component either. The difference from
 * `window` is that this one has an owner, a type, and exactly one way to mutate it.
 */
export const dragHandoff = createDragHandoff()

export { DragPayloadKind }

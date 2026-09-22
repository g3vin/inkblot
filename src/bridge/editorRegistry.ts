/**
 * editorRegistry.ts — which editor `EditorTarget.Primary` means right now.
 *
 * **Sharp edge #5.** Today the active editor is a live TipTap object passed around by
 * reference: panes elect one on mouse movement, `CanvasCardEditor` registers itself on
 * mount, and `EditorLayout` reads `__inkblotCanvasCard` off the winner to tell the
 * third state apart. All three steps assume the holder and the editor are in one heap.
 *
 * Across a process boundary only a *name* can travel, so the protocol names three
 * (`EditorTarget`) and this registry is where a name is turned back into an object —
 * on the webview side, the only side that has one. The shell holds names; the surface
 * holds this.
 *
 * **Everything is registered as an accessor, never as a value.** A TipTap editor is
 * replaced when a pane swaps documents, and a registry holding the old object would
 * hand out a destroyed editor. This is the same rule the hooks follow for the same
 * reason — see the handoff's note about `useEditorDnd` and accessors.
 */
import type { EditorTarget } from '../types'
import { isEditorReady } from '../lib/editorUtils'

export interface EditorRegistration {
  /** The live editor, or null. An accessor because the instance is replaced, not mutated. */
  getEditor: () => unknown
  /** The document it is showing, or null. */
  getDocPath?: () => string | null
  /** Set for `canvasCard`: which canvas surface hosts it. */
  getSurfaceId?: () => string | null
}

export interface ResolvedEditor {
  target: EditorTarget
  editor: unknown
  docPath: string | null
  surfaceId: string | null
}

export type Unsubscribe = () => void

export interface EditorRegistry {
  /** Announce an editor for a target. Returns a function that withdraws it. */
  register(target: EditorTarget, registration: EditorRegistration): Unsubscribe
  /** Record the election result. `null` means nothing is active. */
  setActive(target: EditorTarget | null): void
  activeTarget(): EditorTarget | null
  /** The active editor, resolved, or null if there is no live one. */
  active(): ResolvedEditor | null
  /** A particular target, resolved, or null. */
  resolve(target: EditorTarget | null | undefined): ResolvedEditor | null
  /** Fires when the election result changes, or when the winner is withdrawn. */
  onChange(handler: (active: ResolvedEditor | null) => void): Unsubscribe
}

export function createEditorRegistry(): EditorRegistry {
  const registrations = new Map<EditorTarget, EditorRegistration>()
  const listeners = new Set<(active: ResolvedEditor | null) => void>()
  let activeTarget: EditorTarget | null = null

  const resolve = (target: EditorTarget | null | undefined): ResolvedEditor | null => {
    if (!target) return null
    const registration = registrations.get(target)
    if (!registration) return null

    const editor = registration.getEditor()
    // A registration can outlive its editor by a tick — React unmounts the component
    // before TipTap finishes tearing the instance down. `isEditorReady` is what stops
    // the bridge handing a destroyed editor to a command.
    if (!isEditorReady(editor)) return null

    return {
      target,
      editor,
      docPath: registration.getDocPath?.() ?? null,
      surfaceId: registration.getSurfaceId?.() ?? null,
    }
  }

  const announce = () => {
    const active = resolve(activeTarget)
    for (const listener of [...listeners]) listener(active)
  }

  return {
    register(target, registration) {
      registrations.set(target, registration)
      if (target === activeTarget) announce()

      return () => {
        if (registrations.get(target) !== registration) return
        registrations.delete(target)
        // Withdrawing the winner is a change in the election result even though the
        // election did not run again. Without this the shell keeps rendering a toolbar
        // for an editor that no longer exists — which is the destroyed-editor bug
        // `CanvasCardEditor`'s unmount already guards against by hand.
        if (target === activeTarget) announce()
      }
    },

    setActive(target) {
      if (activeTarget === target) return
      activeTarget = target
      announce()
    },

    activeTarget: () => activeTarget,
    active: () => resolve(activeTarget),
    resolve,

    onChange(handler) {
      listeners.add(handler)
      return () => { listeners.delete(handler) }
    },
  }
}

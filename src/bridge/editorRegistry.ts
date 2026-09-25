/**
 * editorRegistry.ts — which editor `EditorTarget.Primary` means right now.
 *
 * Panes elect an active editor on mouse movement and a canvas card editor claims the
 * election while it is open. Across a process boundary only a *name* can travel, so
 * the protocol names three targets (`EditorTarget`: `primary`, `secondary`,
 * `canvasCard`) and this registry is the only place a name is turned back into a live
 * editor — on the webview side, the only side that has one. The shell holds names; the
 * surface holds this.
 *
 * **Everything is registered as an accessor, never as a value.** A TipTap editor is
 * replaced when a pane swaps documents, and a registry holding the old object would
 * hand out a destroyed editor. Hooks that take an editor follow the same rule.
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
        // for an editor that no longer exists.
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

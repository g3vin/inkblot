/**
 * useSurfacePublisher.ts — the thing that makes the toolbar a push instead of a pull.
 *
 * Mounted once, high up. It follows the active editor through the registry and, for
 * whichever one is active, listens for the two things that can change what the toolbar
 * shows: `selectionUpdate` (the caret moved) and `transaction` (the document changed
 * under a caret that did not). Each one publishes a fresh `ToolbarState` and
 * `SelectionContext` on the bridge, coalesced to one per frame by the surface.
 *
 * **Why it follows the registry rather than taking an editor prop.** The active editor
 * is elected by mouse movement and can be a canvas card that mounts and unmounts as
 * the user double-clicks around a board. A hook holding one editor would have to be
 * remounted on every election; a hook holding the registry is told.
 */
import { useEffect } from 'react'
import { documentSurface, editorRegistry } from './appBridge'

interface Emitter {
  on(event: string, handler: (...args: unknown[]) => void): void
  off(event: string, handler: (...args: unknown[]) => void): void
  isDestroyed?: boolean
}

export function useSurfacePublisher(): void {
  useEffect(() => {
    let attachedTo: Emitter | null = null
    let publish: (() => void) | null = null

    const detach = () => {
      if (attachedTo && publish && !attachedTo.isDestroyed) {
        attachedTo.off('selectionUpdate', publish)
        attachedTo.off('transaction', publish)
      }
      attachedTo = null
      publish = null
    }

    const attach = () => {
      const active = editorRegistry.active()
      const editor = active?.editor as Emitter | undefined

      if (editor === attachedTo) {
        // Same editor, but the election may have renamed it — a pane that swapped
        // documents keeps its instance. Publish anyway so the shell is not left
        // holding the previous document's answer.
        documentSurface.publishToolbarState()
        documentSurface.publishSelectionContext()
        return
      }

      detach()

      if (!editor || typeof editor.on !== 'function') {
        // No live editor: publish once so the toolbar renders disabled rather than
        // keeping the last editor's formatting on screen.
        documentSurface.publishToolbarState()
        return
      }

      publish = () => {
        documentSurface.publishToolbarState()
        documentSurface.publishSelectionContext()
      }
      attachedTo = editor
      editor.on('selectionUpdate', publish)
      editor.on('transaction', publish)
      publish()
    }

    const unsubscribe = editorRegistry.onChange(() => {
      // The election result first, then the state that depends on it. A shell that
      // learned the new toolbar state before it learned which editor it was for would
      // briefly attribute one pane's formatting to another.
      documentSurface.publishActiveEditor()
      attach()
    })
    attach()

    return () => {
      unsubscribe()
      detach()
      // Anything still held is about an editor that is going away with this effect;
      // sending it would leave the shell rendering a pane that no longer exists.
      documentSurface.flush()
    }
  }, [])
}

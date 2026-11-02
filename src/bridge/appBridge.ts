/**
 * appBridge.ts — the one bridge the running app uses, and the React glue over it.
 *
 * Wires a shell end to a surface end and hands out the two objects the app talks to:
 * `shellBridge` for the React chrome (toolbar, sidebars, menus) and `documentSurface`
 * for the editor.
 *
 * **Why a module singleton rather than a React context.** Half the callers are not
 * components. A TipTap `handleDrop` runs inside a ProseMirror plugin, a canvas node
 * view is not in the React tree at all, and both need the same bridge the toolbar is
 * on.
 *
 * **Which transport.** Both ends are in this process (`createInProcessTransports`).
 * This file is the only place that knows; nothing that imports from here has to.
 */
import type { InboundMessage } from '../types'
import { createInProcessTransports, type ShellTransport } from './transport'
import { createShellBridge, createSurfaceBridge } from './client'
import { createEditorRegistry } from './editorRegistry'
import { createDocumentSurface } from './surface'
import { setDocChangeSink } from './docChangeSink'

const transports = createInProcessTransports()

const shellPostListeners = new Set<(message: InboundMessage) => void>()

/** Hear every command and request the chrome sends: bug reports' breadcrumbs. */
export function onShellPost(listener: (message: InboundMessage) => void): () => void {
  shellPostListeners.add(listener)
  return () => { shellPostListeners.delete(listener) }
}

const shellTransport: ShellTransport = {
  post(message) {
    shellPostListeners.forEach((listener) => listener(message))
    transports.shell.post(message)
  },
  receive: (handler) => transports.shell.receive(handler),
}

/** The shell's end. The chrome sends commands and listens for events on this. */
export const shellBridge = createShellBridge(shellTransport)

const surfaceEnd = createSurfaceBridge(transports.surface)

/** Which editor each `EditorTarget` names. Panes and canvas cards register here. */
export const editorRegistry = createEditorRegistry()

/** The document surface's end. The editor publishes through this. */
export const documentSurface = createDocumentSurface({
  bridge: surfaceEnd,
  registry: editorRegistry,
})

// Every editor's `DocChangeReporter` reports to the one surface.
setDocChangeSink((editor, transaction) => documentSurface.noteDocTransaction(editor, transaction))

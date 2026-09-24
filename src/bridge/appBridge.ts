/**
 * appBridge.ts — the one bridge the running app uses, and the React glue over it.
 *
 * Both halves are in this process today, so this wires a shell end to a surface end
 * through the in-process transport and hands out the two objects the app talks to:
 * `shellBridge` for the chrome (toolbar, sidebars, menus) and `documentSurface` for
 * the editor.
 *
 * **Why a module singleton rather than a React context.** Half the callers are not
 * components. A TipTap `handleDrop` runs inside a ProseMirror plugin, a canvas node
 * view is not in the React tree at all, and both need the same bridge the toolbar is
 * on. This is the same reason the `window.__inkblot_*` globals were globals — the
 * difference is that this one has a type, one owner, and a seam it is deliberately
 * shaped around.
 *
 * **What changed in Phase 5.** This file, and only this file: inside the Swift shell the
 * transports come from `createNativeHostTransports`, which puts the native shell on the
 * wire beside the React chrome rather than instead of it — the chrome moves to Swift a
 * piece at a time, and both drive the same surface until the last piece has moved.
 * Outside it (the Tauri app, the test harness) nothing changed. Nothing that imports
 * from here has to know which.
 */
import { createInProcessTransports, createNativeHostTransports, detectNativeHost } from './transport'
import { createShellBridge, createSurfaceBridge } from './client'
import { createEditorRegistry } from './editorRegistry'
import { createDocumentSurface } from './surface'

const nativeHost = detectNativeHost()
const transports = nativeHost
  ? createNativeHostTransports(nativeHost)
  : createInProcessTransports()

/** The shell's end. The chrome sends commands and listens for events on this. */
export const shellBridge = createShellBridge(transports.shell)

const surfaceEnd = createSurfaceBridge(transports.surface)

/** Which editor each `EditorTarget` names. Panes and canvas cards register here. */
export const editorRegistry = createEditorRegistry()

/** The document surface's end. The editor publishes through this. */
export const documentSurface = createDocumentSurface({
  bridge: surfaceEnd,
  registry: editorRegistry,
})

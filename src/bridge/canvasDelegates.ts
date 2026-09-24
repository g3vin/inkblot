/**
 * canvasDelegates.ts — the canvas half of the protocol, implemented over what the
 * canvas already listens to.
 *
 * `canvasEvents.js` is how the rest of the app talks to a mounted canvas today: a
 * CustomEvent dispatched on the surface element, because split view can show two
 * canvases and the element is what says which one the user aimed at. That mechanism
 * is fine — it is the *aiming* that does not survive a process boundary, since a
 * native shell cannot hit-test the web view's DOM.
 *
 * So the protocol aims by id and this file does the translation: id to element, then
 * the existing dispatch. Nothing about how a canvas receives a command changes, which
 * is deliberate — a phase that rewrote the canvas's event handling at the same time as
 * introducing the bridge would have no way to tell which half broke it.
 */
import {
  canvasSurfaceById,
  dispatchCanvasCommand,
  dispatchCanvasDropDoc,
  dispatchCanvasDropNote,
  dispatchCanvasRestore,
  requestCanvasReveal,
} from '../canvas/canvasEvents'
import type { SurfaceDelegates } from './surface'

/**
 * A command for a surface that is not mounted is dropped, not queued.
 *
 * The one case that genuinely needs to outlive the switch is `canvasReveal` — a
 * search result for a canvas that is not open yet — and it is already addressed by
 * document path rather than surface id for exactly that reason. Everything else was
 * aimed at something the user could see.
 */
export const canvasDelegates: SurfaceDelegates = {
  canvasCommand({ surfaceId, command, detail }) {
    const surface = canvasSurfaceById(surfaceId)
    if (!surface) return
    dispatchCanvasCommand(surface, command, (detail ?? {}) as Record<string, unknown>)
  },

  canvasDropDoc({ surfaceId, path, clientX, clientY }) {
    const surface = canvasSurfaceById(surfaceId)
    if (!surface) return
    dispatchCanvasDropDoc(surface, { path, clientX, clientY })
  },

  canvasDropNote({ surfaceId, docPath, noteId, clientX, clientY }) {
    const surface = canvasSurfaceById(surfaceId)
    if (!surface) return
    dispatchCanvasDropNote(surface, { docPath, noteId, clientX, clientY })
  },

  canvasReveal({ docPath, nodeId }) {
    requestCanvasReveal(docPath, nodeId)
  },

  canvasRestore({ docPath, canvas }) {
    dispatchCanvasRestore(docPath, canvas)
  },
}

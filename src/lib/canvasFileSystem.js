/**
 * canvasFileSystem.js — persistence for canvas documents.
 *
 * Canvases live alongside text documents at `<projectRoot>/<path>.json` (their
 * tree path already carries the `.canvas` suffix, so the plain path→file mapping
 * in FileSystem.js works unchanged). They cannot go through saveDocument, which
 * whitelists its output down to { content, notes } — see the guard there.
 */
import { loadDocument, writeDocumentRaw } from './FileSystem'
import { normalizeCanvas, readViewport, serializeCanvas, DEFAULT_VIEWPORT } from './canvasModel'

/** Load a canvas into its runtime shape. A missing or corrupt file opens blank. */
export async function loadCanvasDocument(projectName, docPath) {
  const raw = await loadDocument(projectName, docPath)
  return {
    state: normalizeCanvas(raw),
    viewport: raw ? readViewport(raw) : { ...DEFAULT_VIEWPORT },
  }
}

export async function saveCanvasDocument(projectName, docPath, state, viewport = DEFAULT_VIEWPORT) {
  try {
    await writeDocumentRaw(projectName, docPath, serializeCanvas(state, viewport))
  } catch (error) {
    console.error('Failed to save canvas:', error)
  }
}

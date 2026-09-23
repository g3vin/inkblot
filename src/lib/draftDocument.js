/**
 * draftDocument.js — making a draft tab into a document.
 *
 * `DraftTabPane` and the Swift shell's native chooser (through `useNativeDraftPane`)
 * both end here, so they accept and refuse the same names and make the same files.
 */
import { documentExists, saveDocument } from './FileSystem'
import { saveCanvasDocument } from './canvasFileSystem'
import { createEmptyCanvas } from './canvasModel'
import { stripCanvasSuffix, withCanvasSuffix } from './docKind'

/** A name the chooser refused, with the message it shows. */
export class DraftRefusal extends Error {}

/**
 * Create the document a draft names, and return its path. `kind` is `'doc'` or
 * `'canvas'`. Throws a `DraftRefusal` for a name that cannot be used.
 */
export async function createDraftDocument(projectName, name, kind) {
  // The `.canvas` suffix is what routes a document to the canvas editor, so it
  // follows the kind being created — never whatever the user typed.
  const bare = stripCanvasSuffix(String(name || '').trim())
  if (!bare) throw new DraftRefusal('Give it a name first.')
  if (bare.includes('/')) throw new DraftRefusal('Names can’t contain “/”.')

  const path = kind === 'canvas' ? withCanvasSuffix(bare) : bare

  // Writing over a document that already exists would destroy it, and the draft has
  // no other way to notice — it never listed the project.
  if (await documentExists(projectName, path)) {
    throw new DraftRefusal('A document with that name already exists.')
  }

  if (kind === 'canvas') {
    await saveCanvasDocument(projectName, path, createEmptyCanvas())
  } else {
    await saveDocument(projectName, path, { content: [] })
  }
  return path
}

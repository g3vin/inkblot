/**
 * createDocument.js — making a new, empty document of a given kind.
 *
 * The file tree, a draft tab and the `createEntry` command all create
 * documents through here. The kind decides two things: the suffix the tree path carries (never whatever the user
 * typed — "plan.canvas" as a document stays a document) and what an empty one holds.
 */
import { saveDocument } from './FileSystem'
import { saveCanvasDocument } from './canvasFileSystem'
import { createEmptyCanvas } from './canvasModel'
import { stripDocSuffix, withDocSuffix } from './docKind'
import { saveMapDocument } from './map/mapFileSystem'
import { createEmptyMap } from './map/mapModel'

/** The kinds a user can create, as the UI lists them. */
export const DOCUMENT_KINDS = [
  { id: 'doc', label: 'Document', icon: 'doc.text', hint: 'A page for writing' },
  { id: 'canvas', label: 'Canvas', icon: 'canvas', hint: 'An open board for cards' },
  { id: 'map', label: 'Map', icon: 'map', hint: 'Places, routes and journeys' },
]

/** The kind id a caller passes, normalized: the shell says `document`, the page `doc`/`file`. */
const docKindOf = (kind) => (kind === 'canvas' || kind === 'map' ? kind : 'text')

/** A typed name → the tree name for `kind`: any kind suffix it carries swapped for the right one. */
export const nameForKind = (name, kind) => withDocSuffix(stripDocSuffix(String(name || '').trim()), docKindOf(kind))

/**
 * Write an empty document of `kind` at `path` (which already carries its suffix).
 *
 * A new map starts as a blank sheet marked `setupPending`, so the map pane asks what
 * it should be — an image, the Earth, a star system — the first time it is opened.
 * That keeps every creation path the same one-step "name it" gesture.
 */
export async function createDocumentOfKind(projectName, path, kind) {
  switch (docKindOf(kind)) {
    case 'canvas':
      return saveCanvasDocument(projectName, path, createEmptyCanvas())
    case 'map':
      return saveMapDocument(projectName, path, createEmptyMap('blank', { setupPending: true }))
    default:
      return saveDocument(projectName, path, { content: [] })
  }
}

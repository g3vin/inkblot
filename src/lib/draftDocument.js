/**
 * draftDocument.js — making a draft tab into a document.
 *
 * The rules for which names `DraftTabPane` accepts and which files it makes live here,
 * apart from the component.
 */
import { documentExists } from './FileSystem'
import { createDocumentOfKind, nameForKind } from './createDocument'
import { stripDocSuffix } from './docKind'

/** A name the chooser refused, with the message it shows. */
export class DraftRefusal extends Error {}

/**
 * Create the document a draft names, and return its path. `kind` is one of
 * `DOCUMENT_KINDS` (`'doc'`, `'canvas'`, `'map'`). Throws a `DraftRefusal` for a name
 * that cannot be used.
 */
export async function createDraftDocument(projectName, name, kind) {
  // The `.canvas` or `.map` suffix is what routes a document to its editor, so it
  // follows the kind being created — never whatever the user typed.
  const bare = stripDocSuffix(String(name || '').trim())
  if (!bare) throw new DraftRefusal('Give it a name first.')
  if (bare.includes('/')) throw new DraftRefusal('Names can’t contain “/”.')

  const path = nameForKind(bare, kind)

  // Writing over a document that already exists would destroy it, and the draft has
  // no other way to notice — it never listed the project.
  if (await documentExists(projectName, path)) {
    throw new DraftRefusal('A document with that name already exists.')
  }

  await createDocumentOfKind(projectName, path, kind)
  return path
}

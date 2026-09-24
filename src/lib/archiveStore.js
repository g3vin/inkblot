/**
 * archiveStore.js — things put away out of a document, kept in its file.
 *
 * Archiving hides something without destroying it. The archive rides in the document's
 * own JSON (`archive`, beside `versions`), so it moves, copies and syncs with the
 * document. Every item has a `kind`; for now there is one — a bubble session archived
 * from its sentence — but the list is meant for anything a writer puts aside.
 *
 * Writes go through the same per-document lock the autosave uses, which carries the
 * archive forward on every save (`saveDocument`). An `archive:changed` window event
 * follows each change.
 */
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { isTextDoc } from './docKind'
import { getProjectRoot, joinPath } from './projectPaths'
import { withDocLock } from './docLock'

export const ARCHIVE_CHANGED_EVENT = 'archive:changed'

export const newArchiveId = () => `archive-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const emitArchiveChanged = (projectName, docName) => {
  try {
    window.dispatchEvent(new CustomEvent(ARCHIVE_CHANGED_EVENT, { detail: { projectName, docName } }))
  } catch {
    void 0
  }
}

const documentPath = async (projectName, docName) => joinPath(await getProjectRoot(projectName), `${docName}.json`)

const readDocument = async (path) => {
  try {
    return JSON.parse((await readTextFile(path)) || '{}')
  } catch {
    return null
  }
}

/** A document's archived items, newest first. Canvases have none yet. */
export async function getArchive(projectName, docName) {
  if (!projectName || !docName || !isTextDoc(docName)) return []
  const doc = await readDocument(await documentPath(projectName, docName))
  return Array.isArray(doc?.archive) ? doc.archive : []
}

/** Change a document's archive, under its lock. `change` maps the list to the next. */
async function updateArchive(projectName, docName, change) {
  if (!projectName || !docName || !isTextDoc(docName)) return false
  const changed = await withDocLock(projectName, docName, async () => {
    const path = await documentPath(projectName, docName)
    const doc = await readDocument(path)
    if (!doc) return false
    const archive = Array.isArray(doc.archive) ? doc.archive : []
    const next = change(archive)
    if (next === archive) return false
    await writeTextFile(path, JSON.stringify({ ...doc, archive: next }))
    return true
  })
  if (changed) emitArchiveChanged(projectName, docName)
  return changed
}

/** Put an item in the archive, newest first. `item` is `{ kind, title, … }`. */
export const archiveItem = (projectName, docName, item) => updateArchive(projectName, docName, (archive) => [
  { id: newArchiveId(), archivedAt: new Date().toISOString(), ...item },
  ...archive,
])

/** Take an item out of the archive for good, or because it was restored. */
export const removeArchivedItem = (projectName, docName, id) => updateArchive(projectName, docName, (archive) => (
  archive.some((item) => item.id === id) ? archive.filter((item) => item.id !== id) : archive
))

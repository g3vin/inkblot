/**
 * noteCharacterLinks.js — keeping a note's characters (`note.characters`, tree paths)
 * pointing at them through renames and moves.
 *
 * Notes live in each document, so a character renamed is a path to rewrite wherever a
 * note names it. Notes the page holds are rewritten in memory (useSidebarCommands hears
 * NOTE_CHARACTERS_MOVED_EVENT): a document open in a pane would otherwise autosave the
 * old path back. Every other document is rewritten on disk, notes only, under its lock
 * (saveDocumentNotes); the panes' own documents are left to their autosave.
 *
 * A delete rewrites nothing: the note keeps the path, shown missing, for the writer to
 * change.
 */
import { editorRegistry } from '../bridge'
import { isTextDoc } from './docKind'
import { listProjectTree, loadDocument, saveDocumentNotes } from './FileSystem'
import { observeEntries, remapPath } from './entryOperations'
import { isCharacterDoc } from './storyStructure'

export const NOTE_CHARACTERS_MOVED_EVENT = 'inkblot:note-characters-moved'

/** `notes` with each character under `entryPath` at its new path; the same array when none was. */
export function remapNoteCharacters(notes, entryPath, nextPath, type) {
  if (!Array.isArray(notes)) return notes
  let changed = false
  const next = notes.map((note) => {
    if (!Array.isArray(note?.characters) || !note.characters.length) return note
    const characters = note.characters.map((path) => remapPath(path, entryPath, nextPath, type) ?? path)
    if (characters.every((path, i) => path === note.characters[i])) return note
    changed = true
    return { ...note, characters: [...new Set(characters)] }
  })
  return changed ? next : notes
}

const textDocs = (node, out = []) => {
  if (!node) return out
  if (node.type === 'file') {
    if (isTextDoc(node.path)) out.push(node.path)
    return out
  }
  for (const child of node.children || []) textDocs(child, out)
  return out
}

/** Only a character's path can be on a note, so only those (or a folder) are followed. */
const mayNameCharacter = (entryPath, nextPath, type) => (
  type === 'folder' || isCharacterDoc(entryPath) || isCharacterDoc(nextPath)
)

async function follow(projectName, entryPath, nextPath, type) {
  if (!projectName || !mayNameCharacter(entryPath, nextPath, type)) return
  window.dispatchEvent(new CustomEvent(NOTE_CHARACTERS_MOVED_EVENT, { detail: { projectName, entryPath, nextPath, type } }))
  try {
    const inPanes = new Set(['primary', 'secondary'].map((pane) => editorRegistry.resolve(pane)?.docPath).filter(Boolean))
    for (const docPath of textDocs(await listProjectTree(projectName))) {
      if (inPanes.has(docPath)) continue
      const notes = (await loadDocument(projectName, docPath))?.notes
      const next = remapNoteCharacters(notes, entryPath, nextPath, type)
      if (next !== notes) await saveDocumentNotes(projectName, docPath, next)
    }
  } catch (error) {
    console.error('[noteCharacterLinks] could not update notes after a move:', error)
  }
}

let observing = null

/** Follow characters through renames and moves. Installed once. */
export function observeNoteCharacterPaths() {
  if (observing) return observing
  const nameOf = (path) => path.split('/').pop()
  const unobserve = observeEntries({
    willChange: () => {},
    renamed: (projectName, entryPath, nextPath, type) => { void follow(projectName, entryPath, nextPath, type) },
    moved: (projectName, entryPath, targetFolder, type) => {
      void follow(projectName, entryPath, targetFolder ? `${targetFolder}/${nameOf(entryPath)}` : nameOf(entryPath), type)
    },
  })
  observing = () => {
    unobserve()
    observing = null
  }
  return observing
}

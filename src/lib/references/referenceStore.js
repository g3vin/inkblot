/**
 * referenceStore.js — the project's sources, and each document's citation settings.
 *
 * The library is one file at the project root, `.inkblot-references.json` (a dotfile,
 * so the tree never lists it):
 *
 *   { version: 1, defaultStyle, references: [Reference], attachments: { docPath: [id] } }
 *
 * A source is the project's, so a book cited in three chapters is one record, edited
 * once. Which documents it belongs to is kept here too, rather than in each document's
 * file, so the project view can say where every source is used without reading every
 * document (each one carries its whole version history). Renames, moves, duplicates
 * and deletes keep it true through `relocateAttachments` (called by FileSystem.js,
 * beside the version sidecar's relocation).
 *
 * A document's own settings — its style, and how its bibliography is built — live in
 * its file (`citations`), carried forward by every save like `archive` is.
 *
 * Writes are serialized by the same lock the autosave uses (the library under a
 * reserved name), and each is followed by a `references:changed` window event.
 */
import { exists, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { isCanvasDoc } from '../docKind'
import { getProjectRoot, joinPath } from '../projectPaths'
import { withDocLock } from '../docLock'
import { DEFAULT_STYLE } from './styles'
import { kindSpec, missingFields } from './referenceKinds'

export const LIBRARY_FILE = '.inkblot-references.json'
export const REFERENCES_CHANGED_EVENT = 'references:changed'
/** The lock key the library is written under — not a document name anyone can make. */
const LIBRARY_LOCK = '\u0000references'

export const DEFAULT_BIBLIOGRAPHY = { include: 'cited', annotated: false, inPrint: true }

export const newReferenceId = () => `ref-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const emptyLibrary = () => ({ version: 1, defaultStyle: DEFAULT_STYLE, references: [], attachments: {} })

const emit = (detail) => {
  try {
    window.dispatchEvent(new CustomEvent(REFERENCES_CHANGED_EVENT, { detail }))
  } catch {
    void 0
  }
}

/* ---------------- the record ---------------- */

const now = () => new Date().toISOString()

/** A record with every field present, whatever an older or hand-edited file held. */
export function normalizeReference(raw = {}) {
  const fields = {}
  for (const [key, value] of Object.entries(raw.fields || {})) {
    const text = value == null ? '' : String(value).trim()
    if (text) fields[key] = text
  }
  return {
    id: String(raw.id || newReferenceId()),
    kind: kindSpec(raw.kind).id,
    contributors: (Array.isArray(raw.contributors) ? raw.contributors : [])
      .filter((c) => c && (c.literal || c.family || c.given))
      .map((c) => ({
        role: c.role || 'author',
        ...(c.literal ? { literal: String(c.literal) } : { family: String(c.family || ''), given: String(c.given || '') }),
      })),
    fields,
    annotation: String(raw.annotation || ''),
    note: String(raw.note || ''),
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    status: raw.status || 'incomplete',
    ...(raw.origin ? { origin: { kind: String(raw.origin.kind || 'manual'), input: String(raw.origin.input || '') } } : {}),
    candidates: Array.isArray(raw.candidates) ? raw.candidates : [],
    ...(raw.error ? { error: String(raw.error) } : {}),
    createdAt: raw.createdAt || now(),
    updatedAt: raw.updatedAt || now(),
  }
}

/** `complete` or `incomplete`, by the kind's required fields; a lookup's state stays. */
export const settledStatus = (ref) => (missingFields(ref.kind, ref.fields).length ? 'incomplete' : 'complete')

/** Apply a `ReferencePatch`: present keys replace, `fields` merges, '' removes a field. */
export function applyPatch(ref, patch = {}) {
  const next = { ...ref, updatedAt: now() }
  if (patch.kind) next.kind = kindSpec(patch.kind).id
  if (Array.isArray(patch.contributors)) next.contributors = patch.contributors
  if (patch.fields) {
    next.fields = { ...ref.fields }
    for (const [key, value] of Object.entries(patch.fields)) {
      if (value == null || String(value).trim() === '') delete next.fields[key]
      else next.fields[key] = String(value)
    }
  }
  for (const key of ['annotation', 'note']) if (typeof patch[key] === 'string') next[key] = patch[key]
  if (Array.isArray(patch.tags)) next.tags = patch.tags
  const normalized = normalizeReference(next)
  if (normalized.status !== 'resolving') {
    normalized.status = settledStatus(normalized)
    delete normalized.error
  }
  return normalized
}

/* ---------------- the library file ---------------- */

const libraryPathFor = (root) => joinPath(root, LIBRARY_FILE)

async function readLibraryAt(root) {
  const path = libraryPathFor(root)
  try {
    if (!(await exists(path))) return emptyLibrary()
    const data = JSON.parse((await readTextFile(path)) || '{}')
    return {
      version: 1,
      defaultStyle: data.defaultStyle || DEFAULT_STYLE,
      references: (Array.isArray(data.references) ? data.references : []).map(normalizeReference),
      attachments: data.attachments && typeof data.attachments === 'object' ? data.attachments : {},
    }
  } catch (error) {
    console.error('[references] could not read the library', error)
    return emptyLibrary()
  }
}

export async function loadLibrary(projectName) {
  if (!projectName) return emptyLibrary()
  return readLibraryAt(await getProjectRoot(projectName))
}

/**
 * Change the library under its lock. `change` gets the library and returns the next
 * one, or the same object for no change.
 */
async function updateLibraryAt(root, projectName, change, detail = {}) {
  const changed = await withDocLock(projectName || root, LIBRARY_LOCK, async () => {
    const library = await readLibraryAt(root)
    const next = await change(library)
    if (!next || next === library) return false
    await writeTextFile(libraryPathFor(root), JSON.stringify(next, null, 1))
    return true
  })
  if (changed) emit({ projectName, root, ...detail })
  return changed
}

export const updateLibrary = async (projectName, change, detail) => (
  projectName ? updateLibraryAt(await getProjectRoot(projectName), projectName, change, detail) : false
)

const withAttachment = (attachments, docPath, ids, attached) => {
  const current = attachments[docPath] || []
  const set = new Set(current)
  for (const id of ids) (attached ? set.add(id) : set.delete(id))
  if (set.size === current.length && current.every((id) => set.has(id))) return attachments
  const next = { ...attachments }
  if (set.size) next[docPath] = attached ? [...current, ...ids.filter((id) => !current.includes(id))] : current.filter((id) => set.has(id))
  else delete next[docPath]
  return next
}

/** Add a source, attached to `docPath` when there is one. */
export const addReference = (projectName, record, docPath = null) => updateLibrary(projectName, (library) => ({
  ...library,
  references: [normalizeReference(record), ...library.references.filter((ref) => ref.id !== record.id)],
  attachments: docPath && !isCanvasDoc(docPath) ? withAttachment(library.attachments, docPath, [record.id], true) : library.attachments,
}), { docName: docPath })

/** Replace a source by id, through `change(ref) → ref`. */
export const changeReference = (projectName, id, change) => updateLibrary(projectName, (library) => {
  const index = library.references.findIndex((ref) => ref.id === id)
  if (index < 0) return library
  const next = change(library.references[index])
  if (!next || next === library.references[index]) return library
  const references = [...library.references]
  references[index] = normalizeReference(next)
  return { ...library, references }
})

export const patchReference = (projectName, id, patch) => changeReference(projectName, id, (ref) => applyPatch(ref, patch))

/** Delete a source, and take it off every document. Citations of it in the text stay,
 *  and read as a missing source, so deleting is visible rather than silent. */
export const removeReference = (projectName, id) => updateLibrary(projectName, (library) => {
  if (!library.references.some((ref) => ref.id === id)) return library
  const attachments = {}
  for (const [doc, ids] of Object.entries(library.attachments)) {
    const kept = ids.filter((other) => other !== id)
    if (kept.length) attachments[doc] = kept
  }
  return { ...library, references: library.references.filter((ref) => ref.id !== id), attachments }
})

export const setAttached = (projectName, docPath, ids, attached) => (
  !docPath || isCanvasDoc(docPath)
    ? Promise.resolve(false)
    : updateLibrary(projectName, (library) => {
      const known = ids.filter((id) => library.references.some((ref) => ref.id === id))
      const attachments = withAttachment(library.attachments, docPath, known, attached)
      return attachments === library.attachments ? library : { ...library, attachments }
    }, { docName: docPath })
)

export const setDefaultStyle = (projectName, style) => updateLibrary(projectName, (library) => (
  library.defaultStyle === style ? library : { ...library, defaultStyle: style }
))

/**
 * Keep attachments with their documents when the tree changes. `toRel` null is a
 * delete; `copy` keeps the original's and gives the copy the same. A folder carries
 * every document under it.
 */
export async function relocateAttachments(root, fromRel, toRel, { folder = false, copy = false } = {}) {
  if (!(await exists(libraryPathFor(root)))) return
  await updateLibraryAt(root, null, (library) => {
    const moved = (path) => (folder ? path === fromRel || path.startsWith(`${fromRel}/`) : path === fromRel)
    let touched = false
    const attachments = {}
    for (const [doc, ids] of Object.entries(library.attachments)) {
      if (!moved(doc)) {
        attachments[doc] = ids
        continue
      }
      touched = true
      if (copy) attachments[doc] = ids
      if (toRel) attachments[toRel + doc.slice(fromRel.length)] = [...ids]
    }
    return touched ? { ...library, attachments } : library
  })
}

/* ---------------- a document's settings ---------------- */

const documentPath = async (projectName, docName) => joinPath(await getProjectRoot(projectName), `${docName}.json`)

const normalizeCitations = (raw) => ({
  ...(raw?.style ? { style: String(raw.style) } : {}),
  bibliography: { ...DEFAULT_BIBLIOGRAPHY, ...(raw?.bibliography || {}) },
})

/** `{ style?, bibliography }` for a text document; defaults when it has none. */
export async function getDocCitations(projectName, docName) {
  if (!projectName || !docName || isCanvasDoc(docName)) return normalizeCitations(null)
  try {
    const doc = JSON.parse((await readTextFile(await documentPath(projectName, docName))) || '{}')
    return normalizeCitations(doc.citations)
  } catch {
    return normalizeCitations(null)
  }
}

/** Change a document's settings under its lock, the way the archive is changed. */
export async function updateDocCitations(projectName, docName, change) {
  if (!projectName || !docName || isCanvasDoc(docName)) return false
  const changed = await withDocLock(projectName, docName, async () => {
    const path = await documentPath(projectName, docName)
    let doc
    try {
      doc = JSON.parse((await readTextFile(path)) || '{}')
    } catch {
      return false
    }
    const current = normalizeCitations(doc.citations)
    const next = change(current)
    if (!next || JSON.stringify(next) === JSON.stringify(current)) return false
    await writeTextFile(path, JSON.stringify({ ...doc, citations: next }))
    return true
  })
  if (changed) emit({ projectName, docName })
  return changed
}

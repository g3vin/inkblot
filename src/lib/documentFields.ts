/**
 * documentFields.ts — the few fields a writer gives a document beyond its words: the
 * names a story entry also answers to (`aliases`, which name tags find in the text),
 * and the character whose point of view a document is told from (`pov`).
 *
 * Also whether an entry is tagged even where its name reads as an ordinary word
 * (`alwaysTag`, nameContext.ts).
 *
 * Saved with the project, in `<projectRoot>/.story/fields.json`, keyed by tree path —
 * not in each document: a canvas must stay JSON Canvas, both savers write only the
 * keys they know, and name tags need every entry's aliases without opening each one.
 * The page holds the open project's in memory (`useDocumentFields`), read when the
 * project opens, and keeps the paths right through renames, moves and deletes
 * (`observeDocumentFieldPaths`).
 */
import { useSyncExternalStore } from 'react'
import { exists, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { getProjectRoot, joinPath } from './projectPaths'
import { observeEntries, remapKeys, remapPath, type EntryType } from './entryOperations'

export interface DocumentFields {
  aliases?: string[]
  /** Tree path of the point-of-view character. */
  pov?: string
  /** A story entry tagged even where its name reads as an ordinary word. */
  alwaysTag?: boolean
}

export type DocumentFieldMap = Record<string, DocumentFields>

interface FieldState {
  project: string | null
  documents: DocumentFieldMap
}

const EMPTY: FieldState = { project: null, documents: {} }

let state: FieldState = EMPTY
const listeners = new Set<() => void>()

const publish = (project: string | null, documents: DocumentFieldMap) => {
  state = { project, documents }
  listeners.forEach((listener) => listener())
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
const getState = () => state

/** Every document's fields for the open project, re-rendering when they change. */
export function useDocumentFields(): DocumentFieldMap {
  return useSyncExternalStore(subscribe, getState, getState).documents
}

/** One document's fields, now. */
export const documentFields = (path: string | null | undefined): DocumentFields => (path && state.documents[path]) || {}

/** The project whose fields are held: the open one. */
export const fieldsProject = (): string | null => state.project

/** Every document's fields, now. */
export const allDocumentFields = (): DocumentFieldMap => state.documents

export const onDocumentFieldsChange = subscribe

/* ---------------- cleaning ---------------- */

/** Trimmed, non-empty, each once (ignoring case), in the order given. */
export function cleanAliases(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const aliases: string[] = []
  for (const value of raw) {
    if (typeof value !== 'string') continue
    const alias = value.trim()
    if (!alias || seen.has(alias.toLowerCase())) continue
    seen.add(alias.toLowerCase())
    aliases.push(alias)
  }
  return aliases
}

const cleanFields = (raw: unknown): DocumentFields | null => {
  if (!raw || typeof raw !== 'object') return null
  const { aliases, pov, alwaysTag } = raw as Record<string, unknown>
  const fields: DocumentFields = {}
  if (alwaysTag === true) fields.alwaysTag = true
  const cleanedAliases = cleanAliases(aliases)
  if (cleanedAliases.length) fields.aliases = cleanedAliases
  if (typeof pov === 'string' && pov) fields.pov = pov
  return Object.keys(fields).length ? fields : null
}

export function cleanFieldMap(raw: unknown): DocumentFieldMap {
  const documents: DocumentFieldMap = {}
  if (!raw || typeof raw !== 'object') return documents
  for (const [path, value] of Object.entries(raw as Record<string, unknown>)) {
    const fields = path ? cleanFields(value) : null
    if (fields) documents[path] = fields
  }
  return documents
}

/* ---------------- on disk ---------------- */

const fieldsPath = async (projectName: string) => joinPath(await getProjectRoot(projectName), '.story', 'fields.json')

async function readFromDisk(projectName: string): Promise<DocumentFieldMap> {
  const path = await fieldsPath(projectName)
  if (!(await exists(path))) return {}
  return cleanFieldMap(JSON.parse((await readTextFile(path)) || '{}')?.documents)
}

let latestRead = 0

/** Read a project's document fields from disk. */
export async function refreshDocumentFields(projectName: string | null | undefined): Promise<void> {
  const read = ++latestRead
  if (!projectName) {
    publish(null, {})
    return
  }
  let documents: DocumentFieldMap = {}
  try {
    documents = await readFromDisk(projectName)
  } catch (error) {
    console.warn('[documentFields] could not read the document fields:', error)
  }
  if (read === latestRead) publish(projectName, documents)
}

async function save(projectName: string, documents: DocumentFieldMap): Promise<boolean> {
  if (state.project === projectName) publish(projectName, documents)
  try {
    const root = await getProjectRoot(projectName)
    await mkdir(joinPath(root, '.story'), { recursive: true })
    await writeTextFile(await fieldsPath(projectName), JSON.stringify({ documents }, null, 2))
    return true
  } catch (error) {
    console.error('[documentFields] could not save the document fields:', error)
    return false
  }
}

/* ---------------- changing ---------------- */

/** Set (or, with an empty value, clear) one field of a document in the open project. */
export async function setDocumentField<K extends keyof DocumentFields>(path: string, key: K, value: DocumentFields[K] | null): Promise<boolean> {
  if (!state.project || !path) return false
  const next = cleanFields({ ...documentFields(path), [key]: value ?? undefined })
  const documents = { ...state.documents }
  if (next) documents[path] = next
  else delete documents[path]
  return save(state.project, documents)
}

/**
 * The fields after `entryPath` became `nextPath` (`null`: it was deleted). A document's
 * fields move with it, and a point of view on a moved character follows it; one on a
 * deleted character stays, shown missing, for the writer to choose again.
 */
export function remapFieldMap(documents: DocumentFieldMap, entryPath: string, nextPath: string | null, type: EntryType): DocumentFieldMap {
  const moved = remapKeys(documents, entryPath, nextPath, type)
  if (nextPath == null) return moved
  let changed = moved !== documents
  const next: DocumentFieldMap = {}
  for (const [path, fields] of Object.entries(moved)) {
    const pov = fields.pov ? remapPath(fields.pov, entryPath, nextPath, type) : undefined
    if (typeof pov === 'string' && pov !== fields.pov) {
      next[path] = { ...fields, pov }
      changed = true
    } else {
      next[path] = fields
    }
  }
  return changed ? next : documents
}

async function follow(projectName: string, entryPath: string, nextPath: string | null, type: EntryType) {
  try {
    const documents = state.project === projectName ? state.documents : await readFromDisk(projectName)
    const next = remapFieldMap(documents, entryPath, nextPath, type)
    if (next !== documents) await save(projectName, next)
  } catch (error) {
    console.error('[documentFields] could not follow a rename:', error)
  }
}

let observing: (() => void) | null = null

/** Keep the fields on the right paths through renames, moves and deletes. Installed once. */
export function observeDocumentFieldPaths(): () => void {
  if (observing) return observing
  const nameOf = (path: string) => path.split('/').pop() as string
  const unobserve = observeEntries({
    willChange: () => {},
    renamed: (projectName, entryPath, nextPath, type) => { void follow(projectName, entryPath, nextPath, type) },
    moved: (projectName, entryPath, targetFolder, type) => {
      void follow(projectName, entryPath, targetFolder ? `${targetFolder}/${nameOf(entryPath)}` : nameOf(entryPath), type)
    },
    deleted: (projectName, entryPath, type) => { void follow(projectName, entryPath, null, type) },
  })
  observing = () => {
    unobserve()
    observing = null
  }
  return observing
}

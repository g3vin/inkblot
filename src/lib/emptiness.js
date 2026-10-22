/**
 * emptiness.js — whether a document or folder holds anything worth asking about.
 *
 * Deleting something blank needs no "Are you sure?": there is nothing to lose. Every
 * test here leans towards "has content" — a false "empty" deletes the writer's work
 * without asking, a false "has content" only costs one extra click. Notes have their
 * own test, `isNoteEmpty` in noteUtils.js.
 */
import { readDir } from '@tauri-apps/plugin-fs'
import { getDocKind } from './docKind'
import { loadDocument } from './FileSystem'
import { getProjectRoot, joinPath } from './projectPaths'
import { getVersions } from './versionStore'

const hasItems = (value) => Array.isArray(value) && value.length > 0

/** Nodes that hold nothing of their own: blank when everything inside them is. */
const EMPTY_LEAVES = new Set(['paragraph', 'heading', 'hardBreak'])

/** TipTap JSON (a doc, or its content array) with no text and no images, rules, tables… */
export const isRichTextEmpty = (content) => {
  const nodes = Array.isArray(content) ? content : (Array.isArray(content?.content) ? content.content : [])
  return nodes.every((node) => {
    if (!node || typeof node !== 'object') return true
    if (node.type === 'text') return !String(node.text || '').trim()
    if (hasItems(node.content)) return isRichTextEmpty(node.content)
    return EMPTY_LEAVES.has(node.type)
  })
}

const hasKeys = (value) => !!value && typeof value === 'object' && Object.keys(value).length > 0

/** A map that has never been set up, or a blank sheet or Earth with nothing placed on it. */
const isMapEmpty = (map) => {
  if (map.setupPending === true) return true
  if (map.mapKind !== 'blank' && map.mapKind !== 'earth') return false
  if (map.background?.image) return false
  return !['pins', 'routes', 'regions', 'terrains', 'labels', 'travelers'].some((key) => hasItems(map[key]))
}

/**
 * A document's file, as read from disk, by the kind its path names. A timeline view
 * holds only how the project's chronology is shown — the events are the project's —
 * so deleting one never loses writing.
 */
export const isDocumentDataEmpty = (path, data) => {
  if (data === null || data === undefined) return true
  if (typeof data !== 'object') return false
  switch (getDocKind(path)) {
    case 'canvas':
      return !hasKeys(data.nodes) && !hasItems(data.nodes) && !hasKeys(data.edges) && !hasItems(data.edges)
    case 'map':
      return data.type === 'map' && isMapEmpty(data)
    case 'timeline':
      return data.type === 'timeline-view'
    default:
      return isRichTextEmpty(data.content)
        && !hasItems(data.notes)
        && !hasItems(data.archive)
        && !hasKeys(data.citations)
        && !hasItems(data.timeline)
  }
}

/** A file on disk, history included: a cleared page with saved versions still has something to lose. */
async function isFileEmpty(projectName, path) {
  const data = await loadDocument(projectName, path)
  if (!isDocumentDataEmpty(path, data)) return false
  return !hasItems(await getVersions(projectName, path))
}

/** Every document in the folder is empty and nothing else (a picture, a PDF) sits in it. */
async function isFolderEmpty(projectName, root, path) {
  const entries = await readDir(joinPath(root, path))
  for (const entry of entries) {
    if (!entry.name || entry.name.startsWith('.')) continue
    const child = `${path}/${entry.name}`
    if (entry.isDirectory) {
      if (!(await isFolderEmpty(projectName, root, child))) return false
    } else if (!entry.name.endsWith('.json') || !(await isFileEmpty(projectName, child.replace(/\.json$/, '')))) {
      return false
    }
  }
  return true
}

/** Whether a tree entry can be deleted without asking. Any failure to read counts as content. */
export async function isEntryEmpty(projectName, entryPath, type = 'file') {
  try {
    if (type === 'folder') return await isFolderEmpty(projectName, await getProjectRoot(projectName), entryPath)
    return await isFileEmpty(projectName, entryPath)
  } catch {
    return false
  }
}

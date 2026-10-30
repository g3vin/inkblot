/**
 * docExcerpts.js — the opening lines of the documents a writer has lately had open,
 * so the landing page can draw each project's pile of paper with real words on it
 * without reading a single document from disk.
 *
 * An excerpt is taken whenever a document is loaded into a pane or saved, from the
 * top-level blocks only and never past EXCERPT_BLOCKS / EXCERPT_CHARS, so a long
 * manuscript costs no more than a short one. Each project keeps the latest
 * PER_PROJECT documents; entries follow renames and moves in the tree
 * (observeEntries) and a project's rename or deletion (projectLifecycle.js).
 *
 * The cache rides on the app preferences, which are read before the first render,
 * so the landing page draws its piles on its first frame.
 */
import { observeEntries, remapKeys } from './entryOperations'
import { getPreference, setPreference } from './preferences'

const KEY = 'inkblot.landing.excerpts'
const VERSION = 1
export const EXCERPT_BLOCKS = 6
export const EXCERPT_CHARS = 360
const PER_PROJECT = 8
const SAVE_DELAY_MS = 1000

/** @typedef {{ t: 'h1' | 'h2' | 'h3' | 'p', x: string }} ExcerptBlock */
/** @typedef {{ v: number, blocks: ExcerptBlock[], at: number }} Excerpt */

const HEADINGS = { 1: 'h1', 2: 'h2' }
const blockKind = (name, level) => (name === 'heading' ? HEADINGS[level] ?? 'h3' : 'p')

/**
 * Take blocks from `next()` (which yields `{ name, level, text }` or null) until the
 * budget runs out. Empty blocks are skipped: a page's blank lines are not its words.
 */
function collect(next) {
  const blocks = []
  let left = EXCERPT_CHARS
  for (let block = next(); block && blocks.length < EXCERPT_BLOCKS && left > 0; block = next()) {
    const text = block.text.replace(/\s+/g, ' ').trim()
    if (!text) continue
    const x = text.length > left ? `${text.slice(0, left).trimEnd()}…` : text
    blocks.push({ t: blockKind(block.name, block.level), x })
    left -= x.length
  }
  return blocks
}

const textOfJson = (node) => (node?.type === 'text'
  ? node.text || ''
  : Array.isArray(node?.content) ? node.content.map(textOfJson).join(node.type === 'paragraph' ? '' : ' ') : '')

/** The excerpt of a document's TipTap JSON (`{ type: 'doc', content }` or its content array). */
export function excerptOfContent(json) {
  const nodes = Array.isArray(json) ? json : Array.isArray(json?.content) ? json.content : []
  let index = 0
  return collect(() => {
    const node = nodes[index++]
    return node ? { name: node.type, level: node.attrs?.level, text: textOfJson(node) } : null
  })
}

/** The excerpt of a live ProseMirror document, walking only as far as the budget. */
export function excerptOfNode(doc) {
  if (!doc) return []
  let index = 0
  return collect(() => {
    if (index >= doc.childCount) return null
    const node = doc.child(index++)
    return { name: node.type.name, level: node.attrs?.level, text: node.textContent }
  })
}

/* ---------------- The store ---------------- */

let state = null
let saveTimer = 0
// Strictly increasing, so two excerpts noted in the same millisecond still have an order.
let lastAt = 0
const stamp = () => {
  lastAt = Math.max(Date.now(), lastAt + 1)
  return lastAt
}
const listeners = new Set()

const load = () => {
  if (state) return state
  try {
    const stored = JSON.parse(getPreference(KEY) || '{}')
    state = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {}
  } catch {
    state = {}
  }
  return state
}

const commit = (next) => {
  state = next
  listeners.forEach((listener) => listener())
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => setPreference(KEY, JSON.stringify(state)), SAVE_DELAY_MS)
}

export function subscribeExcerpts(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** `{ [project]: { [docPath]: Excerpt } }` — stable until something changes. */
export const excerptsSnapshot = () => load()

/** @returns {Excerpt | null} */
export function excerptFor(projectName, docPath) {
  const entry = load()[projectName]?.[docPath]
  return entry?.v === VERSION ? entry : null
}

const sameBlocks = (a, b) => a.length === b.length && a.every((block, i) => block.t === b[i].t && block.x === b[i].x)

export function noteExcerpt(projectName, docPath, blocks) {
  if (!projectName || !docPath || !Array.isArray(blocks)) return
  const all = load()
  const project = all[projectName] || {}
  const known = project[docPath]
  if (known?.v === VERSION && sameBlocks(known.blocks, blocks)) return
  // Newest first, so the oldest beyond PER_PROJECT can be let go.
  const kept = Object.entries({ ...project, [docPath]: { v: VERSION, blocks, at: stamp() } })
    .sort(([, a], [, b]) => b.at - a.at)
    .slice(0, PER_PROJECT)
  commit({ ...all, [projectName]: Object.fromEntries(kept) })
}

export function renameProjectExcerpts(from, to) {
  const all = load()
  if (!all[from] || from === to) return
  const { [from]: project, ...rest } = all
  commit({ ...rest, [to]: project })
}

export function dropProjectExcerpts(projectName) {
  const all = load()
  if (!all[projectName]) return
  const { [projectName]: _dropped, ...rest } = all
  commit(rest)
}

/** Follow an entry renamed, moved or deleted (`nextPath` null) in the tree. */
export function remapExcerpts(projectName, entryPath, nextPath, type) {
  const all = load()
  const project = all[projectName]
  if (!project) return
  const moved = remapKeys(project, entryPath, nextPath, type)
  if (moved !== project) commit({ ...all, [projectName]: moved })
}

/** Forget projects that no longer exist, given the ones that do. */
export function pruneExcerpts(projectNames) {
  const all = load()
  const keep = new Set(projectNames)
  const stale = Object.keys(all).filter((name) => !keep.has(name))
  if (!stale.length) return
  commit(Object.fromEntries(Object.entries(all).filter(([name]) => keep.has(name))))
}

/** For tests: start again from what the preferences hold. */
export function resetExcerptsForTests() {
  state = null
  window.clearTimeout(saveTimer)
}

let observing = null

/**
 * Keep excerpts (and the recent list, which shares the problem) on the right paths
 * when an entry is renamed or moved, and forget them when it is deleted. Installed
 * once, from Editor.
 */
export function observeExcerptPaths(remapOthers = () => {}) {
  if (observing) return observing
  const parentOf = (path) => path.split('/').slice(0, -1).join('/')
  const nameOf = (path) => path.split('/').pop()
  const unobserve = observeEntries({
    willChange: () => {},
    renamed: (projectName, entryPath, nextPath, type) => {
      remapExcerpts(projectName, entryPath, nextPath, type)
      remapOthers(projectName, entryPath, nextPath, type)
    },
    moved: (projectName, entryPath, targetFolder, type) => {
      const nextPath = targetFolder ? `${targetFolder}/${nameOf(entryPath)}` : nameOf(entryPath)
      if (parentOf(entryPath) === targetFolder) return
      remapExcerpts(projectName, entryPath, nextPath, type)
      remapOthers(projectName, entryPath, nextPath, type)
    },
    deleted: (projectName, entryPath, type) => {
      remapExcerpts(projectName, entryPath, null, type)
      remapOthers(projectName, entryPath, null, type)
    },
  })
  observing = () => {
    unobserve()
    observing = null
  }
  return observing
}

/**
 * The documents opened lately, per project, newest first — what the file tree's
 * clock button filters to (ProjectTree.swift's `recent`) and what the landing page
 * piles up for each project. Noted as the page reports the active editor, and kept
 * across launches.
 */
import { remapKeys } from './entryOperations'
import { getPreference, setPreference } from './preferences'

const KEY = 'inkblot.tree.recent'
const LIMIT = 20

// Preferences hold strings. A value that is not a JSON object (the store's default,
// or a list written before it was serialised) reads as nothing remembered.
const read = () => {
  try {
    const stored = JSON.parse(getPreference(KEY) || '{}')
    return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {}
  } catch {
    return {}
  }
}

const write = (all) => setPreference(KEY, JSON.stringify(all))

export function recentDocs(projectName) {
  if (!projectName) return []
  const list = read()[projectName]
  return Array.isArray(list) ? list : []
}

export function noteOpened(projectName, docPath) {
  if (!projectName || !docPath) return
  const all = read()
  const list = [docPath, ...recentDocs(projectName).filter((path) => path !== docPath)].slice(0, LIMIT)
  if (JSON.stringify(list) === JSON.stringify(all[projectName])) return
  write({ ...all, [projectName]: list })
}

export function renameProjectRecents(from, to) {
  const all = read()
  if (!all[from] || from === to) return
  const { [from]: list, ...rest } = all
  write({ ...rest, [to]: list })
}

export function dropProjectRecents(projectName) {
  const all = read()
  if (!all[projectName]) return
  const { [projectName]: _dropped, ...rest } = all
  write(rest)
}

/** Follow an entry renamed, moved or deleted (`nextPath` null) in the tree. */
export function remapRecents(projectName, entryPath, nextPath, type) {
  const list = recentDocs(projectName)
  if (!list.length) return
  const byPath = Object.fromEntries(list.map((path, index) => [path, index]))
  const moved = remapKeys(byPath, entryPath, nextPath, type)
  if (moved === byPath) return
  const next = Object.entries(moved).sort(([, a], [, b]) => a - b).map(([path]) => path)
  write({ ...read(), [projectName]: next })
}

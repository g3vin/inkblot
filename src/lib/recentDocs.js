/**
 * The documents opened lately, per project, newest first — what the file tree's
 * clock button filters to (ProjectTree.swift's `recent`). Noted as the page reports
 * the active editor, and kept across launches.
 */
import { getPreference, setPreference } from './preferences'

const KEY = 'inkblot.tree.recent'
const LIMIT = 20

const read = () => {
  const stored = getPreference(KEY)
  return stored && typeof stored === 'object' ? stored : {}
}

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
  setPreference(KEY, { ...all, [projectName]: list })
}

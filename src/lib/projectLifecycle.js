/**
 * projectLifecycle.js — renaming and deleting a whole project, everywhere it is known.
 *
 * A project's name is the key to more than its folder: its writing stats, its tree's
 * order and expansion, its recent documents, the excerpts and counts the landing page
 * draws, and the session Editor restores. Every rename and delete goes through here,
 * whether it starts on the landing page or in the file tree, and ends by announcing
 * PROJECT_RENAMED / PROJECT_DELETED so Editor can move or drop the session it holds.
 */
import { deleteProject, renameProject } from './FileSystem'
import { dropProjectExcerpts, renameProjectExcerpts } from './docExcerpts'
import { migrateProjectTreeState } from './fileTreeState'
import { dropSummary, renameSummary } from './projectSummaries'
import { dropProjectRecents, renameProjectRecents } from './recentDocs'

/** `detail: { from, to }` */
export const PROJECT_RENAMED = 'inkblot:project-renamed'
/** `detail: { name }` */
export const PROJECT_DELETED = 'inkblot:project-deleted'

/** Why `name` can't be a new project's name, or '' when it can. */
export function projectNameProblem(name, existing = [], { except = '' } = {}) {
  const trimmed = (name || '').trim()
  if (!trimmed) return 'Give the project a name.'
  if (trimmed.startsWith('.') || trimmed.includes('/')) return 'That name can’t be used for a project.'
  const lower = trimmed.toLowerCase()
  if (existing.some((project) => project !== except && project.toLowerCase() === lower)) return 'A project with that name already exists.'
  return ''
}

/** Rename `from` to `to`. Resolves to the new name, or null when nothing was renamed. */
export async function renameProjectEverywhere(from, to) {
  const nextName = await renameProject(from, to)
  if (!nextName || nextName === from) return nextName
  const { statsService } = await import('../stats/service')
  statsService.renameProject(from, nextName)
  migrateProjectTreeState(from, nextName)
  renameProjectRecents(from, nextName)
  renameProjectExcerpts(from, nextName)
  renameSummary(from, nextName)
  window.dispatchEvent(new CustomEvent(PROJECT_RENAMED, { detail: { from, to: nextName } }))
  return nextName
}

/** Delete the project's folder and forget it. Resolves true on success. */
export async function deleteProjectEverywhere(name) {
  if (!(await deleteProject(name))) return false
  dropProjectRecents(name)
  dropProjectExcerpts(name)
  dropSummary(name)
  window.dispatchEvent(new CustomEvent(PROJECT_DELETED, { detail: { name } }))
  return true
}

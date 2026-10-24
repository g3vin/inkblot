/**
 * projectPrefetch.js — reading a project before it is opened, and remembering its
 * file tree after.
 *
 * Pointing at a project on the landing page starts reading its tree and the document
 * it will reopen on, so the double-click that follows finds them under way. A read
 * is handed out once and only while fresh: it is a head start on the real load, never
 * a second copy of the project to drift from the first.
 *
 * The last tree each project showed is kept for the session, so reopening a project
 * draws its sidebar at once while the tree is read again underneath.
 */
import { listProjectTree, loadDocument } from './FileSystem'

const FRESH_MS = 10_000

const pending = new Map()
const trees = new Map()

const take = (key) => {
  const entry = pending.get(key)
  pending.delete(key)
  return entry && performance.now() - entry.at < FRESH_MS ? entry.read : null
}

const start = (key, read) => {
  const entry = pending.get(key)
  if (entry && performance.now() - entry.at < FRESH_MS) return
  pending.set(key, { at: performance.now(), read: read() })
}

/** Start reading `projectName`'s tree and, when given, the document it opens on. */
export function prefetchProject(projectName, docPath = '') {
  if (!projectName) return
  start(`tree:${projectName}`, () => listProjectTree(projectName))
  if (docPath) start(`doc:${projectName}::${docPath}`, () => loadDocument(projectName, docPath))
}

/** The tree read ahead for `projectName`, else a fresh read. */
export function readProjectTree(projectName) {
  return take(`tree:${projectName}`) ?? listProjectTree(projectName)
}

/** The document read ahead, else a fresh read. */
export function readDocument(projectName, docPath) {
  return take(`doc:${projectName}::${docPath}`) ?? loadDocument(projectName, docPath)
}

export function rememberTree(projectName, tree) {
  if (projectName) trees.set(projectName, tree)
}

export function recallTree(projectName) {
  return trees.get(projectName) ?? null
}

/*
 * The project list as last read, for drawing at once while it is read again: a
 * project can appear or go outside the app, so the list is always re-read, but the
 * window need not be empty meanwhile. Names and where each lives are kept apart,
 * because the file tree reads only names.
 */
let projectNames = null
let projectRoots = {}

export function rememberProjects(names, roots = null) {
  projectNames = [...names]
  if (roots) projectRoots = { ...roots }
}

/** `{ names, roots }` as last read this session, or null before the first read. */
export function recallProjects() {
  return projectNames ? { names: projectNames, roots: projectRoots } : null
}

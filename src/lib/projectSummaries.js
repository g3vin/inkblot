/**
 * projectSummaries.js — how many files and words each project holds, for the line
 * under its pile on the landing page.
 *
 * Counting a project reads every document in it (project_word_counts), so it never
 * happens on the way to the first paint. The last count is kept in the app
 * preferences and drawn at once; a project is counted again when the writer leaves
 * it, and the landing page recounts any that are stale, one at a time while the
 * window is idle. Opening a project stops the queue: its loads come first.
 */
import { statsService } from '../stats/service'
import { getPreference, setPreference } from './preferences'

const KEY = 'inkblot.landing.summaries'
const IDLE_GAP_MS = 200
export const SUMMARY_STALE_MS = 6 * 60 * 60 * 1000

/** @typedef {{ files: number, words: number, at: number }} ProjectSummary */

let state = null
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
  setPreference(KEY, JSON.stringify(state))
  listeners.forEach((listener) => listener())
}

export function subscribeSummaries(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** `{ [project]: ProjectSummary }` — stable until something changes. */
export const summariesSnapshot = () => load()

/** @returns {ProjectSummary | null} */
export const summaryFor = (projectName) => load()[projectName] ?? null

export function setSummary(projectName, files, words) {
  if (!projectName) return
  const known = load()[projectName]
  if (known && known.files === files && known.words === words) {
    state = { ...state, [projectName]: { ...known, at: Date.now() } }
    setPreference(KEY, JSON.stringify(state))
    return
  }
  commit({ ...load(), [projectName]: { files, words, at: Date.now() } })
}

export async function refreshSummary(projectName) {
  if (!projectName) return
  const counts = await statsService.projectWordCounts(projectName)
  if (!Array.isArray(counts)) return
  setSummary(projectName, counts.length, counts.reduce((sum, doc) => sum + (doc.words || 0), 0))
}

export function renameSummary(from, to) {
  const all = load()
  if (!all[from] || from === to) return
  const { [from]: summary, ...rest } = all
  commit({ ...rest, [to]: summary })
}

export function dropSummary(projectName) {
  const all = load()
  if (!all[projectName]) return
  const { [projectName]: _dropped, ...rest } = all
  commit(rest)
}

let queue = []
let timer = 0
let running = false

const pump = () => {
  timer = 0
  if (running) return
  const next = queue.shift()
  if (!next) return
  running = true
  refreshSummary(next)
    .catch((error) => console.warn('[projectSummaries] could not count %s:', next, error))
    .finally(() => {
      running = false
      if (queue.length) timer = window.setTimeout(pump, IDLE_GAP_MS)
    })
}

/**
 * Count the projects in `names` (in that order) whose summary is missing or older than
 * `staleAfter`, one after another with a pause between, so the window stays quick.
 */
export function scheduleSummaryRefresh(names, { staleAfter = SUMMARY_STALE_MS } = {}) {
  const now = Date.now()
  const due = names.filter((name) => {
    const known = load()[name]
    return !known || now - known.at >= staleAfter
  })
  queue = [...queue.filter((name) => !due.includes(name)), ...due]
  if (queue.length && !timer && !running) timer = window.setTimeout(pump, IDLE_GAP_MS)
}

export function cancelSummaryRefresh() {
  queue = []
  window.clearTimeout(timer)
  timer = 0
}

/** For tests: start again from what the preferences hold. */
export function resetSummariesForTests() {
  state = null
  cancelSummaryRefresh()
}

/**
 * timelineStore.js — the project's chronology on disk and in memory, with undo.
 *
 * `<projectRoot>/.story/timeline.json`, beside the story calendar: a dot-folder, so the
 * file tree never lists it, and per project, because every timeline view, document,
 * map and canvas reads the same events.
 *
 * The page holds one copy per project. Everything that shows an event subscribes
 * (`subscribeTimeline`, or the `story-timeline:changed` window event), so an edit made
 * in one place is drawn everywhere in the same frame:
 *
 *   preview   a drag in progress: shown everywhere, not saved, not an undo step
 *   commit    an edit: saved, one undo step, and the end of any preview
 *
 * An undo step can carry `effects` — edits the same gesture made to other files (a
 * map's journey leg moved with its event) — each an `{ undo, redo }` pair of async
 * functions, run when the step is undone or redone, so one ⌘Z puts everything back.
 */
import { exists, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { getProjectRoot, joinPath } from '../projectPaths'
import { normalizeTimeline } from './timelineModel'

export const STORY_TIMELINE_CHANGED_EVENT = 'story-timeline:changed'

const HISTORY_LIMIT = 200

/** projectName → { timeline, committed, loading, undo, redo, listeners, writing } */
const projects = new Map()

const timelinePath = async (projectName) => joinPath(await getProjectRoot(projectName), '.story', 'timeline.json')

function entryFor(projectName) {
  let entry = projects.get(projectName)
  if (!entry) {
    entry = { timeline: null, committed: null, loading: null, undo: [], redo: [], listeners: new Set(), writing: Promise.resolve() }
    projects.set(projectName, entry)
  }
  return entry
}

async function readFromDisk(projectName) {
  try {
    const path = await timelinePath(projectName)
    if (!(await exists(path))) return normalizeTimeline(null)
    return normalizeTimeline(JSON.parse((await readTextFile(path)) || '{}'))
  } catch (error) {
    console.warn('[storyTimeline] could not read the chronology:', error)
    return normalizeTimeline(null)
  }
}

/** The chronology, loaded once per project and shared from then on. */
export function loadStoryTimeline(projectName) {
  if (!projectName) return Promise.resolve(normalizeTimeline(null))
  const entry = entryFor(projectName)
  if (entry.timeline) return Promise.resolve(entry.timeline)
  if (!entry.loading) {
    entry.loading = readFromDisk(projectName).then((timeline) => {
      // A commit that raced the read wins.
      if (!entry.timeline) {
        entry.timeline = timeline
        entry.committed = timeline
      }
      entry.loading = null
      return entry.timeline
    })
  }
  return entry.loading
}

/** What is loaded now, or null — for code that draws synchronously. */
export const peekStoryTimeline = (projectName) => projects.get(projectName)?.timeline ?? null

/** The last committed chronology (not a drag in progress), or null before it loads. */
export const peekCommittedTimeline = (projectName) => projects.get(projectName)?.committed ?? null

export function subscribeTimeline(projectName, listener) {
  const entry = entryFor(projectName)
  entry.listeners.add(listener)
  return () => entry.listeners.delete(listener)
}

function emit(projectName, entry, reason) {
  for (const listener of [...entry.listeners]) {
    try {
      listener(entry.timeline, reason)
    } catch (error) {
      console.error('[storyTimeline] a listener failed:', error)
    }
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(STORY_TIMELINE_CHANGED_EVENT, { detail: { projectName, timeline: entry.timeline, reason } }))
  }
}

function write(projectName, entry, timeline) {
  entry.writing = entry.writing.then(async () => {
    try {
      const root = await getProjectRoot(projectName)
      await mkdir(joinPath(root, '.story'), { recursive: true })
      await writeTextFile(await timelinePath(projectName), JSON.stringify(timeline, null, 2))
    } catch (error) {
      console.error('[storyTimeline] could not save the chronology:', error)
    }
  })
  return entry.writing
}

const resolveNext = (entry, next) => normalizeTimeline(typeof next === 'function' ? next(entry.committed) : next)

/** Show `next` everywhere without saving it — a drag in progress. */
export function previewStoryTimeline(projectName, next) {
  const entry = entryFor(projectName)
  if (!entry.committed) return
  entry.timeline = resolveNext(entry, next)
  emit(projectName, entry, 'preview')
}

/** Drop a preview: back to the last committed chronology. */
export function cancelTimelinePreview(projectName) {
  const entry = projects.get(projectName)
  if (!entry || entry.timeline === entry.committed) return
  entry.timeline = entry.committed
  emit(projectName, entry, 'cancel')
}

/**
 * Save an edit as one undo step. `next` is a chronology or a function of the last
 * committed one. `effects` are the gesture's edits to other files (see the header).
 * Resolves once written.
 */
export async function commitStoryTimeline(projectName, next, { label = 'Edit timeline', effects = [] } = {}) {
  if (!projectName) return null
  await loadStoryTimeline(projectName)
  const entry = entryFor(projectName)
  const before = entry.committed
  const after = resolveNext(entry, next)
  entry.timeline = after
  entry.committed = after
  entry.undo.push({ label, before, after, effects })
  if (entry.undo.length > HISTORY_LIMIT) entry.undo.shift()
  entry.redo = []
  emit(projectName, entry, 'commit')
  await write(projectName, entry, after)
  return after
}

async function step(projectName, from, to, direction) {
  const entry = projects.get(projectName)
  const item = entry?.[from].pop()
  if (!item) return false
  entry[to].push(item)
  const timeline = direction === 'undo' ? item.before : item.after
  entry.timeline = timeline
  entry.committed = timeline
  emit(projectName, entry, direction)
  const effects = direction === 'undo' ? [...item.effects].reverse() : item.effects
  for (const effect of effects) {
    try {
      await effect[direction]?.()
    } catch (error) {
      console.error(`[storyTimeline] could not ${direction} part of “${item.label}”:`, error)
    }
  }
  await write(projectName, entry, timeline)
  return true
}

export const undoStoryTimeline = (projectName) => step(projectName, 'undo', 'redo', 'undo')
export const redoStoryTimeline = (projectName) => step(projectName, 'redo', 'undo', 'redo')

export function timelineHistoryState(projectName) {
  const entry = projects.get(projectName)
  return {
    canUndo: Boolean(entry?.undo.length),
    canRedo: Boolean(entry?.redo.length),
    undoLabel: entry?.undo.at(-1)?.label ?? null,
    redoLabel: entry?.redo.at(-1)?.label ?? null,
  }
}

/**
 * Apply `rewrite` to the chronology and to every undo snapshot, without making it an
 * undo step — a document renamed elsewhere, which undo must not take back to its old
 * path. Loads the chronology first if nothing has yet; resolves once written.
 */
export async function rewriteStoryTimeline(projectName, rewrite) {
  if (!projectName) return false
  await loadStoryTimeline(projectName)
  const entry = entryFor(projectName)
  const next = rewrite(entry.committed)
  if (next === entry.committed) return false
  const swap = (item) => ({ ...item, before: rewrite(item.before), after: rewrite(item.after) })
  entry.undo = entry.undo.map(swap)
  entry.redo = entry.redo.map(swap)
  entry.committed = next
  entry.timeline = next
  emit(projectName, entry, 'rewrite')
  await write(projectName, entry, next)
  return true
}

/**
 * Apply `edit` to the chronology without an undo step and without touching history —
 * the chronology following something that changed elsewhere and has its own undo (a
 * leg moved on its map, a passage deleted in its document).
 */
export async function replaceStoryTimeline(projectName, edit) {
  if (!projectName) return false
  await loadStoryTimeline(projectName)
  const entry = entryFor(projectName)
  const next = normalizeTimeline(edit(entry.committed))
  entry.committed = next
  entry.timeline = next
  emit(projectName, entry, 'replace')
  await write(projectName, entry, next)
  return true
}

/** Forget a project (closed, or in tests). */
export function resetStoryTimeline(projectName) {
  if (projectName === undefined) projects.clear()
  else projects.delete(projectName)
}

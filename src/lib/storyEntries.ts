/**
 * storyEntries.ts — the entries a story is made of (characters, places, a writer's own
 * lists: every document under a preset folder but the book's chapters), with the names
 * each answers to, for name tags (extensions/EntityMentions.js) and the character
 * pickers (point of view, a note's characters).
 *
 * Built from the tree the file tree last read (`onTreeRemembered`), the folder types
 * (folderPresets.ts) and the aliases (documentFields.ts), so it never reads the disk,
 * and rebuilt only when one of those changes. Editors read it without React
 * (`getNameIndex`, `onStoryEntriesChange`); the chrome through `useStoryEntries`.
 * `buildStoryEntries` and `findMentions` are the pure parts, and the ones tested.
 */
import { useMemo, useSyncExternalStore } from 'react'
import { getDocKind } from './docKind'
import { listPresetEntries } from './storyStructure'
import { allFolderPresets, onFolderPresetsChange } from './folderPresets'
import { allDocumentFields, fieldsProject, onDocumentFieldsChange, type DocumentFieldMap } from './documentFields'
import { onTreeRemembered, recallTree } from './projectPrefetch'
import type { InkId } from './palette'
import { isNameHere } from './nameContext'

export interface StoryEntry {
  /** What opens: the canvas, when a canvas and a document share the name. */
  path: string
  name: string
  aliases: string[]
  presetKey: string
  presetName: string
  /** What one entry of its folder is called: Character, Setting, a writer's own. */
  kind: string
  ink: InkId
  isCharacter: boolean
  /** Tagged even where its name reads as an ordinary word (nameContext.ts). */
  alwaysTag: boolean
}

type PresetLike = Parameters<typeof listPresetEntries>[1] extends (infer P)[] | undefined ? P & { ink?: string | null } : never

/** The book's chapters are what the tags appear in, not what they point at. */
const UNTAGGED_PRESETS = new Set(['novel'])

/** Built-in folder types have no ink of their own; these tell them apart in the text. */
const BUILT_IN_INKS: Record<string, InkId> = { characters: 'violet', settings: 'teal', outline: 'slate' }

/** Shorter than this, a name matches inside ordinary prose ("I", "A"). */
const MIN_NAME_LENGTH = 2

const parentOf = (path: string) => path.split('/').slice(0, -1).join('/')

interface TreeNode { type: string; path: string; children?: TreeNode[] }

export function buildStoryEntries(tree: TreeNode | null, presets: PresetLike[], fields: DocumentFieldMap): StoryEntry[] {
  if (!tree) return []
  const listed = listPresetEntries(tree, presets) as { path: string; name: string; preset: PresetLike }[]
  const byKey = new Map<string, StoryEntry>()
  for (const { path, name, preset } of listed) {
    if (UNTAGGED_PRESETS.has(preset.key)) continue
    const key = `${parentOf(path)}\n${name}`
    const existing = byKey.get(key)
    // A character kept as a document and a canvas of the same name is one character,
    // and its canvas is where ⌘-click goes.
    if (existing && getDocKind(existing.path) === 'canvas') continue
    const aliases = [...(existing?.aliases || []), ...(fields[path]?.aliases || [])]
    const alwaysTag = Boolean(existing?.alwaysTag || fields[path]?.alwaysTag)
    byKey.set(key, {
      path,
      name,
      aliases: [...new Set(aliases)],
      presetKey: preset.key,
      presetName: preset.name,
      kind: preset.entryLabel || 'Entry',
      ink: (preset.ink as InkId) || BUILT_IN_INKS[preset.key] || 'blue',
      isCharacter: preset.key === 'characters',
      alwaysTag,
    })
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path))
}

/* ---------------- matching ---------------- */

export interface NameIndex {
  pattern: RegExp | null
  /** Each name and alias, to the entry it names (the first, when two share one). */
  byName: Map<string, StoryEntry>
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function buildNameIndex(entries: StoryEntry[]): NameIndex {
  const byName = new Map<string, StoryEntry>()
  for (const entry of entries) {
    for (const name of [entry.name, ...entry.aliases]) {
      const term = name.trim()
      if (term.length >= MIN_NAME_LENGTH && !byName.has(term)) byName.set(term, entry)
    }
  }
  if (!byName.size) return { pattern: null, byName }
  // Longest first, so "Kira Vale" wins over "Kira". Whole words only, by letters and
  // digits in any script, so "Kira's" is tagged and "Kirakos" is not.
  const alternatives = [...byName.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp)
  return { pattern: new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alternatives.join('|')})(?![\\p{L}\\p{N}_])`, 'gu'), byName }
}

export interface Mention {
  /** UTF-16 offsets into the text searched. */
  from: number
  to: number
  entry: StoryEntry
}

/** Every mention of an entry in `text`, leaving out `exceptPath` (a document's own name). */
export function findMentions(text: string, index: NameIndex, exceptPath: string | null = null): Mention[] {
  if (!index.pattern || !text) return []
  const mentions: Mention[] = []
  index.pattern.lastIndex = 0
  for (const match of text.matchAll(index.pattern)) {
    const entry = index.byName.get(match[0])
    if (!entry || entry.path === exceptPath) continue
    mentions.push({ from: match.index, to: match.index + match[0].length, entry })
  }
  return mentions
}

/**
 * The mentions to tag: `findMentions`, less a name that reads as an ordinary word where
 * it stands ("Will you come?"), unless its entry is always tagged. `pending` is set when
 * one could not be judged yet because the tagger is still loading.
 */
export function tagMentions(text: string, index: NameIndex, exceptPath: string | null = null): { mentions: Mention[]; pending: boolean } {
  let pending = false
  const mentions = findMentions(text, index, exceptPath).filter((mention) => {
    if (mention.entry.alwaysTag) return true
    const verdict = isNameHere(text, mention.from, text.slice(mention.from, mention.to))
    if (verdict === null) pending = true
    return verdict === true
  })
  return { mentions, pending }
}

/* ---------------- the open project's ---------------- */

let tree: TreeNode | null = null
let treeProject: string | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((listener) => listener())

onTreeRemembered((projectName: string, next: TreeNode) => {
  tree = next
  treeProject = projectName
  notify()
})
// The fields change with the open project too (they are read as it opens).
onDocumentFieldsChange(notify)
onFolderPresetsChange(notify)

/** Hear every change to the open project's entries. */
export const onStoryEntriesChange = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

const getTree = (): TreeNode | null => {
  const project = fieldsProject()
  if (!project) return null
  if (treeProject !== project) {
    tree = recallTree(project)
    treeProject = project
  }
  return tree
}

// Rebuilt only when one of its three sources is a different object.
let built: { tree: TreeNode | null; presets: unknown; fields: unknown; entries: StoryEntry[]; index: NameIndex | null } | null = null

const current = () => {
  const sources = { tree: getTree(), presets: allFolderPresets(), fields: allDocumentFields() }
  if (!built || built.tree !== sources.tree || built.presets !== sources.presets || built.fields !== sources.fields) {
    built = { ...sources, entries: buildStoryEntries(sources.tree, sources.presets as PresetLike[], sources.fields), index: null }
  }
  return built
}

/** The open project's story entries, now. */
export const getStoryEntries = (): StoryEntry[] => current().entries

/** The names to look for in the open project, now. */
export function getNameIndex(): NameIndex {
  const state = current()
  if (!state.index) state.index = buildNameIndex(state.entries)
  return state.index
}

/** The open project's story entries, re-rendering when the tree, types or aliases change. */
export function useStoryEntries(): StoryEntry[] {
  return useSyncExternalStore(onStoryEntriesChange, getStoryEntries, getStoryEntries)
}

/** The characters alone, for the point-of-view and note pickers. */
export function useCharacterEntries(): StoryEntry[] {
  const entries = useStoryEntries()
  return useMemo(() => entries.filter((entry) => entry.isCharacter), [entries])
}

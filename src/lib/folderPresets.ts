/**
 * folderPresets.ts — the writer's own folder types, beside the built-in story folders.
 *
 * A folder type is a name, an icon and an ink (and what one document in it is called,
 * for "New plant"). A folder with that name anywhere in the project wears its icon,
 * and so do the documents in it, in its ink; its entries are listed with the built-in
 * ones' (`listPresetEntries`). Matching and the preset's shape are storyStructure.js's.
 *
 * Saved with the project, in `<projectRoot>/.story/folder-presets.json`, so the types
 * travel with it. The page holds the open project's in memory (`useFolderPresets`),
 * read when the project opens.
 */
import { useSyncExternalStore } from 'react'
import { exists, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { getProjectRoot, joinPath } from './projectPaths'
import { isInkId } from './palette'
import { STORY_FOLDER_PRESETS, CUSTOM_PRESET_ICONS, customPreset } from './storyStructure'

/** What is saved for one folder type. */
export interface SavedFolderPreset {
  id: string
  name: string
  entryLabel?: string
  icon?: string
  ink?: string | null
}

type Preset = ReturnType<typeof customPreset> | (typeof STORY_FOLDER_PRESETS)[number]

interface PresetState {
  project: string | null
  saved: SavedFolderPreset[]
  /** The built-ins, then the writer's. */
  all: Preset[]
}

const builtIn = (): PresetState => ({ project: null, saved: [], all: [...STORY_FOLDER_PRESETS] })

let state: PresetState = builtIn()
const listeners = new Set<() => void>()

const publish = (project: string | null, saved: SavedFolderPreset[]) => {
  state = { project, saved, all: [...STORY_FOLDER_PRESETS, ...saved.map((preset) => customPreset({ entryLabel: undefined, icon: undefined, ink: null, ...preset }))] }
  listeners.forEach((listener) => listener())
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
const getState = () => state

/** Every preset for the open project, re-rendering when they change. */
export function useFolderPresets(): Preset[] {
  return useSyncExternalStore(subscribe, getState, getState).all
}

/** The writer's own folder types, as saved, re-rendering when they change. */
export function useSavedFolderPresets(): SavedFolderPreset[] {
  return useSyncExternalStore(subscribe, getState, getState).saved
}

/** Every preset for the open project, now. */
export const allFolderPresets = (): Preset[] => state.all

/* ---------------- on disk ---------------- */

const presetsPath = async (projectName: string) => joinPath(await getProjectRoot(projectName), '.story', 'folder-presets.json')

const clean = (raw: unknown): SavedFolderPreset | null => {
  if (!raw || typeof raw !== 'object') return null
  const { id, name, entryLabel, icon, ink } = raw as Record<string, unknown>
  if (typeof id !== 'string' || !id || typeof name !== 'string' || !name.trim()) return null
  return {
    id,
    name: name.trim(),
    entryLabel: typeof entryLabel === 'string' && entryLabel.trim() ? entryLabel.trim() : undefined,
    icon: typeof icon === 'string' && CUSTOM_PRESET_ICONS.includes(icon) ? icon : 'folder',
    ink: isInkId(ink) ? ink : null,
  }
}

let latestRead = 0

/** Read a project's folder types from disk. */
export async function refreshFolderPresets(projectName: string | null | undefined): Promise<void> {
  const read = ++latestRead
  if (!projectName) {
    publish(null, [])
    return
  }
  let saved: SavedFolderPreset[] = []
  try {
    const path = await presetsPath(projectName)
    if (await exists(path)) {
      const parsed = JSON.parse((await readTextFile(path)) || '{}')
      saved = (Array.isArray(parsed?.presets) ? parsed.presets : []).map(clean).filter(Boolean) as SavedFolderPreset[]
    }
  } catch (error) {
    console.warn('[folderPresets] could not read the folder types:', error)
  }
  if (read === latestRead) publish(projectName, saved)
}

async function save(projectName: string, saved: SavedFolderPreset[]): Promise<boolean> {
  try {
    const root = await getProjectRoot(projectName)
    await mkdir(joinPath(root, '.story'), { recursive: true })
    await writeTextFile(await presetsPath(projectName), JSON.stringify({ presets: saved }, null, 2))
    if (state.project === projectName) publish(projectName, saved)
    return true
  } catch (error) {
    console.error('[folderPresets] could not save the folder types:', error)
    return false
  }
}

/* ---------------- changing ---------------- */

/**
 * Why `name` cannot name a folder type, or '' when it can: it is empty, or another
 * type (a built-in's name or alias included) already answers to it.
 */
export function presetNameProblem(name: string, exceptId: string | null = null): string {
  const wanted = name.trim()
  if (!wanted) return 'Give the folder type a name.'
  if (wanted.includes('/')) return 'A folder name can’t contain “/”.'
  const taken = state.all.some((preset) => (
    preset.key !== (exceptId ? `custom:${exceptId}` : null)
    && [preset.name, ...(preset.aliases || [])].some((other) => other.toLowerCase() === wanted.toLowerCase())
  ))
  return taken ? `There is already a “${wanted}” folder type.` : ''
}

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

/** Add a folder type to the open project. Resolves to its preset key, or null. */
export async function addFolderPreset(fields: Omit<SavedFolderPreset, 'id'>): Promise<string | null> {
  if (!state.project || presetNameProblem(fields.name)) return null
  const preset = clean({ ...fields, id: newId() })
  if (!preset) return null
  return (await save(state.project, [...state.saved, preset])) ? `custom:${preset.id}` : null
}

/** Change one of the open project's folder types. */
export async function updateFolderPreset(id: string, fields: Omit<SavedFolderPreset, 'id'>): Promise<boolean> {
  if (!state.project || presetNameProblem(fields.name, id)) return false
  const preset = clean({ ...fields, id })
  if (!preset) return false
  return save(state.project, state.saved.map((saved) => (saved.id === id ? preset : saved)))
}

/** Remove a folder type. Its folders stay; they just become plain folders. */
export async function removeFolderPreset(id: string): Promise<boolean> {
  if (!state.project) return false
  return save(state.project, state.saved.filter((saved) => saved.id !== id))
}

/** Fired with `detail: { editId? }` to open the folder types sheet. */
export const FOLDER_PRESETS_EVENT = 'inkblot:folder-presets'
export const openFolderPresets = (editId: string | null = null) => {
  window.dispatchEvent(new CustomEvent(FOLDER_PRESETS_EVENT, { detail: { editId } }))
}

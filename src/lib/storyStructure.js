/**
 * storyStructure.js — the story folder presets. Presets give matching folders and the
 * files inside them themed icons in the file tree, matched by folder name (or alias)
 * anywhere in an entry's path.
 *
 * Four are built in (Characters, Settings, Outline, Novel). A writer adds their own
 * (folderPresets.ts: a name, an icon and an ink), so every lookup here takes the list
 * to match against; left out, it is the built-ins alone, which is what the Rust twin
 * (`story_structure.rs`) mirrors.
 *
 * Mirrors: `src-tauri/crates/inkblot-core/src/story_structure.rs`; `npm run parity` asserts they agree.
 */
import { getDocDisplayName } from './docKind'

export const STORY_FOLDER_PRESETS = [
  {
    key: 'characters',
    name: 'Characters',
    menuLabel: 'Character folder',
    // What one document inside the folder is, for the file tree's contextual
    // "New …" button.
    entryLabel: 'Character',
    folderIcon: 'users',
    fileIcon: 'characters',
    aliases: [],
  },
  {
    key: 'settings',
    name: 'Settings',
    menuLabel: 'Setting folder',
    entryLabel: 'Setting',
    folderIcon: 'map-world',
    fileIcon: 'map-pin',
    aliases: ['Locations', 'Places'],
  },
  {
    key: 'outline',
    name: 'Outline',
    menuLabel: 'Outline folder',
    entryLabel: 'Outline entry',
    folderIcon: 'list',
    fileIcon: 'list-bullets',
    aliases: [],
  },
  {
    key: 'novel',
    name: 'Novel',
    menuLabel: 'Novel folder',
    entryLabel: 'Chapter',
    folderIcon: 'book',
    fileIcon: 'notebook',
    aliases: ['Book'],
  },
]

/** Every name a preset answers to: its own, then its aliases. */
const namesOf = (preset) => [preset.name, ...(preset.aliases || [])]

export const getStoryFolderPresetByKey = (key, presets = STORY_FOLDER_PRESETS) =>
  presets.find(preset => preset.key === key) || null

export const getStoryFolderPresetByName = (name, presets = STORY_FOLDER_PRESETS) =>
  presets.find(preset => namesOf(preset).includes(name)) || null

/** Preset for a tree entry: folders match by their own name, files by the nearest preset ancestor folder. */
export const getStoryFolderPresetForEntry = (entryPath = '', entryType = 'file', presets = STORY_FOLDER_PRESETS) => {
  const segments = entryPath.split('/').filter(Boolean)
  if (!segments.length) return null

  if (entryType === 'folder') {
    return getStoryFolderPresetByName(segments[segments.length - 1], presets)
  }

  const matchingFolder = [...segments.slice(0, -1)]
    .reverse()
    .find(segment => getStoryFolderPresetByName(segment, presets))

  return matchingFolder ? getStoryFolderPresetByName(matchingFolder, presets) : null
}

/**
 * The nearest preset folder a file lives in, with the path to create siblings
 * in. Returns null for files outside any preset folder.
 */
export const getStoryFolderAncestor = (entryPath = '', presets = STORY_FOLDER_PRESETS) => {
  const segments = entryPath.split('/').filter(Boolean)

  for (let i = segments.length - 2; i >= 0; i -= 1) {
    const preset = getStoryFolderPresetByName(segments[i], presets)
    if (preset) {
      return { preset, path: segments.slice(0, i + 1).join('/') }
    }
  }

  return null
}

/**
 * A doc filed under a Settings folder (or one called Locations or Places) — what a
 * map pin links to by default.
 */
export const isLocationDoc = (docPath = '') =>
  getStoryFolderPresetForEntry(docPath, 'file')?.key === 'settings'

/** A doc filed under a Characters folder — what travels a map's routes. */
export const isCharacterDoc = (docPath = '') =>
  getStoryFolderPresetForEntry(docPath, 'file')?.key === 'characters'

/* ---------------- the writer's own presets ---------------- */

/** The icons a writer's own folder type can wear (src/ui/icons.js). */
export const CUSTOM_PRESET_ICONS = [
  'folder', 'users', 'map-world', 'book', 'list', 'flora', 'fauna', 'magic', 'government', 'religion',
  'royalty', 'conflict', 'faction', 'lore', 'treasure', 'terrain', 'trade', 'sparkle',
]

/** Examples to start a folder type from. They are suggestions, not built-ins. */
export const PRESET_SUGGESTIONS = [
  { name: 'Flora', entryLabel: 'Plant', icon: 'flora', ink: 'green' },
  { name: 'Fauna', entryLabel: 'Creature', icon: 'fauna', ink: 'rust' },
  { name: 'Magic', entryLabel: 'Spell', icon: 'magic', ink: 'violet' },
  { name: 'Government', entryLabel: 'Office', icon: 'government', ink: 'slate' },
  { name: 'Religion', entryLabel: 'Faith', icon: 'religion', ink: 'amber' },
]

/**
 * A preset from what a writer saved (`{ id, name, entryLabel?, icon?, ink? }`), in the
 * built-ins' shape. A folder and the documents in it both wear its icon, in its ink.
 */
export const customPreset = ({ id, name, entryLabel, icon, ink }) => ({
  key: `custom:${id}`,
  name,
  menuLabel: `${name} folder`,
  entryLabel: entryLabel || 'Entry',
  folderIcon: CUSTOM_PRESET_ICONS.includes(icon) ? icon : 'folder',
  fileIcon: CUSTOM_PRESET_ICONS.includes(icon) ? icon : 'folder',
  ink: ink || null,
  aliases: [],
  custom: true,
})

/**
 * Every document filed under a preset folder, with the preset it belongs to: the
 * entries a story is made of (characters, places, a writer's own lists). Name
 * identification (#1) finds these names in the text.
 */
export const listPresetEntries = (tree, presets = STORY_FOLDER_PRESETS) => {
  const entries = []
  const visit = (node) => {
    if (!node) return
    if (node.type === 'folder') {
      for (const child of node.children || []) visit(child)
      return
    }
    const preset = getStoryFolderPresetForEntry(node.path, 'file', presets)
    if (preset) entries.push({ path: node.path, name: getDocDisplayName(node.path), preset })
  }
  visit(tree)
  return entries
}

/**
 * storyStructure.js — the built-in story folder presets (Characters,
 * Settings, Outline, Novel). Presets give matching folders and the files
 * inside them themed icons in the file tree, matched by folder name
 * (or alias) anywhere in an entry's path.
 */
export const STORY_FOLDER_PRESETS = [
  {
    key: 'characters',
    name: 'Characters',
    menuLabel: 'Character Folder',
    // What one document inside the folder is, for the file tree's contextual
    // "New …" button.
    entryLabel: 'Character',
    folderIcon: 'folder.characters',
    fileIcon: 'doc.characters',
    aliases: [],
  },
  {
    key: 'settings',
    name: 'Settings',
    menuLabel: 'Setting Folder',
    entryLabel: 'Setting',
    folderIcon: 'folder.settings',
    fileIcon: 'doc.settings',
    aliases: ['Locations', 'Places'],
  },
  {
    key: 'outline',
    name: 'Outline',
    menuLabel: 'Outline Folder',
    entryLabel: 'Outline Entry',
    folderIcon: 'folder.outline',
    fileIcon: 'doc.outline',
    aliases: [],
  },
  {
    key: 'novel',
    name: 'Novel',
    menuLabel: 'Novel Folder',
    entryLabel: 'Chapter',
    folderIcon: 'folder.novel',
    fileIcon: 'doc.novel',
    aliases: ['Book'],
  },
]

const STORY_FOLDER_PRESET_BY_KEY = Object.fromEntries(
  STORY_FOLDER_PRESETS.map(preset => [preset.key, preset])
)

const STORY_FOLDER_PRESET_BY_NAME = Object.fromEntries(
  STORY_FOLDER_PRESETS.flatMap(preset => [
    [preset.name, preset],
    ...(preset.aliases || []).map(alias => [alias, preset]),
  ])
)

export const getStoryFolderPresetByKey = (key) => STORY_FOLDER_PRESET_BY_KEY[key] || null

export const getStoryFolderPresetByName = (name) => STORY_FOLDER_PRESET_BY_NAME[name] || null

/** Preset for a tree entry: folders match by their own name, files by the nearest preset ancestor folder. */
export const getStoryFolderPresetForEntry = (entryPath = '', entryType = 'file') => {
  const segments = entryPath.split('/').filter(Boolean)
  if (!segments.length) return null

  if (entryType === 'folder') {
    return getStoryFolderPresetByName(segments[segments.length - 1])
  }

  const matchingFolder = [...segments.slice(0, -1)]
    .reverse()
    .find(segment => getStoryFolderPresetByName(segment))

  return matchingFolder ? getStoryFolderPresetByName(matchingFolder) : null
}

/**
 * The nearest preset folder a file lives in, with the path to create siblings
 * in. Returns null for files outside any preset folder.
 */
export const getStoryFolderAncestor = (entryPath = '') => {
  const segments = entryPath.split('/').filter(Boolean)

  for (let i = segments.length - 2; i >= 0; i -= 1) {
    const preset = getStoryFolderPresetByName(segments[i])
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

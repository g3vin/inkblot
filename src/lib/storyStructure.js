export const STORY_FOLDER_PRESETS = [
  {
    key: 'characters',
    name: 'Characters',
    menuLabel: 'Character Folder',
    folderIcon: 'folder.characters',
    fileIcon: 'doc.characters',
    aliases: [],
  },
  {
    key: 'settings',
    name: 'Settings',
    menuLabel: 'Setting Folder',
    folderIcon: 'folder.settings',
    fileIcon: 'doc.settings',
    aliases: [],
  },
  {
    key: 'outline',
    name: 'Outline',
    menuLabel: 'Outline Folder',
    folderIcon: 'folder.outline',
    fileIcon: 'doc.outline',
    aliases: [],
  },
  {
    key: 'novel',
    name: 'Novel',
    menuLabel: 'Novel Folder',
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

/**
 * storyStructure.js against `inkblot_core::story_structure`.
 *
 * The matching rules are the point: a folder matches on its own name, a file on the
 * nearest preset ancestor, aliases count ("Book" is a Novel folder), and the match is
 * case-sensitive.
 */
import {
  STORY_FOLDER_PRESETS,
  getStoryFolderPresetByKey,
  getStoryFolderPresetByName,
  getStoryFolderPresetForEntry,
  getStoryFolderAncestor,
  isLocationDoc,
  isCharacterDoc,
} from '../../../src/lib/storyStructure.js'

const KEYS = ['characters', 'settings', 'outline', 'novel', 'Characters', 'book', '', 'missing']
const NAMES = ['Characters', 'Settings', 'Locations', 'Places', 'locations', 'Outline', 'Novel', 'Book', 'book', 'novel', '', 'Chapters']

const PATHS = [
  '',
  '/',
  'Characters',
  'Characters/Ada',
  'Characters/Minor/Ada',
  'Novel/Chapter One',
  'Book/Chapter One',
  'Book/Characters/Ada',
  'Characters/Book/Ada',
  'Drafts/Novel/Act I/Chapter One',
  'Drafts/Ada',
  'Novel//Chapter One',
  '/Novel/Chapter One',
  'Novel/',
  'novel/chapter',
  'Settings/The Fens.canvas',
  'Outline/Beats/Midpoint',
  'Locations/Rivertown',
  'World/Places/Harbour/Old Quay',
  'Characters/Locations/Ada',
  'Locations/Characters/Ada',
]

export default {
  name: 'storyStructure',
  *cases() {
    yield { fn: 'storyFolderPresets', args: [], expected: STORY_FOLDER_PRESETS }

    for (const key of KEYS) {
      yield { fn: 'getStoryFolderPresetByKey', args: [key], expected: getStoryFolderPresetByKey(key) }
    }
    for (const name of NAMES) {
      yield { fn: 'getStoryFolderPresetByName', args: [name], expected: getStoryFolderPresetByName(name) }
    }
    for (const path of PATHS) {
      yield { fn: 'getStoryFolderAncestor', args: [path], expected: getStoryFolderAncestor(path) }
      yield { fn: 'isLocationDoc', args: [path], expected: isLocationDoc(path) }
      yield { fn: 'isCharacterDoc', args: [path], expected: isCharacterDoc(path) }
      for (const type of ['file', 'folder']) {
        yield {
          fn: 'getStoryFolderPresetForEntry',
          args: [path, type],
          expected: getStoryFolderPresetForEntry(path, type),
        }
      }
    }
  },
}

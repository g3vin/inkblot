/**
 * Folder types (storyStructure.js, folderPresets.ts, FolderPresetsSheet.jsx).
 *
 *   - the built-in story folders match as they always have when no list is given
 *     (that is what the Rust twin mirrors);
 *   - a writer's own type matches its folders and their documents, in its icon and ink,
 *     and its entries are listed with the built-ins' for name identification;
 *   - types are saved with the project, refused a name already taken, changed and
 *     removed;
 *   - the sheet adds one from a suggestion.
 */
import { JSDOM } from 'jsdom'
import { installGlobals } from './install-globals.mjs'
import { files } from './stub-fs.mjs'
import { ok } from './assert.mjs'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true })
installGlobals(dom.window, ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node',
  'requestAnimationFrame', 'cancelAnimationFrame', 'CustomEvent', 'Event', 'KeyboardEvent', 'MouseEvent', 'getComputedStyle'])
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const S = '../../src'
const story = await import(`${S}/lib/storyStructure.js`)
const presets = await import(`${S}/lib/folderPresets.ts`)
const { deriveFileNodeState } = await import(`${S}/lib/fileTreeNodeState.js`)
const FS = await import(`${S}/lib/FileSystem.js`)

/* ---------------- matching ---------------- */

ok('built-ins match without a list', story.getStoryFolderPresetForEntry('Book/Chapter One')?.key === 'novel')
ok('and a custom name does not', story.getStoryFolderPresetForEntry('Flora/Rose') === null)

const flora = story.customPreset({ id: 'f1', name: 'Flora', entryLabel: 'Plant', icon: 'flora', ink: 'green' })
const all = [...story.STORY_FOLDER_PRESETS, flora]
ok('a custom type matches its folder', story.getStoryFolderPresetForEntry('World/Flora', 'folder', all)?.key === 'custom:f1')
ok('and the documents in it', story.getStoryFolderPresetForEntry('World/Flora/Rose', 'file', all)?.name === 'Flora')
ok('and offers a sibling by its entry name', story.getStoryFolderAncestor('Flora/Rose', all)?.preset.entryLabel === 'Plant')
ok('an icon it does not know falls back to a folder', story.customPreset({ id: 'x', name: 'X', icon: 'rocket' }).folderIcon === 'folder')

const tree = { type: 'folder', path: '', children: [
  { type: 'folder', path: 'Characters', name: 'Characters', children: [{ type: 'file', path: 'Characters/Ada', name: 'Ada' }] },
  { type: 'folder', path: 'Flora', name: 'Flora', children: [{ type: 'file', path: 'Flora/Rose.canvas', name: 'Rose.canvas' }] },
  { type: 'file', path: 'Chapter', name: 'Chapter' },
] }
const entries = story.listPresetEntries(tree, all)
ok('the entries are every document in a preset folder', entries.map((entry) => `${entry.preset.name}:${entry.name}`).join() === 'Characters:Ada,Flora:Rose')

const folderState = deriveFileNodeState({ type: 'folder', path: 'Flora', name: 'Flora' }, { presets: all })
ok('the tree draws the type’s icon, in its ink', folderState.iconName === 'flora' && folderState.iconInk === 'green')
ok('a built-in folder has no ink', deriveFileNodeState({ type: 'folder', path: 'Characters', name: 'Characters' }, { presets: all }).iconInk === null)

/* ---------------- saved with the project ---------------- */

const P = 'Presets'
await FS.saveDocument(P, 'Chapter', { content: [], notes: [] })
await presets.refreshFolderPresets(P)
ok('a project starts with the built-ins only', presets.allFolderPresets().length === story.STORY_FOLDER_PRESETS.length)

ok('a built-in’s name is taken', Boolean(presets.presetNameProblem('Characters')))
ok('so is a built-in’s alias, whatever its case', Boolean(presets.presetNameProblem('locations')))
ok('an empty name is not a name', Boolean(presets.presetNameProblem('  ')))
ok('a free name is fine', presets.presetNameProblem('Flora') === '')

const key = await presets.addFolderPreset({ name: 'Flora', entryLabel: 'Plant', icon: 'flora', ink: 'green' })
ok('adding one resolves to its key', typeof key === 'string' && key.startsWith('custom:'))
const onDisk = JSON.parse(files.get(`/appdata/${P}/.story/folder-presets.json`))
ok('it is saved with the project', onDisk.presets[0].name === 'Flora' && onDisk.presets[0].ink === 'green')
ok('and is a preset now', presets.allFolderPresets().some((preset) => preset.key === key))
ok('a second of the same name is refused', (await presets.addFolderPreset({ name: 'flora' })) === null)

const id = key.slice('custom:'.length)
ok('it can be changed', await presets.updateFolderPreset(id, { name: 'Plants', icon: 'flora', ink: 'teal' }))
ok('keeping its own name is not a clash', presets.presetNameProblem('Plants', id) === '')

await presets.refreshFolderPresets(null)
await presets.refreshFolderPresets(P)
ok('reopened, the project has its type', presets.allFolderPresets().some((preset) => preset.name === 'Plants' && preset.ink === 'teal'))
await presets.removeFolderPreset(id)
ok('removing takes it out', !presets.allFolderPresets().some((preset) => preset.custom))

/* ---------------- the sheet ---------------- */

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: FolderPresetsSheet } = await import(`${S}/components/FolderPresetsSheet.jsx`)

const host = document.getElementById('root')
const root = createRoot(host)
await act(async () => root.render(React.createElement(FolderPresetsSheet, { projectName: P })))
ok('closed until asked for', !document.querySelector('.folder-preset-list'))
await act(async () => { presets.openFolderPresets() })
ok('lists the built-ins', document.querySelector('.folder-preset-list')?.textContent.includes('Characters'))

const buttonNamed = (text) => [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === text)
await act(async () => { buttonNamed('New folder type').click() })
ok('suggestions are offered', ['Flora', 'Fauna', 'Magic', 'Government', 'Religion'].every((name) => buttonNamed(name)))
await act(async () => { buttonNamed('Fauna').click() })
ok('a suggestion fills the form', document.querySelector('#folder-preset-name').value === 'Fauna' && document.querySelector('#folder-preset-entry').value === 'Creature')
await act(async () => { buttonNamed('Add folder type').click() })
await act(async () => {})
ok('adding it saves it', presets.allFolderPresets().some((preset) => preset.name === 'Fauna' && preset.folderIcon === 'fauna'))
ok('and lists it', document.querySelector('.folder-preset-list')?.textContent.includes('Fauna'))
await act(async () => { buttonNamed('New folder type').click() })
ok('a suggestion already taken is not offered again', !buttonNamed('Fauna'))
await act(async () => root.unmount())

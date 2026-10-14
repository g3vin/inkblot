/**
 * What the toolbars and the inspector hold (lib/chromeLayout.ts): the item ids that
 * saved layouts are made of, the default sets, and every migration a saved layout
 * goes through as it is read — ported from InspectorLayout.swift and its tests.
 */
import { ok } from './assert.mjs'

const L = await import('../../src/lib/chromeLayout.ts')

/* ---------------- the ids are storage keys ---------------- */

// The ids saved layouts are made of, less the retired
// inspector toggle, plus the two speech items. Never change or remove one.
const EXPECTED_IDS = [
  'inkblot.format.font', 'inkblot.format.font-size', 'inkblot.format.text-style', 'inkblot.format.text-color',
  'inkblot.format.highlight', 'inkblot.format.alignment', 'inkblot.format.paragraph-style',
  'inkblot.format.bulleted-list', 'inkblot.format.numbered-list', 'inkblot.insert.table',
  'inkblot.insert.conversation', 'inkblot.insert.note', 'inkblot.edit.undo-redo', 'inkblot.edit.paste-and-match-style',
  'inkblot.view.focus-mode', 'inkblot.view.word-count',
  'inkblot.canvas.lock', 'inkblot.canvas.add-card', 'inkblot.canvas.add-image', 'inkblot.canvas.record-memo',
  'inkblot.canvas.color', 'inkblot.canvas.group', 'inkblot.canvas.undo-redo', 'inkblot.canvas.alignment-guides',
  'inkblot.canvas.snap-to-grid', 'inkblot.canvas.zoom', 'inkblot.canvas.delete',
  'inkblot.map.drawing-tools', 'inkblot.map.measure-tools', 'inkblot.map.undo-redo', 'inkblot.map.zoom',
  'inkblot.map.delete',
  'inkblot.history.snapshot', 'inkblot.panel.clipboard', 'inkblot.panel.workbench', 'inkblot.panel.notes',
  'inkblot.panel.history', 'inkblot.panel.references', 'inkblot.panel.stats', 'inkblot.timer',
  'inkblot.tabs.new-tab', 'inkblot.tabs.split',
  'inkblot.view.editor-mode', 'inkblot.view.page-view', 'inkblot.typeset.view', 'inkblot.typeset.edition', 'inkblot.typeset.spread',
  'inkblot.typeset.proof', 'inkblot.typeset.grid', 'inkblot.typeset.tighten', 'inkblot.typeset.loosen',
  'inkblot.typeset.keep-together', 'inkblot.typeset.text-style', 'inkblot.typeset.insert', 'inkblot.typeset.zoom',
  'inkblot.typeset.print', 'inkblot.typeset.export',
  'inkblot.speech.dictation', 'inkblot.speech.read-aloud',
]
const ids = L.TOOLBAR_ITEMS.map((item) => item.id)
ok('the item ids are the ones layouts were saved under', JSON.stringify(ids) === JSON.stringify(EXPECTED_IDS))
ok('no two items share an id', new Set(ids).size === ids.length)
ok('every id is namespaced', ids.every((id) => id.startsWith('inkblot.')))
ok('every item has a label and an icon', L.TOOLBAR_ITEMS.every((item) => item.label && item.icon && item.contexts.length))
ok('the toolbars save apart', new Set(L.TOOLBAR_CONTEXTS.map(L.toolbarLayoutKey)).size === 4)

for (const context of L.TOOLBAR_CONTEXTS) {
  const offered = new Set(L.toolbarItemsFor(context).map((item) => item.id))
  ok(`the ${context} default set is made of its own items`, L.DEFAULT_TOOLBARS[context].every((id) => L.isSpacer(id) || id === L.MORE || offered.has(id)))
  ok(`the ${context} palette offers the shared items`, offered.has('inkblot.timer') && offered.has('inkblot.panel.notes'))
}
ok('delete is palette-only on a canvas', !L.DEFAULT_TOOLBARS.canvas.includes('inkblot.canvas.delete'))

/* ---------------- toolbar layouts as they are read ---------------- */

const doc = (raw) => L.normalizeToolbar('document', raw)
const defaults = L.defaultToolbarLayout('document').items.join()
ok('nothing saved is the default set', doc(null).items.join() === defaults)
ok('corrupt JSON is the default set', doc('{nope').items.join() === defaults)
ok('an empty list is the default set', doc('{"items":[]}').items.join() === defaults)
ok('only spacers is the default set', doc(JSON.stringify({ items: ['space', 'flexible-space'] })).items.join() === defaults)

let read = doc(JSON.stringify({ items: ['inkblot.format.font', 'inkblot.window.inspector-toggle', 'inkblot.canvas.lock', 'nonsense', 'inkblot.format.font'], known: ids }))
ok('unknown, retired, other-context and repeated ids are dropped', read.items.join() === 'inkblot.format.font')

read = doc(JSON.stringify({ items: ['space', 'inkblot.format.font', 'space', 'space', 'inkblot.format.highlight', 'flexible-space'], known: ids }))
ok('spacers are tidied: none leading, trailing or doubled', read.items.join() === 'inkblot.format.font,space,inkblot.format.highlight')

ok('a bare list reads as a layout', doc(JSON.stringify(['inkblot.format.font'])).items.join() === 'inkblot.format.font')

// Saved before the speech items existed: they are default items it never knew, so they arrive after
// the item before them in the default set that the layout has.
read = doc(JSON.stringify({ items: ['inkblot.format.font', 'inkblot.insert.conversation', 'inkblot.format.highlight'], known: ids.filter((id) => !id.startsWith('inkblot.speech.')) }))
ok('a default item added since is put after the one it follows',
  read.items.join() === 'inkblot.format.font,inkblot.insert.conversation,inkblot.speech.dictation,inkblot.speech.read-aloud,inkblot.format.highlight')

read = doc(JSON.stringify({ items: ['inkblot.format.font'], known: ids.filter((id) => id !== 'inkblot.timer') }))
ok('a palette-only item added since is never put in', !read.items.includes('inkblot.timer'))

read = doc(JSON.stringify({ items: ['inkblot.format.font'], known: ids }))
ok('a default item the user took out stays out', read.items.join() === 'inkblot.format.font')

/* ---------------- the More marker ---------------- */

ok('no default set hides items behind More', L.TOOLBAR_CONTEXTS.every((context) => !L.DEFAULT_TOOLBARS[context].includes(L.MORE)))
const surface = L.DEFAULT_TOOLBARS.document.filter((id) => !L.isSpacer(id)).slice(0, 7)
ok('the document toolbar leads with the essentials',
  surface.join() === 'inkblot.view.page-view,inkblot.format.text-style,inkblot.format.paragraph-style,inkblot.format.bulleted-list,inkblot.format.numbered-list,inkblot.insert.note,inkblot.edit.undo-redo')
read = doc(JSON.stringify({ items: ['inkblot.format.font', 'more', 'inkblot.format.highlight', 'more'], known: ids }))
ok('More is kept, once', read.items.join() === 'inkblot.format.font,more,inkblot.format.highlight')
read = doc(JSON.stringify({ items: ['inkblot.format.font', 'more'], known: ids }))
ok('a More with nothing after it is dropped', read.items.join() === 'inkblot.format.font')
ok('More alone is the default set', doc(JSON.stringify({ items: ['more'] })).items.join() === defaults)
read = doc(JSON.stringify({ items: ['inkblot.format.font', 'inkblot.insert.conversation'], known: ids.filter((id) => id !== 'inkblot.insert.note') }))
ok('Add Note reaches a layout saved before it existed', read.items.includes('inkblot.insert.note'))

ok('a display mode reads back', L.normalizeDisplayMode('label') === 'label')
ok('an unknown display mode is icon only', L.normalizeDisplayMode('huge') === 'icon' && L.normalizeDisplayMode(null) === 'icon')

/* ---------------- adding ---------------- */

ok('adding: after the nearest predecessor', L.adding(['c'], ['a', 'b', 'd'], ['a', 'b', 'c', 'd']).join('') === 'abcd')
ok('adding: last when nothing before it is there', L.adding(['a'], ['x', 'y'], ['a', 'b']).join('') === 'xya')
ok('adding: nothing it already has', L.adding(['a'], ['a'], ['a']).join('') === 'a')

/* ---------------- inspector layouts ---------------- */

const I = (raw) => L.normalizeInspectorLayouts(raw)
let layouts = I(null)
ok('nothing saved: Write has its defaults', L.tabsOf(layouts, 'drafting').join() === 'clipboard,workbench,notes,timeline,references,history,stats')
ok('and Typeset has its own', L.tabsOf(layouts, 'finishing').join() === 'typeset,output,notes,references,history,stats')
ok('corrupt JSON is the defaults', L.tabsOf(I('][') , 'drafting').length === 7)

// An earlier version's bare map, from before Stats, Typeset and Print & Export: with no
// known list, those are the ones it never knew about.
layouts = I(JSON.stringify({ drafting: ['notes', 'clipboard', 'history'], finishing: ['page', 'book', 'publish', 'notes'] }))
ok('renamed tabs read as what they became, once', L.tabsOf(layouts, 'finishing').slice(0, 2).join() === 'typeset,output')
ok('a tab added later arrives after the one it follows by default',
  L.tabsOf(layouts, 'drafting').join() === 'notes,timeline,clipboard,history,stats')
ok('a layout that has it by default gets it once', L.tabsOf(layouts, 'finishing').filter((t) => t === 'stats').length === 1)

layouts = I(JSON.stringify({ layouts: { drafting: ['notes'] }, known: L.ARRANGEABLE_TABS }))
ok('a tab the user hid stays hidden once it is known', L.tabsOf(layouts, 'drafting').join() === 'notes')

layouts = I(JSON.stringify({ layouts: { drafting: ['map', 'nonsense', 'notes', 'notes'] }, known: L.ARRANGEABLE_TABS }))
ok('the map, unknown tabs and repeats are dropped', L.tabsOf(layouts, 'drafting').join() === 'notes')

layouts = I(JSON.stringify({ layouts: { drafting: [] }, known: L.ARRANGEABLE_TABS }))
ok('an empty layout falls back to its defaults', L.tabsOf(layouts, 'drafting').length === 7)

layouts = I(JSON.stringify({ layouts: {}, known: L.ARRANGEABLE_TABS, last: { drafting: 'notes', finishing: 'bogus' } }))
ok('the last tab per layout reads back, and a bad one is dropped', layouts.last.drafting === 'notes' && !layouts.last.finishing)

const round = I(L.serializeInspectorLayouts(L.setTabShown(I(null), 'drafting', 'clipboard', false)))
ok('a round trip keeps a hidden tab hidden', !L.tabsOf(round, 'drafting').includes('clipboard'))

/* ---------------- Customize Layout… ---------------- */

layouts = I(null)
ok('rows: shown in order, then the rest', L.rowsFor(layouts, 'drafting').join() === 'clipboard,workbench,notes,timeline,references,history,stats,typeset,output')

layouts = L.setTabShown(layouts, 'drafting', 'output', true)
ok('a newly shown tab goes last', L.tabsOf(layouts, 'drafting').at(-1) === 'output')

let only = I(JSON.stringify({ layouts: { drafting: ['notes'] }, known: L.ARRANGEABLE_TABS }))
only = L.setTabShown(only, 'drafting', 'notes', false)
ok('the last tab cannot be hidden', L.tabsOf(only, 'drafting').join() === 'notes')

layouts = L.moveTab(I(null), 'drafting', 0, 3)
ok('a move reorders the shown tabs', L.tabsOf(layouts, 'drafting').join() === 'workbench,notes,clipboard,timeline,references,history,stats')

layouts = L.moveTab(I(null), 'drafting', 0, 9)
ok('a shown tab dragged among the hidden ones stays ahead of them',
  L.tabsOf(layouts, 'drafting').join() === 'workbench,notes,timeline,references,history,stats,clipboard')

layouts = L.moveTab(I(null), 'drafting', 8, 0)
ok('a hidden row does not become shown by moving', !L.tabsOf(layouts, 'drafting').includes('output'))

layouts = L.restoreInspectorDefaults(L.setTabShown(I(null), 'drafting', 'clipboard', false), 'drafting')
ok('restore defaults', L.tabsOf(layouts, 'drafting').includes('clipboard'))

ok('the map comes first while a map is showing', L.visibleTabs(I(null), 'drafting', true)[0] === 'map')
ok('and not otherwise', !L.visibleTabs(I(null), 'drafting', false).includes('map'))
ok('Typeset mode is the finishing layout', L.layoutForMode('typeset') === 'finishing' && L.layoutForMode('write') === 'drafting')

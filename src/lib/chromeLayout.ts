/**
 * chromeLayout.ts — what the window's toolbars and inspector hold, as the user
 * arranged them. Pure: the hooks (useToolbarLayout, useInspectorLayout) read and write
 * the preference keys below and normalize through here.
 *
 * The ids and the migrations are those of layouts saved by earlier versions of
 * Inkblot, so every saved layout still reads.
 *
 * Toolbar item ids are storage keys: **never rename or reuse one.** An item that goes
 * away stays in RETIRED_TOOLBAR_IDS until no saved layout can still name it.
 */

/* ---------------- toolbars ---------------- */

export type ToolbarContext = 'document' | 'canvas' | 'map' | 'typeset'
export const TOOLBAR_CONTEXTS: ToolbarContext[] = ['document', 'canvas', 'map', 'typeset']

export type ToolbarDisplayMode = 'iconAndLabel' | 'icon' | 'label'
export const TOOLBAR_DISPLAY_MODES: ToolbarDisplayMode[] = ['iconAndLabel', 'icon', 'label']

export const SPACE = 'space'
export const FLEXIBLE_SPACE = 'flexible-space'
export const isSpacer = (id: string) => id === SPACE || id === FLEXIBLE_SPACE

export const toolbarLayoutKey = (context: ToolbarContext) => `inkblot.toolbar.layout.${context}`
export const TOOLBAR_DISPLAY_MODE_KEY = 'inkblot.toolbar.displayMode'
export const INSPECTOR_LAYOUTS_KEY = 'inkblot.inspector.layouts'

export type ToolbarItemSpec = {
  id: string
  label: string
  /** An SF Symbol name; SFIcon draws the ones it has. */
  symbol: string
  contexts: ToolbarContext[]
}

const ALL: ToolbarContext[] = ['document', 'canvas', 'map', 'typeset']

/** Every toolbar item, in the order the palette shows them. */
export const TOOLBAR_ITEMS: ToolbarItemSpec[] = [
  { id: 'inkblot.format.font', label: 'Font', symbol: 'textformat', contexts: ['document'] },
  { id: 'inkblot.format.font-size', label: 'Font Size', symbol: 'textformat.size', contexts: ['document'] },
  { id: 'inkblot.format.text-style', label: 'Text Style', symbol: 'bold.italic.underline', contexts: ['document'] },
  { id: 'inkblot.format.text-color', label: 'Text Color', symbol: 'character', contexts: ['document'] },
  { id: 'inkblot.format.highlight', label: 'Highlight', symbol: 'highlighter', contexts: ['document'] },
  { id: 'inkblot.format.alignment', label: 'Alignment', symbol: 'text.alignleft', contexts: ['document'] },
  { id: 'inkblot.format.paragraph-style', label: 'Paragraph Style', symbol: 'paragraphsign', contexts: ['document'] },
  { id: 'inkblot.format.bulleted-list', label: 'Bulleted List', symbol: 'list.bullet', contexts: ['document'] },
  { id: 'inkblot.format.numbered-list', label: 'Numbered List', symbol: 'list.number', contexts: ['document'] },
  { id: 'inkblot.insert.table', label: 'Table', symbol: 'table.grid', contexts: ['document'] },
  { id: 'inkblot.insert.conversation', label: 'Conversation', symbol: 'speech', contexts: ['document'] },
  { id: 'inkblot.edit.undo-redo', label: 'Undo/Redo', symbol: 'arrow.uturn.backward', contexts: ['document'] },
  { id: 'inkblot.edit.paste-and-match-style', label: 'Paste and Match Style', symbol: 'doc.on.clipboard', contexts: ['document'] },
  { id: 'inkblot.view.focus-mode', label: 'Focus Mode', symbol: 'scope', contexts: ['document'] },
  { id: 'inkblot.view.word-count', label: 'Word Count', symbol: 'number', contexts: ['document'] },

  { id: 'inkblot.canvas.lock', label: 'Lock', symbol: 'lock', contexts: ['canvas'] },
  { id: 'inkblot.canvas.add-card', label: 'Add Card', symbol: 'plus', contexts: ['canvas'] },
  { id: 'inkblot.canvas.add-image', label: 'Add Image', symbol: 'photo', contexts: ['canvas'] },
  { id: 'inkblot.canvas.record-memo', label: 'Record Memo', symbol: 'mic', contexts: ['canvas'] },
  { id: 'inkblot.canvas.color', label: 'Color', symbol: 'paintpalette', contexts: ['canvas'] },
  { id: 'inkblot.canvas.group', label: 'Group', symbol: 'rectangle.dashed', contexts: ['canvas'] },
  { id: 'inkblot.canvas.undo-redo', label: 'Undo/Redo', symbol: 'arrow.uturn.backward', contexts: ['canvas'] },
  { id: 'inkblot.canvas.alignment-guides', label: 'Alignment Guides', symbol: 'guides', contexts: ['canvas'] },
  { id: 'inkblot.canvas.snap-to-grid', label: 'Snap to Grid', symbol: 'table.grid', contexts: ['canvas'] },
  { id: 'inkblot.canvas.zoom', label: 'Zoom', symbol: 'magnifyingglass', contexts: ['canvas'] },
  { id: 'inkblot.canvas.delete', label: 'Delete', symbol: 'trash', contexts: ['canvas'] },

  { id: 'inkblot.map.drawing-tools', label: 'Drawing Tools', symbol: 'map.route', contexts: ['map'] },
  { id: 'inkblot.map.measure-tools', label: 'Measure Tools', symbol: 'map.ruler', contexts: ['map'] },
  { id: 'inkblot.map.undo-redo', label: 'Undo/Redo', symbol: 'arrow.uturn.backward', contexts: ['map'] },
  { id: 'inkblot.map.zoom', label: 'Zoom', symbol: 'magnifyingglass', contexts: ['map'] },
  { id: 'inkblot.map.delete', label: 'Delete', symbol: 'trash', contexts: ['map'] },

  { id: 'inkblot.history.snapshot', label: 'Snapshot Now', symbol: 'clock', contexts: ALL },
  { id: 'inkblot.panel.clipboard', label: 'Clipboard', symbol: 'doc.on.clipboard', contexts: ALL },
  { id: 'inkblot.panel.workbench', label: 'Workbench', symbol: 'hammer', contexts: ALL },
  { id: 'inkblot.panel.notes', label: 'Notes', symbol: 'note.text', contexts: ALL },
  { id: 'inkblot.panel.history', label: 'History', symbol: 'clock', contexts: ALL },
  { id: 'inkblot.panel.references', label: 'References', symbol: 'books.vertical', contexts: ALL },
  { id: 'inkblot.panel.stats', label: 'Stats', symbol: 'chart.bar.xaxis', contexts: ALL },
  { id: 'inkblot.timer', label: 'Timer', symbol: 'timer', contexts: ALL },
  { id: 'inkblot.tabs.new-tab', label: 'New Tab', symbol: 'plus.square.on.square', contexts: ALL },
  { id: 'inkblot.tabs.split', label: 'Split', symbol: 'rectangle.split.2x1', contexts: ALL },

  { id: 'inkblot.view.editor-mode', label: 'Mode', symbol: 'pencil.line', contexts: ['document', 'typeset'] },
  { id: 'inkblot.typeset.view', label: 'View', symbol: 'book.pages', contexts: ['typeset'] },
  { id: 'inkblot.typeset.edition', label: 'Edition', symbol: 'books.vertical', contexts: ['typeset'] },
  { id: 'inkblot.typeset.spread', label: 'Spreads', symbol: 'book', contexts: ['typeset'] },
  { id: 'inkblot.typeset.proof', label: 'Proof', symbol: 'checkmark.seal', contexts: ['typeset'] },
  { id: 'inkblot.typeset.grid', label: 'Baseline Grid', symbol: 'line.3.horizontal', contexts: ['typeset'] },
  { id: 'inkblot.typeset.tighten', label: 'Tighten', symbol: 'arrow.right.and.line.vertical.and.arrow.left', contexts: ['typeset'] },
  { id: 'inkblot.typeset.loosen', label: 'Loosen', symbol: 'arrow.left.and.line.vertical.and.arrow.right', contexts: ['typeset'] },
  { id: 'inkblot.typeset.keep-together', label: 'Keep Together', symbol: 'rectangle.compress.vertical', contexts: ['typeset'] },
  { id: 'inkblot.typeset.text-style', label: 'Style', symbol: 'textformat.alt', contexts: ['document', 'typeset'] },
  { id: 'inkblot.typeset.insert', label: 'Insert', symbol: 'rectangle.split.1x2', contexts: ['typeset'] },
  { id: 'inkblot.typeset.zoom', label: 'Zoom', symbol: 'magnifyingglass', contexts: ['typeset'] },
  { id: 'inkblot.typeset.print', label: 'Print', symbol: 'printer', contexts: ['typeset'] },
  { id: 'inkblot.typeset.export', label: 'Export', symbol: 'square.and.arrow.up', contexts: ['typeset'] },

  // Dictation and Read Aloud.
  { id: 'inkblot.speech.dictation', label: 'Dictation', symbol: 'mic', contexts: ['document'] },
  { id: 'inkblot.speech.read-aloud', label: 'Read Aloud', symbol: 'read.aloud', contexts: ['document'] },
]

/** Ids saved layouts may still name, which are dropped as they are read. */
export const RETIRED_TOOLBAR_IDS = ['inkblot.window.inspector-toggle']

const ITEM_BY_ID = new Map(TOOLBAR_ITEMS.map((item) => [item.id, item]))
export const toolbarItem = (id: string) => ITEM_BY_ID.get(id)

/** The items a context's toolbar can hold: its own, then the shared ones. */
export function toolbarItemsFor(context: ToolbarContext): ToolbarItemSpec[] {
  return TOOLBAR_ITEMS.filter((item) => item.contexts.includes(context))
}

/** Each toolbar's default set. */
export const DEFAULT_TOOLBARS: Record<ToolbarContext, string[]> = {
  document: [
    'inkblot.view.editor-mode', SPACE,
    'inkblot.format.font', 'inkblot.format.font-size', SPACE,
    'inkblot.format.text-style', SPACE,
    'inkblot.format.text-color', 'inkblot.format.highlight', 'inkblot.format.alignment', SPACE,
    'inkblot.insert.table', 'inkblot.insert.conversation', FLEXIBLE_SPACE,
    'inkblot.speech.dictation', 'inkblot.speech.read-aloud',
  ],
  canvas: [
    'inkblot.canvas.lock', SPACE,
    'inkblot.canvas.add-card', 'inkblot.canvas.add-image', 'inkblot.canvas.record-memo', 'inkblot.canvas.color', SPACE,
    'inkblot.canvas.group', 'inkblot.canvas.undo-redo', SPACE,
    'inkblot.canvas.alignment-guides', 'inkblot.canvas.snap-to-grid', SPACE,
    'inkblot.canvas.zoom',
  ],
  map: [
    'inkblot.map.drawing-tools', 'inkblot.map.measure-tools', SPACE,
    'inkblot.map.undo-redo', SPACE,
    'inkblot.map.zoom',
  ],
  typeset: [
    'inkblot.view.editor-mode',
    'inkblot.typeset.view', 'inkblot.typeset.edition', 'inkblot.typeset.spread', 'inkblot.typeset.proof',
    'inkblot.typeset.text-style', SPACE,
    'inkblot.typeset.insert', 'inkblot.typeset.zoom', FLEXIBLE_SPACE,
    'inkblot.typeset.print', 'inkblot.typeset.export',
  ],
}

export type ToolbarLayout = { version: 1; items: string[]; known: string[] }

const defaultIds = (context: ToolbarContext) => DEFAULT_TOOLBARS[context].filter((id) => !isSpacer(id))

export function defaultToolbarLayout(context: ToolbarContext): ToolbarLayout {
  return { version: 1, items: [...DEFAULT_TOOLBARS[context]], known: toolbarItemsFor(context).map((item) => item.id) }
}

/**
 * `saved` with each of `added` it lacks, each placed after the nearest entry before it
 * in `defaults` that `saved` has — or last, when there is none. (InspectorLayouts.adding)
 */
export function adding<T>(added: T[], saved: T[], defaults: T[]): T[] {
  const result = [...saved]
  for (const item of added) {
    if (result.includes(item)) continue
    const at = defaults.indexOf(item)
    const before = at === -1 ? defaults : defaults.slice(0, at)
    let anchorIndex = -1
    for (let i = before.length - 1; i >= 0; i -= 1) {
      const index = result.indexOf(before[i])
      if (index !== -1) { anchorIndex = index; break }
    }
    if (anchorIndex === -1) result.push(item)
    else result.splice(anchorIndex + 1, 0, item)
  }
  return result
}

const parse = (raw: unknown): unknown => {
  if (typeof raw !== 'string') return raw ?? null
  try { return JSON.parse(raw) } catch { return null }
}

/**
 * A saved toolbar layout made usable: unknown and retired ids dropped, each item at
 * most once (spacers excepted), and default items added since it was saved put in
 * after the item they follow by default. Palette-only additions are never inserted.
 * Anything unreadable, or empty, is the default set.
 */
export function normalizeToolbar(context: ToolbarContext, raw: unknown): ToolbarLayout {
  const value = parse(raw) as Partial<ToolbarLayout> | string[] | null
  const stored = Array.isArray(value) ? { items: value } : value
  if (!stored || typeof stored !== 'object' || !Array.isArray(stored.items)) return defaultToolbarLayout(context)

  const offered = new Set(toolbarItemsFor(context).map((item) => item.id))
  const seen = new Set<string>()
  const items = stored.items.filter((id): id is string => {
    if (typeof id !== 'string') return false
    if (isSpacer(id)) return true
    if (!offered.has(id) || seen.has(id)) return false
    seen.add(id)
    return true
  })
  // Collapse runs of spacers and trim them from the ends.
  const tidy = items.filter((id, i) => !(isSpacer(id) && (i === 0 || isSpacer(items[i - 1]))))
  while (tidy.length && isSpacer(tidy[tidy.length - 1])) tidy.pop()
  if (!tidy.some((id) => !isSpacer(id))) return defaultToolbarLayout(context)

  const known = Array.isArray(stored.known) ? new Set(stored.known) : null
  const newDefaults = known ? defaultIds(context).filter((id) => !known.has(id)) : []
  return {
    version: 1,
    items: adding(newDefaults, tidy, DEFAULT_TOOLBARS[context]),
    known: toolbarItemsFor(context).map((item) => item.id),
  }
}

export function normalizeDisplayMode(raw: unknown): ToolbarDisplayMode {
  return TOOLBAR_DISPLAY_MODES.includes(raw as ToolbarDisplayMode) ? (raw as ToolbarDisplayMode) : 'icon'
}

/* ---------------- the inspector ---------------- */

export type InspectorTab = 'clipboard' | 'workbench' | 'notes' | 'timeline' | 'references' | 'history' | 'typeset' | 'output' | 'stats' | 'map'
export type InspectorLayoutKind = 'drafting' | 'finishing'
export const INSPECTOR_LAYOUT_KINDS: InspectorLayoutKind[] = ['drafting', 'finishing']

export type InspectorTabSpec = { id: InspectorTab; title: string; symbol: string }

/** Every panel, in SidebarModel.Tab order. The map's is not one a layout holds. */
export const INSPECTOR_TABS: InspectorTabSpec[] = [
  { id: 'clipboard', title: 'Clipboard', symbol: 'doc.on.clipboard' },
  { id: 'workbench', title: 'Workbench', symbol: 'hammer' },
  { id: 'notes', title: 'Notes', symbol: 'note.text' },
  { id: 'timeline', title: 'Timeline', symbol: 'timeline' },
  { id: 'references', title: 'References', symbol: 'books.vertical' },
  { id: 'history', title: 'History', symbol: 'clock' },
  { id: 'typeset', title: 'Typeset', symbol: 'textformat' },
  { id: 'output', title: 'Print & Export', symbol: 'printer' },
  { id: 'stats', title: 'Stats', symbol: 'chart.bar.xaxis' },
  { id: 'map', title: 'Map', symbol: 'map' },
]
export const inspectorTab = (id: string) => INSPECTOR_TABS.find((tab) => tab.id === id)
export const ARRANGEABLE_TABS = INSPECTOR_TABS.map((tab) => tab.id).filter((id) => id !== 'map')

export const INSPECTOR_LAYOUT_INFO: Record<InspectorLayoutKind, { title: string; symbol: string; mode: 'write' | 'typeset' }> = {
  drafting: { title: 'Write', symbol: 'pencil.line', mode: 'write' },
  finishing: { title: 'Typeset', symbol: 'textformat', mode: 'typeset' },
}

export const DEFAULT_INSPECTOR_TABS: Record<InspectorLayoutKind, InspectorTab[]> = {
  drafting: ['clipboard', 'workbench', 'notes', 'timeline', 'references', 'history', 'stats'],
  finishing: ['typeset', 'output', 'notes', 'references', 'history', 'stats'],
}

export const layoutForMode = (mode: string): InspectorLayoutKind => (mode === 'typeset' ? 'finishing' : 'drafting')

/** Tabs that became others: Page and Book are Typeset now, Publish is Print & Export. */
export const RENAMED_TABS: Record<string, InspectorTab> = { page: 'typeset', book: 'typeset', publish: 'output' }
/** Tabs added after layouts could first be saved. */
export const ADDED_LATER: InspectorTab[] = ['stats', 'typeset', 'output', 'timeline']

export type InspectorLayouts = {
  version: 1
  layouts: Partial<Record<InspectorLayoutKind, InspectorTab[]>>
  known: InspectorTab[]
  last: Partial<Record<InspectorLayoutKind, InspectorTab>>
}

/** A saved list of tab names as tabs: renamed ones as what they became, each once, never the map's. */
export function tabsFrom(raw: unknown[]): InspectorTab[] {
  const seen = new Set<InspectorTab>()
  const out: InspectorTab[] = []
  for (const name of raw) {
    if (typeof name !== 'string') continue
    const tab = (ARRANGEABLE_TABS as string[]).includes(name) ? (name as InspectorTab) : RENAMED_TABS[name]
    if (!tab || seen.has(tab)) continue
    seen.add(tab)
    out.push(tab)
  }
  return out
}

export const defaultInspectorLayouts = (): InspectorLayouts => ({ version: 1, layouts: {}, known: [...ARRANGEABLE_TABS], last: {} })

/** The tabs `layout` shows: as saved, or its defaults. Never empty. */
export function tabsOf(layouts: InspectorLayouts, layout: InspectorLayoutKind): InspectorTab[] {
  const tabs = layouts.layouts[layout]
  return tabs && tabs.length ? tabs : DEFAULT_INSPECTOR_TABS[layout]
}

/**
 * The saved layouts made usable (InspectorLayouts.load): renamed tabs mapped, unknown
 * ones dropped, and a tab added since they were saved given to each layout that has
 * it by default, after the tab it follows there.
 */
export function normalizeInspectorLayouts(raw: unknown): InspectorLayouts {
  const value = parse(raw) as Partial<InspectorLayouts> & Record<string, unknown> | null
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaultInspectorLayouts()

  // Earlier versions stored a bare { drafting: [...], finishing: [...] } map.
  const stored = (value.layouts && typeof value.layouts === 'object' ? value.layouts : value) as Record<string, unknown>
  const knownRaw = Array.isArray(value.known) ? tabsFrom(value.known) : null
  const known = new Set(knownRaw ?? ARRANGEABLE_TABS.filter((tab) => !ADDED_LATER.includes(tab)))

  const result = defaultInspectorLayouts()
  for (const layout of INSPECTOR_LAYOUT_KINDS) {
    const saved = stored[layout]
    if (!Array.isArray(saved)) continue
    const defaults = DEFAULT_INSPECTOR_TABS[layout]
    const tabs = adding(defaults.filter((tab) => !known.has(tab)), tabsFrom(saved), defaults)
    if (tabs.length) result.layouts[layout] = tabs
  }
  const last = (value.last && typeof value.last === 'object' ? value.last : {}) as Record<string, unknown>
  for (const layout of INSPECTOR_LAYOUT_KINDS) {
    const tab = last[layout]
    if (typeof tab === 'string' && (INSPECTOR_TABS.some((t) => t.id === tab))) result.last[layout] = tab as InspectorTab
  }
  return result
}

const withTabs = (layouts: InspectorLayouts, layout: InspectorLayoutKind, tabs: InspectorTab[]): InspectorLayouts => {
  const seen = new Set<InspectorTab>()
  const unique = tabs.filter((tab) => tab !== 'map' && !seen.has(tab) && seen.add(tab))
  const next = { ...layouts, layouts: { ...layouts.layouts } }
  if (unique.length) next.layouts[layout] = unique
  else delete next.layouts[layout]
  return next
}

/** Every tab as Customize Layout… lists them: the shown ones in order, then the rest. */
export function rowsFor(layouts: InspectorLayouts, layout: InspectorLayoutKind): InspectorTab[] {
  const shown = tabsOf(layouts, layout)
  return [...shown, ...ARRANGEABLE_TABS.filter((tab) => !shown.includes(tab))]
}

/** Show or hide a tab. A newly shown tab goes last; the last tab shown cannot be hidden. */
export function setTabShown(layouts: InspectorLayouts, layout: InspectorLayoutKind, tab: InspectorTab, shown: boolean): InspectorLayouts {
  const current = [...tabsOf(layouts, layout)]
  if (shown) {
    if (!current.includes(tab)) current.push(tab)
  } else if (!(current.length === 1 && current[0] === tab)) {
    return withTabs(layouts, layout, current.filter((t) => t !== tab))
  }
  return withTabs(layouts, layout, current)
}

/**
 * Move a row in Customize Layout…'s list (indices over `rowsFor`). Only shown tabs
 * move, and they stay ahead of the hidden ones wherever they land.
 */
export function moveTab(layouts: InspectorLayouts, layout: InspectorLayoutKind, from: number, to: number): InspectorLayouts {
  const shown = new Set(tabsOf(layouts, layout))
  const rows = rowsFor(layouts, layout)
  const [moved] = rows.splice(from, 1)
  if (moved === undefined) return layouts
  rows.splice(from < to ? to - 1 : to, 0, moved)
  return withTabs(layouts, layout, rows.filter((tab) => shown.has(tab)))
}

export function restoreInspectorDefaults(layouts: InspectorLayouts, which: InspectorLayoutKind | 'both'): InspectorLayouts {
  const next = { ...layouts, layouts: { ...layouts.layouts } }
  for (const layout of INSPECTOR_LAYOUT_KINDS) if (which === 'both' || which === layout) delete next.layouts[layout]
  return next
}

export function rememberTab(layouts: InspectorLayouts, layout: InspectorLayoutKind, tab: InspectorTab): InspectorLayouts {
  if (layouts.last[layout] === tab) return layouts
  return { ...layouts, last: { ...layouts.last, [layout]: tab } }
}

/**
 * The tabs the inspector's header shows for a layout: the layout's own, with the
 * map's first while a map is showing.
 */
export function visibleTabs(layouts: InspectorLayouts, layout: InspectorLayoutKind, hasMap: boolean): InspectorTab[] {
  const tabs = tabsOf(layouts, layout)
  return hasMap ? ['map', ...tabs] : tabs
}

export const serializeInspectorLayouts = (layouts: InspectorLayouts) =>
  JSON.stringify({ ...layouts, known: [...ARRANGEABLE_TABS] })

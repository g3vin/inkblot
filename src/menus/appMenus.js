/**
 * The menu bar's items the Swift shell drew (InkblotApp.swift's InkblotCommands),
 * for the web app: Insert, Format, the View menu's mode, pages and split items,
 * Window's tab navigation, Edit ▸ Paste and Match Style, and File's extras.
 *
 * Every item acts at the moment it is chosen on the state the page last published —
 * the toolbar's target, the page layout, the tabs — and sends the command the Swift
 * menu sent. Built once; an item with nothing to act on does nothing.
 */
import { documentSurface, latestBridgeEvent, shellBridge } from '../bridge'
import { CITE_SOURCE_EVENT } from '../components/RightSidebar/references/citeEvent'
import { CUSTOMIZE_TOOLBAR_EVENT } from '../components/toolbar/toolbarContext'
import { CUSTOMIZE_INSPECTOR_EVENT } from '../hooks/contextMenu/toolbarMenu'
import { adjacentTab } from '../components/tabs/tabBarState'

const send = (type, payload) => shellBridge.send(type, payload)
const target = () => latestBridgeEvent('toolbarState')?.target ?? null
const layout = () => latestBridgeEvent('pageLayoutState') ?? null
const withTarget = (type, payload = {}) => () => {
  const t = target()
  if (t) send(type, { target: t, ...payload })
}
const event = (type, detail) => () => window.dispatchEvent(new CustomEvent(type, { detail }))

/** The References tab, its field focused: to add a source, or to cite one. */
const openReferences = (cite) => () => {
  documentSurface.publishShowSidebarTab({ tab: 'references' })
  // Once the tab has had a moment to mount.
  setTimeout(event(CITE_SOURCE_EVENT, { cite }), 80)
}

async function items(api, list) {
  const { MenuItem, PredefinedMenuItem, Submenu } = api
  return Promise.all(list.map(async (item) => {
    if (item.separator) return PredefinedMenuItem.new({ item: 'Separator' })
    if (item.items) return Submenu.new({ text: item.text, items: await items(api, item.items) })
    return MenuItem.new({ text: item.text, accelerator: item.accelerator, action: item.action })
  }))
}

export async function buildInsertMenu(api) {
  return api.Submenu.new({
    text: 'Insert',
    items: await items(api, [
      { text: 'Page Break', action: withTarget('insertBreak', { kind: 'page' }) },
      { text: 'Column Break', action: withTarget('insertBreak', { kind: 'column' }) },
      { text: 'Break to Next Right-Hand Page', action: withTarget('insertBreak', { kind: 'recto' }) },
      { separator: true },
      { text: 'Footnote', accelerator: 'CmdOrCtrl+Alt+F', action: () => { if (layout()?.mode !== 'typeset') withTarget('insertFootnote')() } },
      { separator: true },
      { text: 'Add Reference…', accelerator: 'CmdOrCtrl+Alt+R', action: openReferences(false) },
      { text: 'Insert Citation…', accelerator: 'CmdOrCtrl+Alt+K', action: () => { if (target()) openReferences(true)() } },
      { text: 'Insert Bibliography', action: withTarget('insertBibliography') },
    ]),
  })
}

export async function buildFormatMenu(api) {
  const format = (writingFormat) => withTarget('setWritingFormat', { format: writingFormat })
  return api.Submenu.new({
    text: 'Format',
    items: await items(api, [
      // No key equivalents: ⌘B, ⌘I and ⌘U already reach the editor, and a menu key as
      // well would toggle twice.
      { text: 'Bold', action: withTarget('applyMark', { mark: 'bold' }) },
      { text: 'Italic', action: withTarget('applyMark', { mark: 'italic' }) },
      { text: 'Underline', action: withTarget('applyMark', { mark: 'underline' }) },
      { text: 'Strikethrough', action: withTarget('applyMark', { mark: 'strike' }) },
      { separator: true },
      { text: 'Align Left', action: withTarget('setAlignment', { alignment: 'left' }) },
      { text: 'Center', action: withTarget('setAlignment', { alignment: 'center' }) },
      { text: 'Align Right', action: withTarget('setAlignment', { alignment: 'right' }) },
      { separator: true },
      { text: 'Write As', items: [
        { text: 'Prose', action: format('prose') },
        { text: 'Screenplay', action: format('screenplay') },
        { text: 'Stage Play', action: format('stageplay') },
      ] },
    ]),
  })
}

/** View ▸ the inspector's layouts, the toolbar, the split, the mode and the pages. */
export async function viewItems(api) {
  const mode = () => layout()?.mode ?? 'write'
  const typeset = (fn) => () => { if (mode() === 'typeset') fn() }
  const tabs = () => latestBridgeEvent('tabsChanged')
  const activeTab = () => tabs()?.tabs?.find((tab) => tab.id === tabs()?.activeTabId)
  return items(api, [
    { separator: true },
    { text: 'Customize Toolbar…', action: event(CUSTOMIZE_TOOLBAR_EVENT) },
    { text: 'Customize Inspector Layout…', action: event(CUSTOMIZE_INSPECTOR_EVENT) },
    { separator: true },
    { text: 'Split Right', action: () => { if (activeTab()?.split !== 'columns') send('openInSplit', { orientation: 'columns' }) } },
    { text: 'Split Down', action: () => { if (activeTab()?.split !== 'rows') send('openInSplit', { orientation: 'rows' }) } },
    { text: 'Close Split', action: () => { if (activeTab()?.split) send('closeSplit', {}) } },
    { separator: true },
    { text: 'Write', action: () => send('setEditorMode', { mode: 'write' }) },
    { text: 'Typeset', action: () => send('setEditorMode', { mode: 'typeset' }) },
    { text: 'Typeset the Book / Back to Write', action: () => send('setEditorMode', { mode: mode() === 'typeset' ? 'write' : 'typeset' }) },
    { text: 'E-book Preview', action: typeset(() => send('setTypesetView', { view: layout()?.typesetView === 'digital' ? 'print' : 'digital' })) },
    { text: 'Show Spreads', action: typeset(() => send('setTypesetDisplay', { spread: !layout()?.spread })) },
    { text: 'Show Baseline Grid', action: typeset(() => send('setTypesetDisplay', { grid: !layout()?.showGrid })) },
    { text: 'Proof the Pages', action: typeset(() => send('setTypesetDisplay', { proof: !layout()?.proof })) },
    { text: 'Page Zoom', items: [
      { text: 'Fit Width', action: () => send('setPrintZoom', { fit: 'width' }) },
      { text: 'Fit Page', action: () => send('setPrintZoom', { fit: 'page' }) },
      { text: 'Actual Size', action: () => send('setPrintZoom', { fit: 'actual' }) },
      { separator: true },
      { text: '100%', action: () => send('setPrintZoom', { zoom: 1 }) },
    ] },
  ])
}

/** Window ▸ the next and previous tab, where Safari and Xcode put them. */
export async function windowTabItems(api) {
  const step = (offset) => () => {
    const state = latestBridgeEvent('tabsChanged')
    const next = adjacentTab(state?.tabs ?? [], state?.activeTabId, offset)
    if (next) send('selectTab', { tabId: next.id })
  }
  return items(api, [
    { text: 'Show Previous Tab', action: step(-1) },
    { text: 'Show Next Tab', action: step(1) },
    { separator: true },
  ])
}

/** File ▸ New Tab, Export Again, Print and Export Whole Project. */
export async function fileExtraItems(api) {
  return items(api, [
    { text: 'New Tab', action: () => send('newTab', {}) },
    { separator: true },
    { text: 'Export Again', accelerator: 'CmdOrCtrl+Shift+E', action: () => send('exportAgain', {}) },
    { text: 'Print Whole Project…', action: () => send('printDocument', { scope: 'project', bound: false }) },
    { text: 'Export Whole Project', items: [
      ['pdf', 'PDF…'], ['docx', 'Word (.docx)…'], ['epub', 'EPUB…'], ['markdown', 'Markdown…'], ['html', 'HTML…'], ['plainText', 'Plain Text…'],
    ].map(([format, text]) => ({ text, action: () => send('exportDocument', { format, scope: 'project' }) })) },
  ])
}

/** Edit ▸ Paste and Match Style: the clipboard's text, without its formatting. */
export async function pasteAndMatchStyleItem(api) {
  return api.MenuItem.new({
    text: 'Paste and Match Style',
    accelerator: 'CmdOrCtrl+Alt+Shift+V',
    action: async () => {
      const t = target()
      if (!t) return
      try {
        const text = await navigator.clipboard.readText()
        if (text) send('insertPlainText', { target: t, text })
      } catch {
        // Nothing readable on the clipboard.
      }
    },
  })
}

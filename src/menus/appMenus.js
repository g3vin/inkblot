/**
 * The menu bar's own items: Insert, Format, the View menu's mode, pages and split
 * items, Window's tab navigation, Edit ▸ Paste and Match Style, and File's extras.
 *
 * Every item acts at the moment it is chosen on the state the page last published —
 * the toolbar's target, the page layout, the tabs — and sends the command the toolbar
 * would. Built once; an item with nothing to act on does nothing.
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
      { text: 'Page break', action: withTarget('insertBreak', { kind: 'page' }) },
      { text: 'Column break', action: withTarget('insertBreak', { kind: 'column' }) },
      { text: 'Break to next right-hand page', action: withTarget('insertBreak', { kind: 'recto' }) },
      { separator: true },
      { text: 'Footnote', accelerator: 'CmdOrCtrl+Alt+F', action: () => { if (layout()?.mode !== 'typeset') withTarget('insertFootnote')() } },
      { separator: true },
      { text: 'Add reference…', accelerator: 'CmdOrCtrl+Alt+R', action: openReferences(false) },
      { text: 'Insert citation…', accelerator: 'CmdOrCtrl+Alt+K', action: () => { if (target()) openReferences(true)() } },
      { text: 'Insert bibliography', action: withTarget('insertBibliography') },
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
      { text: 'Align left', action: withTarget('setAlignment', { alignment: 'left' }) },
      { text: 'Center', action: withTarget('setAlignment', { alignment: 'center' }) },
      { text: 'Align right', action: withTarget('setAlignment', { alignment: 'right' }) },
      { separator: true },
      { text: 'Write as', items: [
        { text: 'Prose', action: format('prose') },
        { text: 'Screenplay', action: format('screenplay') },
        { text: 'Stage play', action: format('stageplay') },
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
    { text: 'Customize toolbar…', action: event(CUSTOMIZE_TOOLBAR_EVENT) },
    { text: 'Customize inspector layout…', action: event(CUSTOMIZE_INSPECTOR_EVENT) },
    { separator: true },
    { text: 'Split right', action: () => { if (activeTab()?.split !== 'columns') send('openInSplit', { orientation: 'columns' }) } },
    { text: 'Split down', action: () => { if (activeTab()?.split !== 'rows') send('openInSplit', { orientation: 'rows' }) } },
    { text: 'Close split', action: () => { if (activeTab()?.split) send('closeSplit', {}) } },
    { separator: true },
    { text: 'Write', action: () => send('setEditorMode', { mode: 'write' }) },
    { text: 'Typeset', action: () => send('setEditorMode', { mode: 'typeset' }) },
    { text: 'Typeset the book / back to Write', action: () => send('setEditorMode', { mode: mode() === 'typeset' ? 'write' : 'typeset' }) },
    { text: 'E-book preview', action: typeset(() => send('setTypesetView', { view: layout()?.typesetView === 'digital' ? 'print' : 'digital' })) },
    { text: 'Show spreads', action: typeset(() => send('setTypesetDisplay', { spread: !layout()?.spread })) },
    { text: 'Show baseline grid', action: typeset(() => send('setTypesetDisplay', { grid: !layout()?.showGrid })) },
    { text: 'Proof the Pages', action: typeset(() => send('setTypesetDisplay', { proof: !layout()?.proof })) },
    { text: 'Page zoom', items: [
      { text: 'Fit width', action: () => send('setPrintZoom', { fit: 'width' }) },
      { text: 'Fit page', action: () => send('setPrintZoom', { fit: 'page' }) },
      { text: 'Actual size', action: () => send('setPrintZoom', { fit: 'actual' }) },
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
    { text: 'Show previous tab', action: step(-1) },
    { text: 'Show next tab', action: step(1) },
    { separator: true },
  ])
}

/** File ▸ New Tab, Export Again, Print and Export Whole Project. */
export async function fileExtraItems(api) {
  return items(api, [
    { text: 'New tab', action: () => send('newTab', {}) },
    { separator: true },
    { text: 'Export again', accelerator: 'CmdOrCtrl+Shift+E', action: () => send('exportAgain', {}) },
    { text: 'Print whole project…', action: () => send('printDocument', { scope: 'project', bound: false }) },
    { text: 'Export whole project', items: [
      ['pdf', 'PDF…'], ['docx', 'Word (.docx)…'], ['epub', 'EPUB…'], ['markdown', 'Markdown…'], ['html', 'HTML…'], ['plainText', 'Plain text…'],
    ].map(([format, text]) => ({ text, action: () => send('exportDocument', { format, scope: 'project' }) })) },
  ])
}

/** Edit ▸ Paste and Match Style: the clipboard's text, without its formatting. */
export async function pasteAndMatchStyleItem(api) {
  return api.MenuItem.new({
    text: 'Paste and match style',
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

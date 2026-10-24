/**
 * editorSession.ts — the shape of a saved editor session, and how it is restored.
 *
 * Open tabs, panes, split ratio and clipboard history live in the preference store under
 * `inkblot-session`. Everything here is pure: normalizers, defaults and clamps,
 * with no React and no filesystem, so a malformed or outdated stored session is
 * coerced into something usable rather than throwing on load.
 *
 * The input types are deliberately looser than the output ones. What comes back out
 * of the preference store is whatever was written there — by this build, by an older
 * one, or by a hand-edited file — so every field arrives as `unknown` (`Loose<T>`)
 * and leaves as the type the app may rely on.
 *
 * The `as` casts below are assertions about what the writer wrote, not checks: they
 * are erased, so a field holding something exotic (a stored `5` for `currentDoc`)
 * passes through unchanged. Coercing with `typeof` checks would be stricter, and a
 * behaviour change for sessions already on disk.
 */
import type { Loose } from '../types'
import { getPreference } from './preferences'
export const PERSIST_KEY = 'inkblot-session'
export const CLIPBOARD_PERSIST_KEY = 'inkblot-clipboard-history'
export const MAX_CLIPBOARD_ENTRIES = 80
// Copied images are kept as data URLs in the preferences file, so fewer of them.
export const MAX_CLIPBOARD_IMAGES = 12
// Search is the sidebar's search bar, not a tab, so a stored 'search' (or any
// unknown id) restores to the default tab.
export const RIGHT_SIDEBAR_TAB_IDS = new Set([
  'clipboard', 'workbench', 'notes', 'references', 'history', 'typeset', 'output', 'stats', 'map',
])

/** Which panel the right sidebar is showing. */
export type RightSidebarTab =
  | 'clipboard' | 'workbench' | 'notes' | 'references' | 'history' | 'typeset' | 'output' | 'stats' | 'map'

/** `'editor'` is the only split there is; `null` is no split. */
export type SplitView = 'editor' | null

export type SplitOrientation = 'columns' | 'rows'

/** One open tab. */
export interface DocTab {
  id: string
  /** Null on a draft — a tab holding a filename being typed, with no document yet. */
  docPath: string | null
  /** Opened implicitly, not deliberately; closes with its document. */
  ephemeral: boolean
  /**
   * The tab's split: the document beside or below its own, brought back when the tab
   * is selected again. `null` is no split; absent (a session saved before tabs owned
   * their splits) is not known yet, and the tab takes whatever the panes show.
   */
  secondaryDoc?: string | null
  splitOrientation?: SplitOrientation
}

/** What one project remembers between launches. */
export interface ProjectSession {
  currentDoc: string
  secondaryDoc: string | null
  splitView: SplitView
  splitOrientation: SplitOrientation
  splitRatio: number
  activeDoc: string
  sidebarTab: RightSidebarTab
  /** Workbench tiles, carried through untouched — their shape belongs to Workbench. */
  tiles: unknown[]
  docTabs: DocTab[]
  activeTabId: string | null
  /** The splits kept in the file tree, and the one showing. */
  splits: SavedSplit[]
  activeSplitId: string | null
  updatedAt: string | null
}

export interface EditorSession {
  lastProject: string
  projects: Record<string, ProjectSession>
}

export const createEmptySession = (fallbackProject?: string | null): EditorSession => ({
  lastProject: fallbackProject || '',
  projects: {},
})

/**
 * Drop malformed tabs from a restored session. A tab is a document, or a draft
 * (docPath null) that has not decided what document it is yet. An `ephemeral`
 * tab is one created implicitly for a document opened from the file
 * tree — see ensureTabsForOpenDocs.
 */
export const normalizeTabs = (tabs: unknown): DocTab[] => {
  if (!Array.isArray(tabs)) return []
  return tabs
    .filter((tab): tab is Loose<DocTab> => Boolean(tab) && typeof tab?.id === 'string')
    .map(tab => ({
      id: tab.id as string,
      docPath: typeof tab.docPath === 'string' && tab.docPath ? tab.docPath : null,
      ephemeral: Boolean(tab.ephemeral),
      ...(tab.secondaryDoc === undefined ? {} : {
        secondaryDoc: typeof tab.secondaryDoc === 'string' && tab.secondaryDoc ? tab.secondaryDoc : null,
      }),
      ...(tab.splitOrientation === 'rows' || tab.splitOrientation === 'columns'
        ? { splitOrientation: tab.splitOrientation as SplitOrientation }
        : {}),
    }))
}

export const SPLIT_RATIO_MIN = 0.2
export const SPLIT_RATIO_MAX = 0.8

export const clampSplitRatio = (value: unknown): number => {
  const ratio = Number(value)
  if (!Number.isFinite(ratio)) return 0.5
  return Math.min(SPLIT_RATIO_MAX, Math.max(SPLIT_RATIO_MIN, ratio))
}

/** Identical to `RIGHT_SIDEBAR_TAB_IDS.has`, and narrows what it is given. */
const isRightSidebarTab = (value: unknown): value is RightSidebarTab =>
  typeof value === 'string' && RIGHT_SIDEBAR_TAB_IDS.has(value)

/** Fill in defaults for a persisted per-project session so downstream code can trust the shape. */
export const normalizeProjectSession = (session: Loose<ProjectSession> = {}): ProjectSession => ({
  currentDoc: (session.currentDoc || '') as string,
  secondaryDoc: (session.secondaryDoc || null) as string | null,
  splitView: (session.splitView || null) as SplitView,
  splitOrientation: session.splitOrientation === 'rows' ? 'rows' : 'columns',
  splitRatio: clampSplitRatio(session.splitRatio ?? 0.5),
  activeDoc: (session.activeDoc || session.currentDoc || '') as string,
  sidebarTab: isRightSidebarTab(session.sidebarTab) ? session.sidebarTab : 'workbench',
  tiles: Array.isArray(session.tiles) ? session.tiles : [],
  docTabs: normalizeTabs(session.docTabs),
  activeTabId: (session.activeTabId || null) as string | null,
  splits: normalizeSavedSplits(session.splits),
  activeSplitId: (session.activeSplitId || null) as string | null,
  updatedAt: (session.updatedAt || null) as string | null,
})

export const createTabId = (): string =>
  `tab-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`

/**
 * Every open document has a tab, whether or not it was opened deliberately.
 *
 * Opening a document *replaces the active tab*: clicking through the file tree,
 * a search result, or a canvas card reuses the tab you are standing on instead
 * of piling new ones up. Tabs are only ever added on purpose — "Open in New
 * Tab" or a split — and each of those
 * paths creates its tab itself, so by the time this runs the document already
 * has one and the active tab is left alone.
 *
 * The split's second document gets no tab of its own: the split belongs to the
 * tab it was opened in (`secondaryDoc` on the tab). Ephemeral tabs are what older
 * sessions gave it, and they still go when their document leaves the panes.
 *
 * Returns `tabs` unchanged when nothing needs to happen, so this is safe to run
 * from an effect on every document change.
 */
export const ensureTabsForOpenDocs = (
  tabs: DocTab[],
  { currentDoc, secondaryDoc, activeTabId }: {
    currentDoc: string | null | undefined
    secondaryDoc: string | null | undefined
    activeTabId: string | null | undefined
  },
): DocTab[] => {
  const open = [currentDoc, secondaryDoc].filter(Boolean)
  let next = tabs
  let changed = false

  if (currentDoc && !next.some(tab => tab.docPath === currentDoc)) {
    const active = next.find(tab => tab.id === activeTabId)

    // A draft tab holds only a filename being typed, never document content, so
    // adopting one cannot lose written work.
    next = active
      ? next.map(tab => (
        tab.id === active.id ? { ...tab, docPath: currentDoc, ephemeral: false } : tab
      ))
      : [...next, { id: createTabId(), docPath: currentDoc, ephemeral: false }]
    changed = true
  }

  const kept = next.filter(tab => (
    !tab.ephemeral || (tab.docPath && open.includes(tab.docPath))
  ))
  if (kept.length !== next.length) changed = true

  return changed ? kept : tabs
}

/**
 * What the tab operations below read and change: the tabs, and what the two panes
 * show. `currentDoc` is the primary pane (`''` when it is empty or holds a draft);
 * `activeDoc` is whichever pane has the page's attention.
 */
export interface TabWorkspace {
  tabs: DocTab[]
  activeTabId: string | null
  currentDoc: string
  secondaryDoc: string | null
  activeDoc: string
  splitView: SplitView
  splitOrientation: SplitOrientation
}

/** What the panes show of a split: the document beside the primary one, or none. */
export interface PaneSplit {
  secondaryDoc: string
  splitOrientation: SplitOrientation
}

export const splitOfPanes = (ws: Pick<TabWorkspace, 'splitView' | 'secondaryDoc' | 'splitOrientation'>): PaneSplit | null => (
  ws.splitView === 'editor' && ws.secondaryDoc
    ? { secondaryDoc: ws.secondaryDoc, splitOrientation: ws.splitOrientation }
    : null
)

/** A tab's split, or null — never its own document against itself. */
export const splitOfTab = (tab: DocTab): PaneSplit | null => (
  tab.secondaryDoc && tab.secondaryDoc !== tab.docPath
    ? { secondaryDoc: tab.secondaryDoc, splitOrientation: tab.splitOrientation || 'columns' }
    : null
)

/**
 * Show a tab: its document in the primary pane, and its split, or none. A draft has
 * no document, so the primary pane empties and DraftTabPane takes over.
 */
export const selectTabIn = (ws: TabWorkspace, tabId: string): TabWorkspace => {
  const tab = ws.tabs.find(item => item.id === tabId)
  if (!tab) return ws
  const docPath = tab.docPath || ''
  const split = splitOfTab(tab)
  return {
    ...ws,
    activeTabId: tab.id,
    currentDoc: docPath,
    activeDoc: docPath,
    secondaryDoc: split?.secondaryDoc ?? null,
    splitView: split ? 'editor' : null,
    splitOrientation: split?.splitOrientation ?? ws.splitOrientation,
  }
}

/**
 * Close one tab. Closing the tab being shown shows the next one along — the
 * right-hand neighbour, else the left, as Safari does — with its split; closing the
 * last one empties the window.
 */
export const closeTabIn = (ws: TabWorkspace, tabId: string): TabWorkspace => {
  const index = ws.tabs.findIndex(item => item.id === tabId)
  if (index === -1) return ws
  const tab = ws.tabs[index]
  const remaining = ws.tabs.filter(item => item.id !== tabId)
  const next: TabWorkspace = { ...ws, tabs: remaining }

  const shown = tab.id === ws.activeTabId || (tab.docPath !== null && tab.docPath === ws.currentDoc)
  if (!shown) return next

  const along = [...remaining.slice(index), ...remaining.slice(0, index).reverse()]
  const fallback = along.find(item => item.docPath) || along[0]
  if (fallback) return selectTabIn(next, fallback.id)

  return { ...next, activeTabId: null, currentDoc: '', activeDoc: '', secondaryDoc: null, splitView: null }
}

/**
 * Write what the panes show into the tab that is showing it, so selecting the tab
 * again brings its split back. Returns `tabs` unchanged when the tab already says so.
 */
export const recordSplitIn = (tabs: DocTab[], tabId: string | null, split: PaneSplit | null): DocTab[] => {
  const tab = tabs.find(item => item.id === tabId)
  if (!tab) return tabs
  const secondaryDoc = split?.secondaryDoc ?? null
  const splitOrientation = split?.splitOrientation ?? tab.splitOrientation
  if (tab.secondaryDoc === secondaryDoc && tab.splitOrientation === splitOrientation) return tabs
  return tabs.map(item => (
    item.id === tabId
      ? { ...item, secondaryDoc, ...(splitOrientation ? { splitOrientation } : {}) }
      : item
  ))
}

/** Which side of a split a document goes: the first pane (left or top), or the second. */
export type SplitSide = 'start' | 'end'

/**
 * Put a document in one side of a split, as a document dragged from the file tree onto
 * the page does. With no split it opens one, beside the document showing; in a split
 * it takes that side's pane. A document already in the other pane trades places with
 * it, and one already on that side changes nothing. A document never splits against
 * itself.
 *
 * The first pane is the tab's own document, so putting a document there moves the tab
 * onto it: onto the tab that document already has, if it has one, so no two tabs show
 * the same document.
 */
export const placeDocIn = (ws: TabWorkspace, docPath: string, side: SplitSide): TabWorkspace => {
  if (!docPath) return ws
  const current = ws.currentDoc
  if (!current) return { ...ws, currentDoc: docPath, activeDoc: docPath }

  const split = splitOfPanes(ws)
  const other = split?.secondaryDoc ?? null
  let pair: [string, string]
  if (side === 'end') {
    if (docPath === other) return ws
    if (docPath === current) {
      if (!other) return ws
      pair = [other, current]
    } else {
      pair = [current, docPath]
    }
  } else {
    if (docPath === current) return ws
    pair = docPath === other ? [other, current] : [docPath, other ?? current]
  }

  const [primary, secondary] = pair
  return showPanesIn(ws, primary, secondary, split?.splitOrientation ?? 'columns', docPath)
}

/**
 * Show `primary` in the first pane and `secondary` (or nothing) beside it. The first
 * pane is the tab's own document, so a new one there moves the tab onto it: onto the
 * tab that document already has, if it has one, so no two tabs show the same document.
 */
const showPanesIn = (
  ws: TabWorkspace,
  primary: string,
  secondary: string | null,
  splitOrientation: SplitOrientation,
  activeDoc: string,
): TabWorkspace => {
  const shown = {
    ...ws,
    secondaryDoc: secondary,
    splitView: (secondary ? 'editor' : null) as SplitView,
    splitOrientation,
    activeDoc,
  }
  if (primary === ws.currentDoc) return shown

  const owner = ws.tabs.find(tab => tab.docPath === primary && tab.id !== ws.activeTabId)
  const tabId = owner?.id ?? ws.activeTabId
  const record = { docPath: primary, ephemeral: false, secondaryDoc: secondary, splitOrientation }
  const tabs = tabId && ws.tabs.some(tab => tab.id === tabId)
    ? ws.tabs.map(tab => (tab.id === tabId ? { ...tab, ...record } : tab))
    : [...ws.tabs, { id: createTabId(), ...record }]
  return {
    ...shown,
    tabs,
    activeTabId: tabId && tabs.some(tab => tab.id === tabId) ? tabId : tabs[tabs.length - 1].id,
    currentDoc: primary,
  }
}

/** Show one document on its own, as choosing it in the file tree does, leaving any split. */
export const openAloneIn = (ws: TabWorkspace, docPath: string): TabWorkspace => (
  docPath ? showPanesIn(ws, docPath, null, ws.splitOrientation, docPath) : ws
)

/**
 * A split the writer has made, kept in the file tree so they can leave it for another
 * document and come back. Its two documents are in the panes it names.
 */
export interface SavedSplit {
  id: string
  primaryDoc: string
  secondaryDoc: string
  splitOrientation: SplitOrientation
  splitRatio: number
}

/** Show a kept split again. */
export const showSplitIn = (ws: TabWorkspace, split: SavedSplit): TabWorkspace => (
  showPanesIn(ws, split.primaryDoc, split.secondaryDoc, split.splitOrientation, split.primaryDoc)
)

export const createSplitId = (): string =>
  `split-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`

/**
 * Keep the split showing in the list. The one being shown (`activeId`) follows what its
 * panes show; a split opened fresh is the one with the same two documents, or else a
 * new entry. With no split showing, none is active. Returns the inputs unchanged when
 * nothing needs to happen, so this is safe to run from an effect.
 */
export const recordSavedSplit = (
  splits: SavedSplit[],
  activeId: string | null,
  live: { primaryDoc: string, secondaryDoc: string, splitOrientation: SplitOrientation, splitRatio: number } | null,
): { splits: SavedSplit[], activeId: string | null } => {
  if (!live || !live.primaryDoc) return activeId === null ? { splits, activeId } : { splits, activeId: null }

  const same = (split: SavedSplit) => (
    split.primaryDoc === live.primaryDoc && split.secondaryDoc === live.secondaryDoc
    && split.splitOrientation === live.splitOrientation && split.splitRatio === live.splitRatio
  )
  const active = splits.find(split => split.id === activeId)
  if (active) {
    if (same(active)) return { splits, activeId }
    return { splits: splits.map(split => (split.id === active.id ? { ...split, ...live } : split)), activeId }
  }
  const match = splits.find(split => split.primaryDoc === live.primaryDoc && split.secondaryDoc === live.secondaryDoc)
  if (match) {
    return {
      splits: same(match) ? splits : splits.map(split => (split.id === match.id ? { ...split, ...live } : split)),
      activeId: match.id,
    }
  }
  const added = { id: createSplitId(), ...live }
  return { splits: [...splits, added], activeId: added.id }
}

/** Drop kept splits that are malformed, or that name one document twice. */
export const normalizeSavedSplits = (splits: unknown): SavedSplit[] => {
  if (!Array.isArray(splits)) return []
  return splits
    .filter((split): split is Loose<SavedSplit> => Boolean(split) && typeof split?.id === 'string')
    .filter(split => typeof split.primaryDoc === 'string' && typeof split.secondaryDoc === 'string'
      && split.primaryDoc && split.secondaryDoc && split.primaryDoc !== split.secondaryDoc)
    .map(split => ({
      id: split.id as string,
      primaryDoc: split.primaryDoc as string,
      secondaryDoc: split.secondaryDoc as string,
      splitOrientation: split.splitOrientation === 'rows' ? 'rows' : 'columns',
      splitRatio: clampSplitRatio(split.splitRatio ?? 0.5),
    }))
}

/**
 * Put the tabs in the order the shell shows them. Tabs `ids` does not name keep their
 * order after the ones it does; ids of tabs that are gone are ignored.
 */
export const orderTabsIn = (tabs: DocTab[], ids: string[]): DocTab[] => {
  const named = ids.map(id => tabs.find(tab => tab.id === id)).filter((tab): tab is DocTab => Boolean(tab))
  const ordered = [...new Set(named), ...tabs.filter(tab => !ids.includes(tab.id))]
  return ordered.every((tab, index) => tab === tabs[index]) ? tabs : ordered
}

/**
 * Load the persisted session. Supports both the current
 * multi-project shape ({ lastProject, projects }) and the legacy single-project
 * shape ({ projectName, ... }), which is migrated on the fly.
 */
export const loadSession = (fallbackProject?: string | null): EditorSession => {
  try {
    const raw = getPreference(PERSIST_KEY)
    if (!raw) return createEmptySession(fallbackProject)

    const parsed = JSON.parse(raw)
    if (parsed?.projects && typeof parsed.projects === 'object') {
      return {
        ...createEmptySession(fallbackProject),
        ...parsed,
        projects: Object.fromEntries(
          Object.entries(parsed.projects).map(([projectName, projectSession]) => [
            projectName,
            normalizeProjectSession(projectSession as Loose<ProjectSession>),
          ])
        ),
      }
    }

    if (parsed?.projectName) {
      return {
        lastProject: parsed.projectName,
        projects: {
          [parsed.projectName]: normalizeProjectSession(parsed),
        },
      }
    }

    return createEmptySession(fallbackProject)
  } catch {
    return createEmptySession(fallbackProject)
  }
}

/**
 * One entry of the clipboard history panel. A copied image is `kind: 'image'` with its
 * `src` (and an empty `text`, so older builds still load the history).
 */
export interface ClipboardEntry {
  text: string
  kind?: 'text' | 'image'
  src?: string
  [key: string]: unknown
}

/** Load persisted clipboard-history entries, dropping anything malformed. */
export const loadClipboardHistory = (): ClipboardEntry[] => {
  try {
    const raw = getPreference(CLIPBOARD_PERSIST_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is ClipboardEntry => item && typeof item.text === 'string')
  } catch {
    return []
  }
}

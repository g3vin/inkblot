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
 * are erased, so a field holding something exotic comes out of here exactly as it did
 * before this file was TypeScript. Coercing instead would be a behaviour change, and
 * this is a port.
 */
import type { Loose } from '../types'
import { getPreference } from './preferences'
export const PERSIST_KEY = 'inkblot-session'
export const CLIPBOARD_PERSIST_KEY = 'inkblot-clipboard-history'
export const MAX_CLIPBOARD_ENTRIES = 80
// No 'search': search is the sidebar's search bar, not a tab. A session saved
// before that change restores to the default tab rather than a tab that is gone.
export const RIGHT_SIDEBAR_TAB_IDS = new Set(['clipboard', 'workbench', 'notes', 'history'])

/** Which panel the right sidebar is showing. */
export type RightSidebarTab = 'clipboard' | 'workbench' | 'notes' | 'history'

/** `'editor'` is the only split there is; `null` is no split. */
export type SplitView = 'editor' | null

export type SplitOrientation = 'columns' | 'rows'

/** One tab in the dock. */
export interface DocTab {
  id: string
  /** Null on a draft — a tab holding a filename being typed, with no document yet. */
  docPath: string | null
  /** Opened by the dock on its own, not deliberately; closes with its document. */
  ephemeral: boolean
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
 * tab is one the dock created on its own for a document opened from the file
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
  updatedAt: (session.updatedAt || null) as string | null,
})

export const createTabId = (): string =>
  `tab-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`

/**
 * Every open document has a dot, whether or not it was opened deliberately.
 *
 * Opening a document *replaces the active tab*: clicking through the file tree,
 * a search result, or a canvas card reuses the tab you are standing on instead
 * of piling new ones up. Tabs are only ever added on purpose — the new-tab
 * button, "Open in New Tab", a drop on the dock, or a split — and each of those
 * paths creates its tab itself, so by the time this runs the document already
 * has one and the active tab is left alone.
 *
 * The split's second document is the exception: it is on screen *beside* the
 * primary one, so it cannot share a tab and gets its own. That tab stays
 * ephemeral — closing the split takes it away again.
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

  if (secondaryDoc && !next.some(tab => tab.docPath === secondaryDoc)) {
    next = [...next, { id: createTabId(), docPath: secondaryDoc, ephemeral: true }]
    changed = true
  }

  const kept = next.filter(tab => (
    !tab.ephemeral || (tab.docPath && open.includes(tab.docPath))
  ))
  if (kept.length !== next.length) changed = true

  return changed ? kept : tabs
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

/** One entry of the clipboard history panel. */
export interface ClipboardEntry {
  text: string
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

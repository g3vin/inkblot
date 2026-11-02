/**
 * snapshot.ts — one report, assembled from everything the recorders hold.
 *
 * The state section is an allowlist: the bridge events and preferences named here,
 * each passed through `summarize`. The finished report then has home folders
 * scrubbed and goes through the leak guard (sanitize.ts), so a string that matches an
 * open document is gone before the report leaves this function.
 */
import { getVersion } from '@tauri-apps/api/app'
import { latestBridgeEvent } from '../../bridge/useBridge'
import { editorRegistry } from '../../bridge/appBridge'
import type { EventType } from '../../bridge/client'
import { getPreference } from '../preferences'
import { breadcrumbs } from './breadcrumbs'
import { recentConsole, recentErrors, type CapturedError } from './capture'
import { documentShapes, openDocumentTexts } from './documentShape'
import { nativeInfo, rustLog } from './native'
import { perfSnapshot } from './perf'
import { documentShingles, guardAgainstDocuments, scrubHomeEverywhere, summarize } from './sanitize'

export const SCHEMA = 1

/** The bridge state a report shows. Read-aloud text and sources are never among them. */
const EVENTS: EventType[] = [
  'tabsChanged', 'activeEditorChanged', 'docChanged', 'toolbarState', 'viewOptions',
  'projectChanged', 'showSidebarTab', 'pageLayoutState', 'printJobStatus', 'canvasToolbarChanged',
  'mapChromeChanged', 'timelineChromeChanged', 'timelineCursorChanged', 'typesetFocus',
  'selectionContext',
]

/** The preferences a report shows. Clipboard history and caches are never among them. */
const PREFERENCES = [
  'inkblot-theme', 'inkblot-accent-color', 'inkblot-tray-color', 'inkblot-show-word-count-badge',
  'inkblot-last-seen-version', 'inkblot-keybindings', 'inkblot-session',
]

function preferenceState() {
  const out: Record<string, unknown> = {}
  for (const key of PREFERENCES) {
    const raw = getPreference(key)
    if (raw === null) continue
    try {
      out[key] = summarize(JSON.parse(raw), key)
    } catch {
      out[key] = summarize(raw, 'state')
    }
  }
  return out
}

function bridgeState() {
  const out: Record<string, unknown> = {}
  for (const type of EVENTS) {
    const payload = latestBridgeEvent(type)
    if (payload !== undefined) out[type] = summarize(payload)
  }
  return out
}

async function appInfo(native: Awaited<ReturnType<typeof nativeInfo>>) {
  let version: string | null = null
  try {
    version = await getVersion()
  } catch {
    // No native side.
  }
  const root = document.documentElement
  return {
    version,
    os: native?.os ?? navigator.userAgent,
    debugBuild: native?.debugBuild ?? import.meta.env?.DEV ?? null,
    locale: navigator.language,
    window: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
    theme: root.dataset.theme ?? null,
    platform: root.dataset.platform ?? null,
  }
}

export interface ReportOptions {
  kind: string
  error?: CapturedError
}

export interface Report {
  schema: number
  kind: string
  createdAt: string
  redactions: number
  [section: string]: unknown
}

/** Build a report, already scrubbed and guarded. Never throws. */
export async function buildReport({ kind, error }: ReportOptions): Promise<Report> {
  const native = await nativeInfo()
  const safely = <T,>(read: () => T): T | { unavailable: string } => {
    try {
      return read()
    } catch (problem) {
      return { unavailable: problem instanceof Error ? problem.message : String(problem) }
    }
  }
  const report: Report = {
    schema: SCHEMA,
    kind,
    createdAt: new Date().toISOString(),
    redactions: 0,
    ...(error ? { error } : {}),
    app: await appInfo(native),
    native: native ? { process: native.process } : null,
    state: {
      activeEditor: editorRegistry.activeTarget(),
      events: safely(bridgeState),
      preferences: safely(preferenceState),
    },
    documents: safely(documentShapes),
    perf: safely(perfSnapshot),
    breadcrumbs: breadcrumbs(),
    errors: recentErrors(),
    console: recentConsole(),
    rustLog: (await rustLog()) ?? [],
  }
  scrubHomeEverywhere(report)
  report.redactions = guardAgainstDocuments(report, documentShingles(safelyTexts()))
  return report
}

/** The writer's note on a report, with any of their writing taken out. */
export function guardNote(note: string): { note: string; redactions: number } {
  const holder = { note: note.slice(0, 4000) }
  scrubHomeEverywhere(holder)
  const redactions = guardAgainstDocuments(holder, documentShingles(safelyTexts()))
  return { note: holder.note, redactions }
}

function safelyTexts(): string[] {
  try {
    return openDocumentTexts()
  } catch {
    return []
  }
}

/** One line per part, for the dialog's "What's included". */
export function describeReport(report: Report): string[] {
  const count = (value: unknown) => (Array.isArray(value) ? value.length : 0)
  const documents = count(report.documents)
  return [
    `${count(report.breadcrumbs)} recent actions`,
    `${count(report.errors)} errors, ${count(report.console)} console lines, ${count(report.rustLog)} app log lines`,
    `${documents} open ${documents === 1 ? 'document' : 'documents'}: structure and counts only`,
    'App version, system, window and settings',
    'Speed and memory',
  ]
}

/**
 * Diagnostics — bug reports and crash reports, saved on this device and never with a
 * word of the writer's work. ARCHITECTURE.md → Diagnostics.
 *
 * `installDiagnostics()` runs once, before React mounts: from then on the page keeps a
 * trail of recent actions, the console, errors and timings (each bounded), sends the
 * trail to the native side every few seconds so a crash can still say what happened,
 * and saves a crash report for each new uncaught error. `saveBugReport` is what the
 * writer's "Report a bug…" calls. The folder and the panic hook are native
 * (inkblot-core's `diagnostics`).
 */
import { breadcrumbs, installBreadcrumbs, takeChanged } from './breadcrumbs'
import { installCapture, recordError, isNewCrash, type CapturedError } from './capture'
import { pageStarted, sendHeartbeat, writeReport } from './native'
import { installPerf } from './perf'
import { buildReport, guardNote, type Report } from './snapshot'
import { scrubHomeEverywhere } from './sanitize'

export { buildReport, describeReport, type Report } from './snapshot'
export { addCrumb } from './breadcrumbs'
export {
  deleteAllReports, expectReload, reportCounts, revealReport, takeNotices, type ReportCounts,
} from './native'

const HEARTBEAT_MS = 15_000
let installed = false

/**
 * Save a report built earlier (the dialog builds it the moment it opens, so it shows
 * the bug and not the dialog). The note is guarded like the rest of the report: a
 * writer describing a bug may quote their own text.
 */
export async function saveReport(report: Report, note?: string): Promise<string | null> {
  const text = note?.trim()
  if (!text) return writeReport(report.kind, report)
  const guarded = guardNote(text)
  return writeReport(report.kind, { ...report, note: guarded.note, redactions: report.redactions + guarded.redactions })
}

/** A bug report, now, with no dialog. Returns the saved path. */
export async function saveBugReport(note?: string): Promise<string | null> {
  return saveReport(await buildReport({ kind: 'bug' }), note)
}

/** A crash report for an error the page caught: a render crash or an uncaught error. */
export async function saveCrashReport(error: CapturedError): Promise<string | null> {
  return writeReport('js', await buildReport({ kind: 'js', error }))
}

/** A render crash from the error boundary. */
export function reportRenderCrash(error: unknown, componentStack?: string | null): void {
  const captured = recordError('render', error, componentStack?.trim().split('\n')[0] ?? null)
  if (captured && isNewCrash(captured)) {
    void saveCrashReport({ ...captured, stack: [captured.stack, componentStack].filter(Boolean).join('\n') || null })
  }
}

/** Start recording. Safe to call twice; the second call does nothing. */
export function installDiagnostics(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  installBreadcrumbs()
  installCapture((error) => { void saveCrashReport(error) })
  installPerf()
  void pageStarted()

  // Crumbs are summarized as they are recorded and carry no error messages, so the
  // trail is safe to keep on disk as it is, once home folders are out of it.
  const beat = () => {
    if (!takeChanged()) return
    const trail = JSON.parse(JSON.stringify(breadcrumbs(100)))
    scrubHomeEverywhere(trail)
    void sendHeartbeat(trail)
  }
  setInterval(beat, HEARTBEAT_MS)
  document.addEventListener('visibilitychange', beat)
}

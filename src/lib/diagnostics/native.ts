/**
 * native.ts — the diagnostics commands (src-tauri/src/diagnostics_commands.rs).
 *
 * Every call answers null when there is no native side (the `?mock` page, unit tests)
 * or it fails: reporting a problem must never become one, and must never log through
 * the console it is recording.
 */
import { invoke } from '@tauri-apps/api/core'

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T | null> {
  try {
    return ((await invoke(command, args)) as T) ?? null
  } catch {
    return null
  }
}

export interface NativeInfo {
  dir: string
  os: string
  process: unknown
  debugBuild: boolean
}

export interface ReportCounts {
  dir: string
  reports: number
  crashes: number
}

export const nativeInfo = () => call<NativeInfo>('diagnostics_info')
/** Saves a report; its path, or null. */
export const writeReport = (kind: string, report: unknown) =>
  call<string>('diagnostics_write_report', { kind, report })
export const sendHeartbeat = (breadcrumbs: unknown) => call<void>('diagnostics_heartbeat', { breadcrumbs })
export const rustLog = () => call<string[]>('diagnostics_rust_log')
/** The page-reload crash report's path, if this start followed a crash. */
export const pageStarted = () => call<string>('diagnostics_page_started')
export const expectReload = () => call<void>('diagnostics_expect_reload')
export const takeNotices = () => call<string[]>('diagnostics_take_notices')
export const reportCounts = () => call<ReportCounts>('diagnostics_counts')
export const deleteAllReports = () => call<void>('diagnostics_delete_all')
/** Show a report, or the folder when `path` is omitted, in Finder. */
export const revealReport = (path?: string | null) => call<void>('diagnostics_reveal', { path: path ?? null })

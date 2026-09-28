/**
 * The core's stats store, as the page calls it: thin wrappers over the Tauri
 * `stats_*` commands (src-tauri/src/stats_commands.rs).
 *
 * A record that fails is logged and dropped — losing a minute of stats is not
 * worth interrupting the writer for. A read that fails reads as empty.
 */
import { invoke } from '@tauri-apps/api/core'
import type { DayStat, DocWordCount, StatsTotals, TimerRun, WritingSession } from '../types/inkblot-core'

export interface StatsScope {
  project?: string | null
  docPath?: string | null
}

export const EMPTY_TOTALS: StatsTotals = {
  sessions: 0, openSecs: 0, activeSecs: 0, wordsAdded: 0, wordsDeleted: 0, wordsPasted: 0,
  longestSessionSecs: 0, daysWritten: 0,
}

function scopeArgs(scope: StatsScope) {
  return { project: scope.project ?? null, docPath: scope.docPath ?? null }
}

async function read<T>(command: string, args: Record<string, unknown>, fallback: T): Promise<T> {
  try {
    return (await invoke<T>(command, args)) ?? fallback
  } catch (error) {
    console.warn(`[stats] ${command} failed`, error)
    return fallback
  }
}

function write(command: string, args: Record<string, unknown>): Promise<void> {
  return invoke<void>(command, args).catch((error) => {
    console.warn(`[stats] ${command} failed`, error)
  })
}

export const statsService = {
  recordSession: (session: WritingSession) => write('stats_record_session', { session }),
  recordTimerRun: (run: TimerRun) => write('stats_record_timer_run', { run }),

  daily: (scope: StatsScope, fromDay: string, toDay: string) =>
    read<DayStat[]>('stats_daily', { ...scopeArgs(scope), fromDay, toDay }, []),
  totals: (scope: StatsScope) => read<StatsTotals>('stats_totals', scopeArgs(scope), EMPTY_TOTALS),
  sessions: (scope: StatsScope, fromDay?: string, toDay?: string) =>
    read<WritingSession[]>('stats_sessions', { ...scopeArgs(scope), fromDay: fromDay ?? null, toDay: toDay ?? null }, []),
  timerRuns: (project: string | null | undefined, fromDay?: string, toDay?: string) =>
    read<TimerRun[]>('stats_timer_runs', { project: project ?? null, fromDay: fromDay ?? null, toDay: toDay ?? null }, []),
  projectWordCounts: (projectName: string) => read<DocWordCount[]>('project_word_counts', { projectName }, []),

  renameEntry: (project: string, path: string, newPath: string, isFolder: boolean) =>
    write('stats_rename_entry', { project, path, newPath, isFolder }),
  moveEntry: (project: string, path: string, targetFolder: string, isFolder: boolean) =>
    write('stats_move_entry', { project, path, targetFolder, isFolder }),
  renameProject: (oldName: string, newName: string) => write('stats_rename_project', { oldName, newName }),
  reset: (scope: StatsScope) => write('stats_reset', scopeArgs(scope)),

  loadConfig: () => read<string | null>('stats_config', {}, null),
  saveConfig: (json: string) => write('stats_set_config', { json }),
}

export type StatsService = typeof statsService

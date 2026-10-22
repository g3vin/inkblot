/**
 * storyCalendarStore.js — the project's story calendar on disk.
 *
 * `<projectRoot>/.story/calendar.json`. A dot-folder, so the file tree never lists
 * it, and per project rather than per map: every map in a project reads its
 * journeys' dates off the same calendar. A `story-calendar:changed` window event
 * follows each save, so every open map re-reads it.
 */
import { exists, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { getProjectRoot, joinPath } from '../projectPaths'
import { normalizeCalendar } from './calendar'
import { OPEN_SETTINGS } from '../../stats/timerMenu.js'

export const STORY_CALENDAR_CHANGED_EVENT = 'story-calendar:changed'

const calendarPath = async (projectName) => joinPath(await getProjectRoot(projectName), '.story', 'calendar.json')

export async function loadStoryCalendar(projectName) {
  if (!projectName) return normalizeCalendar(null)
  try {
    const path = await calendarPath(projectName)
    if (!(await exists(path))) return normalizeCalendar(null)
    return normalizeCalendar(JSON.parse((await readTextFile(path)) || '{}'))
  } catch (error) {
    console.warn('[storyCalendar] could not read the calendar:', error)
    return normalizeCalendar(null)
  }
}

export async function saveStoryCalendar(projectName, calendar) {
  if (!projectName) return false
  try {
    const root = await getProjectRoot(projectName)
    await mkdir(joinPath(root, '.story'), { recursive: true })
    const next = normalizeCalendar(calendar)
    await writeTextFile(await calendarPath(projectName), JSON.stringify(next, null, 2))
    window.dispatchEvent(new CustomEvent(STORY_CALENDAR_CHANGED_EVENT, { detail: { projectName, calendar: next } }))
    return true
  } catch (error) {
    console.error('[storyCalendar] could not save the calendar:', error)
    return false
  }
}

/** Opens Settings ▸ Story on `projectName`'s calendar: where maps and timelines send you to edit it. */
export function openStoryCalendarSettings(projectName) {
  window.dispatchEvent(new CustomEvent(OPEN_SETTINGS, { detail: { pane: 'story', projectName } }))
}

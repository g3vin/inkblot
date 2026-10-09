/**
 * The timer's commands as a menu description (TimerMenuItems in TimerViews.swift):
 * the toolbar's timer menu and the menu bar's Timer menu both show these.
 */
import { allRoutines } from './config.js'
import { segmentTitle } from './routines.js'

export const OPEN_SETTINGS = 'inkblot:open-settings'

/** What the first item does now: start, pause, resume, or begin a waiting segment. */
export function primaryTimerAction(stats) {
  const timer = stats.timer
  switch (timer.state) {
    case 'running': return { text: 'Pause', action: () => timer.pause() }
    case 'paused': return { text: 'Resume', action: () => timer.resume() }
    case 'waiting': return { text: `Start ${timer.segment ? segmentTitle(timer.segment) : 'Next Segment'}`, action: () => timer.proceed() }
    default: return { text: `Start ${stats.defaultRoutine.name}`, action: () => stats.startTimer() }
  }
}

export function timerMenuItems(stats) {
  const timer = stats.timer
  return [
    primaryTimerAction(stats),
    { text: 'Skip to next segment', enabled: timer.state === 'running' || timer.state === 'paused', action: () => timer.skip() },
    { text: 'Stop', enabled: timer.isActive, action: () => timer.stop() },
    { separator: true },
    { text: 'Start routine', items: allRoutines(stats.config).map((routine) => ({ text: routine.name, action: () => stats.startTimer(routine) })) },
    { separator: true },
    { text: 'Show in stats', action: () => stats.showStats() },
    { text: 'Edit routines…', action: () => window.dispatchEvent(new CustomEvent(OPEN_SETTINGS, { detail: { pane: 'timers' } })) },
  ]
}

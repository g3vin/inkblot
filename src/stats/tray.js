/**
 * The menu bar extra (MenuBarAndRecap.swift): while the setting is on, a tray icon
 * whose title is the running segment's clock, or today's words against the goal,
 * and whose menu is the timer's.
 *
 * Titles are set only when they change; the menu is rebuilt only when the timer's
 * state does. Outside Tauri (tests, a plain browser) it does nothing.
 */
import { isTauri } from '@tauri-apps/api/core'
import { buildNativeMenu } from '../ui/useNativeMenu.js'
import { timerMenuItems } from './timerMenu.js'
import { formatNumber } from './day.js'
import { timerClock } from '../components/stats/statsText.js'

export function trayTitle(stats) {
  const timer = stats.timer
  if (timer.isActive && timer.segment) return timerClock(timer, stats.now())
  const words = stats.status.targets.find((t) => t.target.metric === 'words' || t.target.metric === 'netWords')
  if (words) return `${formatNumber(Math.floor(words.value))}/${formatNumber(words.target.amount)}${stats.status.met ? ' ✓' : ''}`
  return ''
}

export function watchTray(stats) {
  if (!isTauri()) return () => {}
  let tray = null
  let creating = null
  let title = null
  let menuKey = null
  let disposed = false

  const menuItems = () => [
    ...timerMenuItems(stats),
    { separator: true },
    { text: 'Show Inkblot', action: async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      const window = getCurrentWindow()
      await window.show()
      await window.setFocus()
    } },
  ]

  const sync = async () => {
    if (disposed) return
    const wanted = stats.config.menuBarExtra
    if (!wanted) {
      if (tray) {
        const closing = tray
        tray = null
        title = null
        menuKey = null
        await closing.close().catch(() => {})
      }
      return
    }
    if (!tray) {
      if (creating) return
      creating = (async () => {
        const [{ TrayIcon }, { defaultWindowIcon }, api] = await Promise.all([
          import('@tauri-apps/api/tray'), import('@tauri-apps/api/app'), import('@tauri-apps/api/menu'),
        ])
        const created = await TrayIcon.new({
          id: 'inkblot-stats',
          icon: (await defaultWindowIcon()) ?? undefined,
          iconAsTemplate: false,
          tooltip: 'Inkblot',
          menu: await buildNativeMenu(menuItems(), api),
          showMenuOnLeftClick: true,
        })
        if (disposed || !stats.config.menuBarExtra) { await created.close(); return }
        tray = created
      })().catch((error) => console.warn('[stats] tray failed', error)).finally(() => { creating = null })
      await creating
      if (!tray) return
    }
    const nextTitle = trayTitle(stats)
    if (nextTitle !== title) {
      title = nextTitle
      tray.setTitle(nextTitle || null).catch(() => {})
      tray.setTooltip(nextTitle ? `Inkblot — ${nextTitle}` : 'Inkblot').catch(() => {})
    }
    const key = `${stats.timer.state}|${stats.defaultRoutine.id}|${stats.config.routines.length}`
    if (key !== menuKey) {
      menuKey = key
      const api = await import('@tauri-apps/api/menu')
      tray?.setMenu(await buildNativeMenu(menuItems(), api)).catch(() => {})
    }
  }

  const unsubscribe = stats.subscribe(() => { void sync() })
  void sync()
  return () => {
    disposed = true
    unsubscribe()
    tray?.close().catch(() => {})
  }
}

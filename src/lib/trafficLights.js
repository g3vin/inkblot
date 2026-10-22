/**
 * trafficLights.js — where the macOS traffic lights sit, and whether they show.
 *
 * They keep one place, the landing page's, from launch (the shell puts them there
 * before the first frame; see src-tauri/src/window_chrome.rs) and in a project, where
 * the left sidebar's first row is centred on the same line. In a project they show
 * and hide with the left sidebar. Only the main window's are managed.
 */
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'

/**
 * The close button's left edge, and the buttons' centre line, in px from the window's
 * top-left. Matches DEFAULT_X / DEFAULT_CENTER_Y in window_chrome.rs.
 */
export const DEFAULT_TRAFFIC_LIGHTS = { x: 20, centerY: 30 }
/** macOS draws each button 12px across, 20px apart: the green one ends 52px in. */
export const TRAFFIC_LIGHT_DIAMETER = 12
export const TRAFFIC_LIGHT_SPACING = 20

const isMainWindow = () => {
  try {
    return getCurrentWindow().label === 'main'
  } catch {
    return false
  }
}

let last = null

/**
 * Show or hide the lights and centre them on a line. Repeats are skipped unless
 * `force`d: after a resize AppKit may have moved them, so they are sent again.
 */
export function placeTrafficLights({ visible = true, x = DEFAULT_TRAFFIC_LIGHTS.x, centerY = DEFAULT_TRAFFIC_LIGHTS.centerY, force = false } = {}) {
  if (!isMainWindow()) return
  const next = { visible, x: Math.round(x), centerY: Math.round(centerY) }
  if (!force && last && last.visible === next.visible && last.x === next.x && last.centerY === next.centerY) return
  last = next
  invoke('window_traffic_lights', { visible: next.visible, x: next.x, centerY: next.centerY }).catch(() => {})
}

/** The last placement asked for: where the green button is, for the layout's guesses. */
export const currentTrafficLights = () => last ?? { visible: true, ...DEFAULT_TRAFFIC_LIGHTS }

/**
 * The corner the lights take, `gap` clear around them, for anything floating over the
 * window to keep out of (hover notes): null where there are none, or while hidden.
 */
export const trafficLightsBox = (gap = 0) => {
  const isMacDesktop = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform) && !(navigator.maxTouchPoints > 1)
  const lights = currentTrafficLights()
  if (!isMacDesktop || !lights.visible) return null
  return {
    x: 0,
    y: 0,
    width: lights.x + TRAFFIC_LIGHT_SPACING * 2 + TRAFFIC_LIGHT_DIAMETER + gap,
    height: lights.centerY + TRAFFIC_LIGHT_DIAMETER / 2 + gap,
  }
}

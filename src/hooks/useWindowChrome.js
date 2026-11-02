/**
 * useWindowChrome — the custom titlebar's behaviour around the editor: the drag strip
 * that moves the window, and whether the window is (about to be) fullscreen, which
 * restyles the chrome.
 *
 * Returns `isFullscreenChrome`. Call it where EditorLayout's other window listeners
 * register: both listeners are capture-phase on `window`, and their order relative to
 * the layout's other effects is part of how a click in the strip is handled.
 */
import { useEffect, useRef, useState } from 'react'
import { currentMonitor, getCurrentWindow } from '@tauri-apps/api/window'
import { currentTrafficLights, DEFAULT_TRAFFIC_LIGHTS, TRAFFIC_LIGHT_DIAMETER, TRAFFIC_LIGHT_SPACING } from '../lib/trafficLights'

// The green (fullscreen) traffic light's box, from where the lights were last put
// (lib/trafficLights.js), padded a few px so a click near its edge still counts.
const fullscreenButtonBox = () => {
  const lights = currentTrafficLights()
  const left = lights.x + TRAFFIC_LIGHT_SPACING * 2
  return {
    visible: lights.visible,
    left: left - 4,
    right: left + TRAFFIC_LIGHT_DIAMETER + 6,
    top: lights.centerY - 14,
    bottom: lights.centerY + 14,
  }
}

// Drag strip, as in Apple's own apps: a full-width band centered on the traffic
// lights, reaching from the top of the window to as far below their centers as
// the window top is above them.
const WINDOW_DRAG_STRIP_HEIGHT = DEFAULT_TRAFFIC_LIGHTS.centerY * 2

// Elements inside the drag strip that should receive clicks instead of starting a window drag.
const WINDOW_DRAG_BLOCKER_SELECTOR = [
  'button',
  'input',
  'select',
  'textarea',
  'a',
  'label',
  '[role="button"]',
  '[contenteditable="true"]',
  '.dictation-popover',
  '.read-aloud-popover',
  '.resizer',
  // The split divider reaches up under the drag strip (the titlebar is only 44px
  // tall, the strip is 72px), so without this its top would move the window.
  '.split-resizer',
  // Owns its own drag gestures (panning, moving nodes) in the band the strip
  // overhangs below the toolbar.
  '.canvas-surface',
  '.map-surface',
].join(',')

export function useWindowChrome() {
  const [isFullscreenChrome, setIsFullscreenChrome] = useState(false)
  const fullscreenChromeRef = useRef(false)

  // Custom titlebar: a left-click anywhere in the drag strip moves the window,
  // unless it landed on something interactive. Bound to the window rather than
  // the titlebar element so the strip also covers the sidebars beneath it.
  useEffect(() => {
    const handleWindowDragMouseDown = (event) => {
      if (event.button !== 0) return
      if (event.clientY > WINDOW_DRAG_STRIP_HEIGHT) return
      if (event.target instanceof Element && event.target.closest(WINDOW_DRAG_BLOCKER_SELECTOR)) {
        return
      }

      event.preventDefault()
      getCurrentWindow().startDragging().catch(error => {
        console.warn('Failed to start window drag:', error)
      })
    }

    window.addEventListener('mousedown', handleWindowDragMouseDown, true)
    return () => window.removeEventListener('mousedown', handleWindowDragMouseDown, true)
  }, [])

  // Track (and predict) fullscreen state so the layout can restyle its chrome.
  // macOS reports fullscreen late during the animation, so we also treat
  // near-monitor-sized windows and clicks on the green traffic-light button as
  // fullscreen, then re-sync with the real state once things settle.
  useEffect(() => {
    let cancelled = false
    let unlistenResize = null
    let settleTimeout = null
    const appWindow = getCurrentWindow()

    const setFullscreenChrome = (nextFullscreen) => {
      fullscreenChromeRef.current = nextFullscreen
      setIsFullscreenChrome(nextFullscreen)
    }

    const syncFullscreen = async (event) => {
      try {
        const nextFullscreen = await appWindow.isFullscreen()
        if (cancelled) return

        if (nextFullscreen) {
          setFullscreenChrome(true)
          return
        }

        const size = event?.payload
        const monitor = size ? await currentMonitor() : null
        if (!cancelled && monitor?.size && size) {
          const nearFullscreenSize =
            size.width >= monitor.size.width * 0.94 &&
            size.height >= monitor.size.height * 0.9

          if (nearFullscreenSize) {
            setFullscreenChrome(true)
            window.clearTimeout(settleTimeout)
            settleTimeout = window.setTimeout(() => {
              void syncFullscreen()
            }, 900)
            return
          }
        }

        setFullscreenChrome(false)
      } catch {
        if (!cancelled) setFullscreenChrome(false)
      }
    }

    const handleFullscreenButtonPointerDown = (event) => {
      if (event.button !== 0) return
      const box = fullscreenButtonBox()
      if (!box.visible) return
      if (event.clientX < box.left || event.clientX > box.right) return
      if (event.clientY < box.top || event.clientY > box.bottom) return

      setFullscreenChrome(!fullscreenChromeRef.current)
      window.clearTimeout(settleTimeout)
      settleTimeout = window.setTimeout(() => {
        void syncFullscreen()
      }, 1200)
    }

    void syncFullscreen()
    window.addEventListener('pointerdown', handleFullscreenButtonPointerDown, true)
    appWindow.onResized(syncFullscreen)
      .then((unlisten) => {
        if (cancelled) {
          unlisten?.()
        } else {
          unlistenResize = unlisten
        }
      })
      .catch(() => {})

    return () => {
      cancelled = true
      window.clearTimeout(settleTimeout)
      window.removeEventListener('pointerdown', handleFullscreenButtonPointerDown, true)
      unlistenResize?.()
    }
  }, [])

  return isFullscreenChrome
}

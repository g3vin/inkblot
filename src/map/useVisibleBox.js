/**
 * useVisibleBox.js — the part of a map the shell's panels leave uncovered.
 *
 * A box in the surface's own pixels: `left`/`top` from the surface's corner, and its
 * `width`/`height`, with the surface's full size beside them. What the map draws over
 * itself is placed in this box, so under the Swift shell's glass sidebars the scale
 * bar is beside the file tree rather than behind it. Under Tauri it is the surface.
 */
import { useContext, useEffect, useState } from 'react'
import { PanelInsetsContext } from './panelInsets'

const EMPTY = { left: 0, top: 0, width: 0, height: 0, surfaceWidth: 0, surfaceHeight: 0 }

const same = (a, b) => Object.keys(EMPTY).every((key) => a[key] === b[key])

export function useVisibleBox(surfaceRef) {
  const insets = useContext(PanelInsetsContext)
  const [box, setBox] = useState(EMPTY)

  useEffect(() => {
    const element = surfaceRef.current
    if (!element) return undefined
    const measure = () => {
      const rect = element.getBoundingClientRect()
      const viewWidth = document.documentElement.clientWidth || window.innerWidth
      // The panels cover the web view's edges; clip them to this surface, which in a
      // split may be well clear of one side.
      const left = Math.max(0, insets.leading - rect.left)
      const right = Math.max(left, Math.min(rect.width, viewWidth - insets.trailing - rect.left))
      const top = Math.max(0, insets.top - rect.top)
      const next = {
        left,
        top,
        width: right - left,
        height: Math.max(0, rect.height - top),
        surfaceWidth: element.clientWidth,
        surfaceHeight: element.clientHeight,
      }
      setBox((current) => (same(current, next) ? current : next))
    }
    measure()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    observer?.observe(element)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [insets.leading, insets.top, insets.trailing, surfaceRef])

  return box
}

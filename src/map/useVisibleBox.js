/**
 * useVisibleBox.js — the box a map draws its own overlays in.
 *
 * A box in the surface's own pixels: `left`/`top` from the surface's corner, and its
 * `width`/`height`, with the surface's full size beside them. What the map draws over
 * itself — the scale bar, the compass, the title, the timeline — is placed in this box.
 * `insets` is how much of the window's edges something floating covers; none, today.
 */
import { useEffect, useState } from 'react'

const NO_INSETS = Object.freeze({ leading: 0, trailing: 0, top: 0 })

const EMPTY = { left: 0, top: 0, width: 0, height: 0, surfaceWidth: 0, surfaceHeight: 0 }

const same = (a, b) => Object.keys(EMPTY).every((key) => a[key] === b[key])

export function useVisibleBox(surfaceRef, insets = NO_INSETS) {
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

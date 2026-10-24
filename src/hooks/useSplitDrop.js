/**
 * useSplitDrop — the panes' side of a document dragged in from the file tree.
 *
 * Over the page, the side the document would take is outlined: the left or right half
 * of a single pane, or the pane under the pointer in a split. A canvas or a map takes a
 * dropped document itself (as a card, a pin), so over one only a band along the outer
 * edge splits. The tree owns the gesture and asks through lib/splitDropTarget.
 */
import { useEffect, useRef, useState } from 'react'
import { setSplitDropTarget } from '../lib/splitDropTarget'

// The band along a canvas's or map's outer edge that splits rather than drops onto it.
const SURFACE_EDGE_BAND = 160
const SURFACE_EDGE_SHARE = 0.2

export function useSplitDrop({
  enabled,
  split,
  splitOrientation,
  currentDoc,
  secondaryDoc,
  containerRef,
  secondaryPaneRef,
  onPlaceDocBeside,
  onRestorePanes,
}) {
  // { pane: 'primary' | 'secondary', side: 'start' | 'end' }, or null.
  const [outline, setOutline] = useState(null)
  // The pane a held drag opened the split into, 'primary' or 'secondary': shown dimmed
  // until the pointer lets go, so it reads as not yet done.
  const [provisional, setProvisional] = useState(null)
  const latest = useRef(null)
  useEffect(() => {
    latest.current = { enabled, split, splitOrientation, currentDoc, secondaryDoc, onPlaceDocBeside, onRestorePanes }
  })
  // What the panes showed before a held drag opened the split.
  const sprung = useRef(null)

  useEffect(() => {
    // A document goes nowhere it already is: onto itself, or into the pane showing it.
    const zoneAt = (x, y, docPath) => {
      const zone = paneZoneAt(x, y)
      if (!zone || !docPath) return null
      const { split: isSplit, currentDoc: first, secondaryDoc: second } = latest.current
      if (!isSplit) return docPath === first ? null : zone
      return docPath === (zone.side === 'end' ? second : first) ? null : zone
    }

    const paneZoneAt = (x, y) => {
      const container = containerRef.current
      if (!latest.current?.enabled || !container) return null
      const { split: isSplit, splitOrientation: orientation } = latest.current
      const el = document.elementFromPoint(x, y)
      if (!el || !container.contains(el)) return null
      const pane = el.closest('.pane')
      if (!pane || !container.contains(pane)) return null

      const rect = pane.getBoundingClientRect()
      const onSurface = Boolean(el.closest('.canvas-surface, .map-surface'))
      const band = Math.min(SURFACE_EDGE_BAND, rect.width * SURFACE_EDGE_SHARE)

      if (isSplit) {
        const side = pane === secondaryPaneRef.current ? 'end' : 'start'
        if (onSurface) {
          const rows = orientation === 'rows'
          const rowBand = Math.min(SURFACE_EDGE_BAND, rect.height * SURFACE_EDGE_SHARE)
          const nearOuterEdge = side === 'start'
            ? (rows ? y < rect.top + rowBand : x < rect.left + band)
            : (rows ? y > rect.bottom - rowBand : x > rect.right - band)
          if (!nearOuterEdge) return null
        }
        return { pane: side === 'end' ? 'secondary' : 'primary', side }
      }

      if (onSurface && x > rect.left + band && x < rect.right - band) return null
      return { pane: 'primary', side: x < rect.left + rect.width / 2 ? 'start' : 'end' }
    }

    const show = (zone) => setOutline((current) => (
      current?.pane === zone?.pane && current?.side === zone?.side ? current : zone
    ))

    return setSplitDropTarget({
      hover(x, y, docPath) {
        const zone = zoneAt(x, y, docPath)
        show(zone)
        return Boolean(zone)
      },
      spring(x, y, docPath) {
        const zone = zoneAt(x, y, docPath)
        if (!zone || sprung.current) return false
        show(null)
        sprung.current = latest.current.onPlaceDocBeside?.(docPath, zone.side) ?? null
        if (sprung.current) setProvisional(zone.side === 'end' ? 'secondary' : 'primary')
        return Boolean(sprung.current)
      },
      unspring() {
        const before = sprung.current
        sprung.current = null
        setProvisional(null)
        if (before) latest.current.onRestorePanes?.(before)
      },
      drop(x, y, docPath) {
        show(null)
        setProvisional(null)
        if (sprung.current) {
          sprung.current = null
          return true
        }
        const zone = zoneAt(x, y, docPath)
        if (!zone) return false
        latest.current.onPlaceDocBeside?.(docPath, zone.side)
        return true
      },
      clear() {
        show(null)
      },
    })
  }, [containerRef, secondaryPaneRef])

  return { outline, provisional }
}

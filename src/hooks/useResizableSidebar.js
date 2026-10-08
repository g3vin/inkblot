/**
 * useResizableSidebar.js — width/visibility state machine for the two
 * sidebars.
 *
 * States: pinned (always visible), collapsed (width 0), and peeked
 * (temporarily revealed while unpinned — triggered by hovering the window
 * edge). Dragging the resizer adjusts width within [min, max]; dragging
 * past the collapse threshold collapses the sidebar. The sidebar component
 * itself decides when a peek ends (see onAutoCollapse usage).
 */
import { useState, useCallback, useEffect, useRef } from 'react'
import { getPreference, setPreference } from '../lib/preferences'

// Matches --sidebar-floating-offset: the gap between the window edge and the
// sidebar shell, which sits between the cursor and the width being dragged.
const FLOATING_OFFSET = 8

/** Where a sidebar's width and whether it is pinned are kept: inkblot.sidebar.left / right. */
export const sidebarKey = (side) => `inkblot.sidebar.${side}`

/** The saved width and pin, within [min, max]; the defaults for anything unreadable. */
export function readSidebar(side, initial, min, max) {
  try {
    const saved = JSON.parse(getPreference(sidebarKey(side)) || 'null')
    const width = Number.isFinite(saved?.width) ? Math.min(max, Math.max(min, saved.width)) : initial
    return { width, pinned: saved?.pinned !== false }
  } catch {
    return { width: initial, pinned: true }
  }
}

export function useResizableSidebar(initial, min, max, side = 'left') {
  const [saved] = useState(() => readSidebar(side, initial, min, max))
  const [width, setWidth] = useState(saved.pinned ? saved.width : 0)
  const [resizing, setResizing] = useState(false)
  const [collapsed, setCollapsed] = useState(!saved.pinned)
  const [pinned, setPinned] = useState(saved.pinned)
  const [peeked, setPeeked] = useState(false)
  const lastWidthRef = useRef(saved.width)
  const lastClientXRef = useRef(null)
  const draggingRef = useRef(false)

  const collapse = useCallback(() => {
    setCollapsed(true)
    setPeeked(false)
    setPinned(false)
    setWidth(0)
  }, [])

  const pin = useCallback(() => {
    setPinned(true)
    setCollapsed(false)
    setPeeked(false)
    setWidth(lastWidthRef.current || min)
  }, [min])

  const unpin = useCallback(() => {
    setPinned(false)
    setCollapsed(false)
    setPeeked(true)
    setWidth(lastWidthRef.current || min)
  }, [min])

  const open = useCallback(() => {
    setCollapsed(false)
    setPeeked(false)
    setWidth(lastWidthRef.current || min)
  }, [min])

  const togglePin = useCallback(() => {
    setPinned(prev => {
      if (prev) {
        setCollapsed(false)
        setPeeked(true)
        setWidth(lastWidthRef.current || min)
        return false
      }
      setCollapsed(false)
      setPeeked(false)
      setWidth(lastWidthRef.current || min)
      return true
    })
  }, [min])

  const onMouseMove = useCallback(
    e => {
      if (!resizing) return
      lastClientXRef.current = e.clientX
      const value =
        side === 'left'
          ? e.clientX - FLOATING_OFFSET
          : window.innerWidth - e.clientX - FLOATING_OFFSET
      const collapseThreshold = 40

      if (value <= collapseThreshold) {
        lastWidthRef.current = width || lastWidthRef.current
        setResizing(false)
        collapse()
        return
      }

      if (value >= min && value <= max) {
        setWidth(value)
        lastWidthRef.current = value
        setCollapsed(false)
        setPeeked(false)
      }
    },
    [resizing, min, max, side, collapse, width]
  )

  useEffect(() => {
    const onMouseUp = () => {
      draggingRef.current = false
      setResizing(false)
    }

    const onMouseLeave = (e) => {
      if (!resizing) return
      const lastX = e?.clientX ?? lastClientXRef.current
      if (lastX == null) return

      const collapseThreshold = 40
      const shouldCollapse =
        side === 'left'
          ? lastX <= collapseThreshold || lastX <= 0
          : lastX >= window.innerWidth - collapseThreshold || lastX >= window.innerWidth

      if (shouldCollapse) {
        lastWidthRef.current = width || lastWidthRef.current
        draggingRef.current = false
        setResizing(false)
        collapse()
      }
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    window.addEventListener('mouseleave', onMouseLeave)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('mouseleave', onMouseLeave)
    }
  }, [onMouseMove, resizing, side, width, collapse])

  // Hovering within 4px of the window edge peeks a collapsed, unpinned sidebar open.
  useEffect(() => {
    const onEdgeHover = (e) => {
      if (pinned || !collapsed || draggingRef.current) return

      const nearEdge =
        side === 'left'
          ? e.clientX <= 4
          : e.clientX >= window.innerWidth - 4

      if (nearEdge) {
        setPeeked(true)
        setWidth(lastWidthRef.current || min)
      }
    }

    window.addEventListener('mousemove', onEdgeHover)
    return () => window.removeEventListener('mousemove', onEdgeHover)
  }, [collapsed, pinned, side, min])

  // Kept once a drag ends or the pin changes, not on every pixel of a drag.
  useEffect(() => {
    if (resizing) return
    const next = JSON.stringify({ width: Math.round(lastWidthRef.current || initial), pinned })
    if (getPreference(sidebarKey(side)) !== next) setPreference(sidebarKey(side), next)
  }, [resizing, pinned, side, initial, width])

  const displayWidth = collapsed && !peeked ? 0 : width

  return {
    width: displayWidth,
    resizing,
    start: () => {
      draggingRef.current = true
      setResizing(true)
    },
    collapsed,
    pinned,
    peeked,
    pin,
    unpin,
    open,
    togglePin,
    collapse,
  }
}

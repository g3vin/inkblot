/**
 * useResizableSidebar.js — width/visibility state machine for the two
 * sidebars.
 *
 * Two states, as in Arc and Dia: pinned (docked on the window's tray, pushing the
 * document card over) and hidden. While hidden a sidebar can be peeked: it hovers
 * over the card, triggered by the pointer reaching the window edge or by something
 * asking for it (`open`, a note clicked with the inspector hidden). The sidebar
 * component itself decides when a peek ends (see onAutoCollapse usage).
 *
 * Dragging the resizer adjusts width within [min, max]; pulled past either, it gives
 * as a rubber band and springs back when let go. Dragging past the collapse threshold
 * hides the sidebar.
 */
import { useState, useCallback, useEffect, useRef } from 'react'
import { getPreference, setPreference } from '../lib/preferences'
import { SPRINGS, rubberClamp, trackSample, velocityFrom } from '../ui/physics.js'
import { SpringValue } from '../ui/useSpring.js'

/** How close to its window edge a drag must come to hide the sidebar. */
const COLLAPSE_THRESHOLD = 40
/** How far past min or max the rubber band could ever stretch, in px. */
const RESIZE_GIVE = 60

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
  const [width, setWidth] = useState(saved.width)
  const [resizing, setResizing] = useState(false)
  const [pinned, setPinned] = useState(saved.pinned)
  const [peeked, setPeeked] = useState(false)
  // Pinned from hidden, it glides in as it glides out; pinned from a peek it is
  // already on screen, so it settles onto the tray at once.
  const [gliding, setGliding] = useState(false)
  // Put away for a while (focus mode): whether it was docked before, which is what stays
  // saved meanwhile, so quitting mid-way still reopens the writer's own layout.
  const [stowed, setStowed] = useState(null)
  const draggingRef = useRef(false)

  /** Hide it: unpinned and not hovering. */
  const collapse = useCallback(() => {
    setGliding(false)
    setPinned(false)
    setPeeked(false)
  }, [])

  /** Dock it on the tray. */
  const pin = useCallback(() => {
    setGliding(false)
    setPinned(true)
    setPeeked(false)
  }, [])

  /** Show it without changing the pin: a hidden sidebar hovers over the card. */
  const open = useCallback(() => {
    setPeeked(true)
  }, [])

  /** Put it away until `unstow`, keeping whether it was docked. */
  const stow = useCallback(() => {
    setStowed((current) => current ?? pinned)
    setGliding(false)
    setPinned(false)
    setPeeked(false)
  }, [pinned])

  /** Give it back as it was before `stow`: docked again, gliding in, if it was. */
  const unstow = useCallback(() => {
    if (stowed === null) return
    setStowed(null)
    if (stowed && !pinned) {
      setGliding(true)
      setPeeked(false)
      setPinned(true)
    }
  }, [stowed, pinned])

  /** The card-corner button: docked ↔ hidden. */
  const togglePin = useCallback(() => {
    setGliding(!pinned && !peeked)
    setPeeked(false)
    setPinned(!pinned)
  }, [pinned, peeked])

  useEffect(() => {
    if (!resizing) return undefined
    const samples = []
    let shown = null
    // Still resizing until the spring back has landed, so the width is kept once.
    const back = new SpringValue(0, {
      spring: SPRINGS.momentum,
      onChange: (value) => setWidth(value),
      onRest: () => setResizing(false),
    })
    const onMouseMove = (e) => {
      if (!draggingRef.current) return
      // Grabbed again mid-spring: the hand has it.
      back.stop()
      const value = side === 'left' ? e.clientX : window.innerWidth - e.clientX
      if (value <= COLLAPSE_THRESHOLD) {
        draggingRef.current = false
        setResizing(false)
        collapse()
        return
      }
      trackSample(samples, { t: performance.now(), x: value })
      shown = rubberClamp(value, min, max, RESIZE_GIVE)
      setWidth(shown)
    }
    const onMouseUp = () => {
      if (!draggingRef.current) return
      draggingRef.current = false
      const resting = shown === null ? null : Math.min(max, Math.max(min, shown))
      if (resting === null || resting === shown) {
        setResizing(false)
        return
      }
      back.jump(shown)
      // The band gave only part of the hand's speed: hand on as much.
      back.set(resting, { velocity: velocityFrom(samples).x * 0.3 })
      if (!back.moving) setResizing(false)
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      back.stop()
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [resizing, min, max, side, collapse])

  // Hovering within 4px of the window edge peeks a hidden sidebar open over the card.
  useEffect(() => {
    if (pinned || peeked) return undefined
    const onEdgeHover = (e) => {
      if (draggingRef.current) return
      const nearEdge = side === 'left' ? e.clientX <= 4 : e.clientX >= window.innerWidth - 4
      if (nearEdge) setPeeked(true)
    }
    window.addEventListener('mousemove', onEdgeHover)
    return () => window.removeEventListener('mousemove', onEdgeHover)
  }, [pinned, peeked, side])

  // Kept once a drag ends or the pin changes, not on every pixel of a drag.
  useEffect(() => {
    if (resizing) return
    const next = JSON.stringify({ width: Math.round(width || initial), pinned: stowed ?? pinned })
    if (getPreference(sidebarKey(side)) !== next) setPreference(sidebarKey(side), next)
  }, [resizing, pinned, stowed, side, initial, width])

  return {
    /** The panel's width whether docked or hovering; the layout hides it otherwise. */
    width,
    resizing,
    start: () => {
      draggingRef.current = true
      setResizing(true)
    },
    pinned,
    /** Docking from hidden: the layout lets it glide onto the tray. */
    gliding: pinned && gliding,
    /** Hovering over the card (hidden, but peeked). */
    peeked: !pinned && peeked,
    /** On screen at all: docked or hovering. */
    shown: pinned || peeked,
    collapsed: !pinned && !peeked,
    pin,
    open,
    togglePin,
    collapse,
    stow,
    unstow,
  }
}

/**
 * revealState.js — the hooks and context behind ui/Reveal.jsx: how a region knows
 * whether its content is in, whether its gate has opened, and when to admit it is
 * loading. Reveal.jsx has the components and says how the pieces fit.
 */
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { REVEAL } from './motion.js'

export const RevealGateContext = createContext(null)

/** Whether the surrounding gate has opened. With no gate there is nothing to wait for. */
export function useRevealGateOpen() {
  return useContext(RevealGateContext)?.open ?? true
}

/** Tell the surrounding gate that `key` is ready. Readiness is one-way: once open, a gate stays open. */
export function useRevealReady(key, ready) {
  const markReady = useContext(RevealGateContext)?.markReady
  useEffect(() => {
    if (ready && markReady) markReady(key)
  }, [key, markReady, ready])
}

/**
 * True once `active` has held for `delay`, and then for at least `minVisible` — the
 * rule for any loading indicator, so a fast load never flashes one and a slow one
 * never flickers.
 */
export function useDelayedFlag(active, { delay = REVEAL.delay, minVisible = REVEAL.minVisible } = {}) {
  const [visible, setVisible] = useState(false)
  const shownAt = useRef(0)

  useEffect(() => {
    if (active === visible) return undefined
    const wait = active ? delay : Math.max(0, minVisible - (performance.now() - shownAt.current))
    const timer = window.setTimeout(() => {
      if (active) shownAt.current = performance.now()
      setVisible(active)
    }, wait)
    return () => window.clearTimeout(timer)
  }, [active, visible, delay, minVisible])

  return visible
}

/**
 * The state of one region whose content loads.
 *
 * Until the region has shown real content, what is mounted underneath is a
 * placeholder (an empty editor, an empty list), so it stays hidden. Afterwards a
 * reload (another document in the same pane) leaves the old content up until the
 * skeleton is due: a quick switch is then a plain swap, never a blink.
 *
 * @param {boolean} ready whether this region's own data is in
 * @param {{ gated?: boolean }} [options] `gated: false` ignores the surrounding gate
 * @returns {{ phase: 'hidden' | 'shown' | 'static', skeleton: boolean, contentProps: object }}
 */
export function useReveal(ready, { gated = true } = {}) {
  const gateOpen = useRevealGateOpen()
  const live = Boolean(ready) && (!gated || gateOpen)
  const skeleton = useDelayedFlag(!live)

  const [everShown, setEverShown] = useState(live)
  const visible = !skeleton && (live || everShown)
  if (visible && live && !everShown) setEverShown(true)
  // Content that was ready on its first render was never hidden, so it has nothing to animate from.
  const [wasHidden, setWasHidden] = useState(!live)
  if (!visible && !wasHidden) setWasHidden(true)

  const phase = !visible ? 'hidden' : wasHidden ? 'shown' : 'static'
  return {
    phase,
    skeleton,
    // Not inert while hidden: a document that loads empty takes the caret straight
    // away, a moment before it is revealed.
    contentProps: {
      'data-reveal': phase,
      'aria-busy': live ? undefined : true,
    },
  }
}

/**
 * A reveal for something that changes in place rather than loading: `'static'` until
 * `value` first changes, then `'shown'` and `'shown-again'` by turns, each of which
 * runs the entrance afresh (a second keyframe name restarts it without a remount).
 * Spread as `data-reveal`.
 */
export function useRevealOnChange(value) {
  const [state, setState] = useState({ value, phase: 'static' })
  if (state.value !== value) setState({ value, phase: state.phase === 'shown' ? 'shown-again' : 'shown' })
  return state.phase
}

/** The style that places item `index` in a staggered entrance (`.ib-stagger`). */
export function staggerStyle(index) {
  return { '--reveal-index': Math.min(index, REVEAL.staggerCap) }
}


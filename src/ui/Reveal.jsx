/**
 * Reveal — how content arrives: a screen appears in a few deliberate stages instead
 * of a dozen independent pops, and a load that is quick never shows it was loading
 * (docs/DESIGN.md §7, "Content arriving").
 *
 *   RevealGate       holds a screen's primary pieces back until all of them are ready
 *                    (or REVEAL.gateTimeout passes), so they arrive together
 *   useRevealReady   a piece telling its gate it is ready
 *   useReveal        a region's phase: hidden, shown (animates in) or static, plus
 *                    whether its skeleton is up. The skeleton waits REVEAL.delay before
 *                    showing and then stays REVEAL.minVisible, so it never flickers
 *   SkeletonOverlay  the skeleton, laid over the region rather than in its flow, so
 *                    the content underneath keeps its place and nothing shifts
 *   Skeleton         one placeholder bar
 *
 * The hooks (useReveal, useRevealReady, useDelayedFlag, staggerStyle) are in
 * revealState.js; the timings in motion.js and the --dur-reveal tokens.
 *
 * A region's content stays mounted while hidden: an editor has to exist to be loaded,
 * and a list that keeps its layout is what makes the hand-off shift-free.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { REVEAL } from './motion.js'
import { RevealGateContext } from './revealState.js'
import './Reveal.css'

/**
 * @param {{ keys: string[], ready?: string[], resetKey?: string, timeout?: number, children: any }} props
 *   `keys` are the pieces that must report before the gate opens, from inside it
 *   (useRevealReady) or, for what its owner knows, through `ready`. `resetKey` closes
 *   it again for a new screen (another project) without remounting what it wraps.
 */
export function RevealGate({ keys, ready = [], resetKey = '', timeout = REVEAL.gateTimeout, children }) {
  const [state, setState] = useState(() => ({ resetKey, ready: new Set(), timedOut: false }))
  if (state.resetKey !== resetKey) setState({ resetKey, ready: new Set(), timedOut: false })

  const markReady = useCallback((key) => {
    setState((prev) => (prev.ready.has(key) ? prev : { ...prev, ready: new Set(prev.ready).add(key) }))
  }, [])

  const allReady = keys.every((key) => state.ready.has(key) || ready.includes(key))
  const open = allReady || state.timedOut

  useEffect(() => {
    if (open) return undefined
    const timer = window.setTimeout(() => {
      setState((prev) => (prev.resetKey === resetKey ? { ...prev, timedOut: true } : prev))
    }, timeout)
    return () => window.clearTimeout(timer)
  }, [open, resetKey, timeout])

  const value = useMemo(() => ({ open, markReady }), [open, markReady])
  return <RevealGateContext.Provider value={value}>{children}</RevealGateContext.Provider>
}

/**
 * One placeholder bar, sized like what it stands in for.
 * @param {{ width?: string | number, height?: string | number, radius?: 'sm' | 'pill', className?: string }} props
 */
export function Skeleton({ width = '100%', height = '0.8em', radius = 'sm', className = '' }) {
  return (
    <span
      className={`ib-skeleton ib-skeleton--${radius} ${className}`.trim()}
      style={{ width, height }}
      aria-hidden="true"
    />
  )
}

/**
 * The skeleton for a region, over it rather than in its flow. Fades in and out;
 * screen readers hear `label` while it is up.
 * @param {{ visible: boolean, label?: string, className?: string, children: any }} props
 */
export function SkeletonOverlay({ visible, label = 'Loading', className = '', children }) {
  return (
    <div className={`ib-skeleton-host ib-skeleton-overlay ${className}`.trim()} data-visible={visible ? 'true' : 'false'} aria-hidden={visible ? undefined : true}>
      {visible ? <span className="ib-visually-hidden" role="status">{label}</span> : null}
      {children}
    </div>
  )
}

/** Rows of bars in the rhythm of a list: `count` rows of `--row-h`, widths varied so it reads as text. */
export function SkeletonRows({ count = 6, widths = ['72%', '54%', '64%', '46%', '58%', '40%'], height = '0.75em', className = '' }) {
  return (
    <div className={`ib-skeleton-rows ${className}`.trim()}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="ib-skeleton-row">
          <Skeleton width={widths[index % widths.length]} height={height} />
        </div>
      ))}
    </div>
  )
}

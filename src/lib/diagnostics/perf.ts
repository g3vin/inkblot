/**
 * perf.ts — how responsive the page has been, cheaply enough to leave on.
 *
 * - Event-loop lag: a timer every half second, measuring how late it fires. Long
 *   tasks, garbage collection and layout storms all show up as lateness.
 * - Input latency: from a keystroke in the editor to the frame after it, which is
 *   roughly when the letter appears.
 *
 * No animation-frame loop: one running all session would cost the battery it is
 * trying to measure. Both samplers stop while the window is hidden.
 */
import { Ring } from './ring'

const TICK_MS = 500
const lag = new Ring<number>(240)
const input = new Ring<number>(200)
let worstLag = { ms: 0, at: 0 }

function percentiles(samples: number[]) {
  if (!samples.length) return null
  const sorted = [...samples].sort((a, b) => a - b)
  const at = (p: number) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))])
  return { samples: sorted.length, p50: at(0.5), p95: at(0.95), max: Math.round(sorted[sorted.length - 1]) }
}

export function perfSnapshot() {
  const memory = (performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory
  return {
    uptimeSeconds: Math.round(performance.now() / 1000),
    eventLoopLagMs: percentiles(lag.toArray()),
    worstLag: worstLag.ms ? { ms: Math.round(worstLag.ms), at: new Date(worstLag.at).toISOString() } : null,
    inputLatencyMs: percentiles(input.toArray()),
    jsHeap: memory ? { used: memory.usedJSHeapSize, total: memory.totalJSHeapSize } : null,
    domNodes: document.getElementsByTagName('*').length,
  }
}

/** Start sampling. Returns a function that stops. */
export function installPerf(): () => void {
  let expected = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  const tick = () => {
    const now = performance.now()
    if (expected) {
      const late = Math.max(0, now - expected)
      lag.push(late)
      if (late > worstLag.ms) worstLag = { ms: late, at: Date.now() }
    }
    expected = now + TICK_MS
    timer = setTimeout(tick, TICK_MS)
  }
  const start = () => { if (!timer) { expected = 0; tick() } }
  const stop = () => { if (timer) clearTimeout(timer); timer = null }
  const onVisibility = () => (document.hidden ? stop() : start())

  const onKeyDown = (event: KeyboardEvent) => {
    if (!(event.target instanceof Element) || !event.target.closest('.ProseMirror')) return
    const down = event.timeStamp || performance.now()
    requestAnimationFrame(() => setTimeout(() => input.push(performance.now() - down), 0))
  }

  if (!document.hidden) start()
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('keydown', onKeyDown, true)
  return () => {
    stop()
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('keydown', onKeyDown, true)
  }
}

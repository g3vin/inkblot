/**
 * wheelPhase.js — telling a trackpad gesture's own movement from the momentum after it.
 *
 * WebKit exposes a wheel event's gesture phase as a bitmask (webkitPhase), and the
 * momentum that carries on after the fingers lift as another (webkitMomentumPhase).
 * The inspector's swipe and the bubble editor's form swipe both need to know which is
 * which: a swipe turns one page, however far its momentum would carry it.
 *
 * WKWebView, though, gives the page neither: its wheel events carry no phase at all.
 * In the app the phases come from AppKit instead (src-tauri/src/trackpad.rs), as a
 * `trackpad-phase` event when the fingers go down, lift, and the coast begins. Where
 * neither source exists (a browser), there is nothing to know and callers fall back
 * on timing.
 */
import { listen } from '@tauri-apps/api/event'

export const WHEEL_PHASE_BEGAN = 1
export const WHEEL_PHASE_STATIONARY = 2
export const WHEEL_PHASE_CHANGED = 4
export const WHEEL_PHASE_ENDED = 8
export const WHEEL_PHASE_CANCELLED = 16
export const WHEEL_PHASE_MAY_BEGIN = 32

export const hasWheelPhase = (phase, flag) => Number.isFinite(phase) && (phase & flag) === flag

export const hasActiveWheelPhase = (phase) => (
  hasWheelPhase(phase, WHEEL_PHASE_BEGAN)
  || hasWheelPhase(phase, WHEEL_PHASE_STATIONARY)
  || hasWheelPhase(phase, WHEEL_PHASE_CHANGED)
  || hasWheelPhase(phase, WHEEL_PHASE_MAY_BEGIN)
)

export const hasMomentumPhase = (phase) => Number.isFinite(phase) && phase !== 0

export const hasEndedWheelPhase = (phase) => (
  hasWheelPhase(phase, WHEEL_PHASE_ENDED)
  || hasWheelPhase(phase, WHEEL_PHASE_CANCELLED)
)

/** A wheel event's phases, whichever name the engine gives them. */
export const wheelPhases = (event) => ({
  phase: event.webkitPhase ?? event.phase,
  momentum: event.webkitMomentumPhase ?? event.momentumPhase,
})

/* ---- the trackpad's phases, from AppKit ---- */

/** 'touching' (fingers down), 'coasting' (momentum after a lift) or 'idle'. */
let trackpadState = 'idle'
let trackpadKnown = false
const phaseListeners = new Set()

const onNativePhase = (name) => {
  trackpadKnown = true
  if (name === 'began') trackpadState = 'touching'
  else if (name === 'momentum') trackpadState = 'coasting'
  else if (name === 'ended') trackpadState = 'idle'
  phaseListeners.forEach((listener) => listener(name))
}

let listening = false
const listenForPhases = () => {
  if (listening) return
  listening = true
  try {
    // Outside the app there is no one to listen to; that is not an error.
    Promise.resolve(listen('trackpad-phase', (event) => onNativePhase(event.payload))).catch(() => {})
  } catch {
    // Not in the app.
  }
}

/**
 * Hear the fingers go down (`'began'`), lift (`'ended'`) and the coast begin
 * (`'momentum'`). Returns the unsubscribe. Silent outside the app.
 */
export const onTrackpadPhase = (listener) => {
  listenForPhases()
  phaseListeners.add(listener)
  return () => { phaseListeners.delete(listener) }
}

/** Whether the app has reported a phase yet — i.e. a lift will be heard, not guessed. */
export const knowsTrackpadPhases = () => trackpadKnown

/** For tests: what the app would say. */
export const simulateTrackpadPhase = onNativePhase

/** Momentum after the fingers lifted, rather than the fingers themselves. */
export const isMomentumWheel = (event) => {
  listenForPhases()
  const { phase, momentum } = wheelPhases(event)
  if (Number.isFinite(phase) || Number.isFinite(momentum)) {
    return hasMomentumPhase(momentum) && !hasActiveWheelPhase(phase)
  }
  return trackpadState === 'coasting'
}

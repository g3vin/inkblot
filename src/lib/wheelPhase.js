/**
 * wheelPhase.js — telling a trackpad gesture's own movement from the momentum after it.
 *
 * WebKit exposes a wheel event's gesture phase as a bitmask (webkitPhase), and the
 * momentum that carries on after the fingers lift as another (webkitMomentumPhase).
 * The inspector's swipe and the bubble editor's form swipe both need to know which is
 * which: a swipe turns one page, however far its momentum would carry it.
 */

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

/** Momentum after the fingers lifted, rather than the fingers themselves. */
export const isMomentumWheel = (event) => {
  const { phase, momentum } = wheelPhases(event)
  return hasMomentumPhase(momentum) && !hasActiveWheelPhase(phase)
}

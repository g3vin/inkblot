/**
 * haptics.js — trackpad feedback.
 *
 * WKWebView exposes no haptics API, so this goes through the `perform_haptic`
 * Rust command into AppKit's NSHapticFeedbackManager. Feedback is a garnish: if
 * the command is unavailable (running in a browser, another platform, a Mac with
 * no Force Touch trackpad, or a user who turned it off), every call here is a
 * silent no-op and nothing upstream needs to care.
 */
import { invoke } from '@tauri-apps/api/core'

/** The light tick AppKit uses when a drag snaps to a guide. */
export const HAPTIC_ALIGNMENT = 'alignment'
/** The heavier one, for a change that actually committed. */
export const HAPTIC_LEVEL = 'level'
/** AppKit's generic tap, unlike either: for backing out of a change not yet made. */
export const HAPTIC_GENERIC = 'generic'

/**
 * Two taps closer together than this are felt as one, so firing them only spends
 * IPC. A fast flick across the panels can otherwise queue a dozen in a few frames.
 */
const MIN_INTERVAL_MS = 40

let lastFiredAt = 0
let disabled = false

export const performHaptic = (pattern = HAPTIC_ALIGNMENT) => {
  if (disabled) return

  const now = performance.now()

  // The landing tap is the one that matters and happens at most once per gesture,
  // so it skips the throttle. Without this a swipe that crosses a panel and
  // commits in the same breath would have its landing swallowed by the crossing
  // tick that came a few milliseconds earlier.
  if (pattern !== HAPTIC_LEVEL && now - lastFiredAt < MIN_INTERVAL_MS) return
  lastFiredAt = now

  // Fire-and-forget: a haptic that arrives late is worse than one that never
  // arrives, so nothing waits on this and a failure just switches it off.
  invoke('perform_haptic', { pattern }).catch(() => {
    disabled = true
  })
}

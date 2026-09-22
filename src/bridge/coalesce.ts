/**
 * coalesce.ts — sending the latest answer once, instead of every answer immediately.
 *
 * **Sharp edge #4 lives here.** `useEditorNotes` remaps note anchors on every
 * transaction — every keystroke in a document that has quote notes — and native is
 * holding those positions. `Toolbar` has the same shape: `selectionUpdate` fires on
 * every cursor move. Neither can be sent per occurrence without saturating the bridge
 * with messages that are obsolete before they arrive.
 *
 * **Why coalescing is safe here and would not be in general.** Every event this is used
 * for carries its *whole* current state rather than a delta. Dropping an intermediate
 * value therefore loses nothing: the next one is complete. A delta stream coalesced the
 * same way would silently corrupt, and that is the property to check before reaching
 * for this — see the note on `NotesRemapped`.
 *
 * `Toolbar.jsx` already does exactly this with a bare `requestAnimationFrame` and a
 * ref. This is that, made reusable and made cancellable, because a pending frame that
 * fires after the editor is gone is the teardown bug the suites exist to catch.
 */

export type Scheduler = (callback: () => void) => () => void

/**
 * Run on the next animation frame, falling back to a timeout.
 *
 * The fallback is not only for Node: `requestAnimationFrame` does not fire in a
 * background tab or a hidden window, and an editor that is not on screen still remaps
 * note anchors when a document loads. Silence there would mean the shell's notes stay
 * stale until the window is looked at again.
 */
export const frameScheduler: Scheduler = (callback) => {
  if (typeof requestAnimationFrame === 'function') {
    const handle = requestAnimationFrame(() => callback())
    return () => cancelAnimationFrame(handle)
  }
  const handle = setTimeout(callback, 0)
  return () => clearTimeout(handle)
}

/** Runs immediately. For tests that want to assert without waiting on a frame. */
export const immediateScheduler: Scheduler = (callback) => {
  callback()
  return () => {}
}

export interface Coalescer<T> {
  /** Replace whatever is pending and make sure something is scheduled. */
  push(value: T): void
  /** Send the pending value now, if there is one. */
  flush(): void
  /** Throw the pending value away. Nothing is sent. */
  cancel(): void
  pending(): boolean
}

/**
 * Hold the latest value and deliver it once per scheduled turn.
 *
 * `flush` exists for the case that actually bites: an editor unmounting with a remap
 * still pending. The choices are to send it or to drop it, and for whole-state events
 * sending it is right — the shell's copy would otherwise stay wrong until something
 * else happened to change it. `cancel` is for the other case, where the thing the value
 * is about is going away too.
 */
export function createCoalescer<T>(
  deliver: (value: T) => void,
  schedule: Scheduler = frameScheduler
): Coalescer<T> {
  let latest: { value: T } | null = null
  let scheduled = false
  let cancelScheduled: (() => void) | null = null

  const send = () => {
    scheduled = false
    cancelScheduled = null
    const held = latest
    latest = null
    if (held) deliver(held.value)
  }

  return {
    push(value) {
      latest = { value }
      // Already scheduled: the new value simply replaces the old one in the same slot.
      if (scheduled) return
      scheduled = true
      const cancel = schedule(send)
      // A scheduler is allowed to run its callback synchronously, and
      // `immediateScheduler` does. In that case `send` has already run and cleared the
      // flag by the time `schedule` returns, and keeping its canceller would leave a
      // stale one behind — which then swallows every later push, because the guard
      // above would see work outstanding that has in fact already been delivered.
      if (scheduled) cancelScheduled = cancel
    },

    flush() {
      if (!latest) return
      cancelScheduled?.()
      send()
    },

    cancel() {
      cancelScheduled?.()
      cancelScheduled = null
      scheduled = false
      latest = null
    },

    pending: () => latest !== null,
  }
}

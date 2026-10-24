/**
 * transport.ts — how the shell and surface ends are wired together.
 *
 * The protocol says what is said; a transport says how it gets there. Both ends are in
 * one JavaScript heap (`createInProcessTransports()`), talking through function calls:
 * the chrome (toolbar, sidebars, menus) on one end and the document surface on the
 * other. A native shell — an iOS app's Swift plugin, say — would be another transport
 * under the same two ends; nothing above this file would change.
 *
 * **Messages are copied, not shared.** The in-process transport round-trips every
 * message through JSON, which is slower than passing the object and is the point: a
 * handler that mutates what it was given, or a payload holding something unserializable
 * like a live `EditorView`, fails here, under test, rather than only across a real
 * process boundary.
 */
import type { InboundMessage, OutboundMessage } from '../types'

/** The shell's end of the wire: it posts commands and requests, and hears events and replies. */
export interface ShellTransport {
  post(message: InboundMessage): void
  receive(handler: (message: OutboundMessage) => void): () => void
}

/** The document surface's end: it posts events and replies, and hears commands and requests. */
export interface SurfaceTransport {
  post(message: OutboundMessage): void
  receive(handler: (message: InboundMessage) => void): () => void
}

export interface InProcessTransports {
  shell: ShellTransport
  surface: SurfaceTransport
  /** Drop every subscription. Both ends go silent; posting afterwards is a no-op. */
  dispose(): void
}

/**
 * Why this throws rather than warns.
 *
 * A message that will not serialize is not a slow path, it is a message no other
 * process could ever receive. Warning would let it pass in development and fail in a
 * build nobody is watching.
 */
const copy = <T>(message: T): T => {
  try {
    return JSON.parse(JSON.stringify(message)) as T
  } catch (error) {
    throw new TypeError(
      `Bridge message is not serializable — it cannot cross a process boundary: ${String(error)}`,
      { cause: error }
    )
  }
}

type Listener<T> = (message: T) => void

/** One direction of the wire. */
class Channel<T> {
  private listeners = new Set<Listener<T>>()
  private closed = false

  post(message: T): void {
    if (this.closed) return
    const delivered = copy(message)
    // Copied before iterating: a handler that subscribes or unsubscribes while being
    // called must not change who else hears this message.
    for (const listener of [...this.listeners]) listener(delivered)
  }

  receive(handler: Listener<T>): () => void {
    if (this.closed) return () => {}
    this.listeners.add(handler)
    return () => { this.listeners.delete(handler) }
  }

  close(): void {
    this.closed = true
    this.listeners.clear()
  }
}

/**
 * A linked pair of transports in one process — the reference implementation.
 *
 * Delivery is synchronous. That is deliberate for the tests (an assertion right after
 * a `send` sees the result), and it is also why the suite runs through a deferred pair
 * as well: a real process boundary is asynchronous, so anything that only works
 * because delivery was synchronous is a bug this transport would be *hiding*. The bridge client is written not to
 * need it, and `tests/unit/bridge.mjs` runs the same suite through a
 * deferred transport to prove it.
 */
export function createInProcessTransports(): InProcessTransports {
  const toSurface = new Channel<InboundMessage>()
  const toShell = new Channel<OutboundMessage>()

  return {
    shell: {
      post: (message) => toSurface.post(message),
      receive: (handler) => toShell.receive(handler),
    },
    surface: {
      post: (message) => toShell.post(message),
      receive: (handler) => toSurface.receive(handler),
    },
    dispose: () => {
      toSurface.close()
      toShell.close()
    },
  }
}

/**
 * The same pair, but delivering on a later turn of the event loop.
 *
 * This is what a real bridge does, and it is what the suite uses to prove the client
 * never relies on a reply having already arrived. `flush` is how a test waits for the
 * queue to drain without racing it.
 */
export function createDeferredTransports(): InProcessTransports & { flush(): Promise<void> } {
  const direct = createInProcessTransports()
  const pending: Array<() => void> = []
  const queue = (run: () => void) => { pending.push(run) }

  return {
    shell: {
      post: (message) => queue(() => direct.shell.post(message)),
      receive: (handler) => direct.shell.receive(handler),
    },
    surface: {
      post: (message) => queue(() => direct.surface.post(message)),
      receive: (handler) => direct.surface.receive(handler),
    },
    dispose: () => {
      pending.length = 0
      direct.dispose()
    },
    // Drains until quiet: delivering one message usually posts the next.
    flush: async () => {
      for (let guard = 0; guard < 1000 && pending.length; guard += 1) {
        const batch = pending.splice(0, pending.length)
        for (const run of batch) run()
        await Promise.resolve()
      }
    },
  }
}

/**
 * transport.ts — how the shell and surface ends are wired together.
 *
 * The protocol says what is said; a transport says how it gets there. It is the only
 * part of the bridge that differs between hosts:
 *
 *   - `createInProcessTransports()` — both ends in one JavaScript heap, talking through
 *     function calls. The Tauri app and the test harness.
 *   - `createNativeHostTransports()` — the Swift shell, reached through the
 *     `window.__inkblotNative` object its injected `native-host.js` provides, merged
 *     onto the in-process pair (see below).
 *
 * Nothing above this file knows which, so the test suites exercise the same client and
 * surface code the Swift shell talks to.
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
 * A message that will not serialize is not a slow path, it is a message the Swift
 * shell will never receive. Warning would let it pass in development and fail in a
 * build nobody is watching.
 */
const copy = <T>(message: T): T => {
  try {
    return JSON.parse(JSON.stringify(message)) as T
  } catch (error) {
    throw new TypeError(
      `Bridge message is not serializable — it cannot cross a process boundary: ${String(error)}`
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
 * a `send` sees the result) and it is also the honest default: `WKWebView`'s message
 * handlers are asynchronous, so anything that only works because delivery was
 * synchronous is a bug this transport is *hiding*. The bridge client is written not to
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

/* ---------------- the native shell ---------------- */

/**
 * What the Swift shell installs on `window` before any page script runs.
 *
 * Messages cross as JSON *strings* in both directions rather than as objects.
 * `WKScriptMessage.body` would happily carry an object, but it would carry it as
 * `NSDictionary`/`NSNumber`, and `Codable` decodes JSON — so a string is the one form
 * both ends read with the decoder they already have, with no bridging layer in between
 * to disagree about whether `1.0` is an integer.
 *
 * `listen` drains a queue. The shell may deliver before the module graph has
 * evaluated this file — it sends as soon as the navigation commits — and a message
 * delivered to nobody is a command the user issued and saw nothing happen for.
 */
export interface NativeHost {
  /** The parts of the chrome the shell draws itself. See `lib/host.ts`. */
  readonly chrome?: readonly string[]
  post(json: string): void
  listen(handler: (json: string) => void): () => void
}

declare global {
  interface Window {
    __inkblotNative?: NativeHost
  }
}

/** The shell, if this page is running inside one. */
export function detectNativeHost(): NativeHost | null {
  if (typeof window === 'undefined') return null
  const host = window.__inkblotNative
  return host && typeof host.post === 'function' && typeof host.listen === 'function'
    ? host
    : null
}

const NATIVE_REQUEST_PREFIX = 'native:'

/**
 * Two shells, one surface: the React chrome in this process, and the Swift shell.
 *
 * Some chrome is native in the Swift shell (file tree, inspector, toolbar) and some is
 * still the page's (context menus, dialogs), and both drive the same document. So this
 * is not a replacement for the in-process pair but a third party on it:
 *
 *   - **Events go to both.** They are one stream from one surface, so both shells see
 *     the same sequence numbers and neither sees a gap.
 *   - **Commands from both are merged into one stream** and re-sequenced on the way
 *     in. The surface's gap check is about *this* wire; each shell numbers its own
 *     commands from zero, and passing both through untouched would report a gap on
 *     every interleaving. The native stream's own numbering is checked here instead.
 *   - **Replies go back to whoever asked.** The native shell's request ids are
 *     prefixed on the way in and stripped on the way out, so its `r0` and the React
 *     toolbar's `r0` cannot answer each other's questions.
 */
export function createNativeHostTransports(
  host: NativeHost,
  options: { onGap?: (message: string) => void; onMalformed?: (message: string) => void } = {}
): InProcessTransports {
  const onGap = options.onGap ?? ((message: string) => { console.error(message) })
  const onMalformed = options.onMalformed ?? ((message: string) => { console.error(message) })
  const local = createInProcessTransports()

  const surfaceListeners = new Set<Listener<InboundMessage>>()
  let surfaceSeq = 0
  let expectedNativeSeq = 0
  let closed = false

  const toSurface = (message: InboundMessage) => {
    if (closed) return
    const delivered = message.kind === 'command'
      ? { kind: 'command' as const, message: { ...message.message, seq: surfaceSeq++ } }
      : message
    const copied = copy(delivered)
    for (const listener of [...surfaceListeners]) listener(copied)
  }

  // The in-process shell posts into `local`; its surface end is re-routed through here.
  const unsubscribeLocal = local.surface.receive(toSurface)

  const unsubscribeNative = host.listen((json) => {
    let message: InboundMessage
    try {
      message = JSON.parse(json) as InboundMessage
    } catch (error) {
      onMalformed(`Native shell sent a message that is not JSON: ${String(error)}`)
      return
    }

    if (message?.kind === 'command') {
      const { seq } = message.message
      if (seq !== expectedNativeSeq) {
        onGap(`Bridge dropped ${seq - expectedNativeSeq} native command(s): expected seq ${expectedNativeSeq}, got ${seq}.`)
      }
      expectedNativeSeq = Math.max(expectedNativeSeq, seq) + 1
      toSurface(message)
      return
    }

    if (message?.kind === 'request') {
      toSurface({
        kind: 'request',
        message: { ...message.message, id: `${NATIVE_REQUEST_PREFIX}${message.message.id}` },
      })
      return
    }

    onMalformed(`Native shell sent a message of unknown kind: ${json.slice(0, 200)}`)
  })

  const fromSurface = (message: OutboundMessage) => {
    if (closed) return
    if (message.kind === 'reply') {
      const { id } = message.message
      if (id.startsWith(NATIVE_REQUEST_PREFIX)) {
        const reply = { ...message, message: { ...message.message, id: id.slice(NATIVE_REQUEST_PREFIX.length) } }
        host.post(JSON.stringify(reply))
      } else {
        local.surface.post(message)
      }
      return
    }
    // Serialized once, before either shell can see it: an unserializable payload
    // throws here, in the webview, where the stack still says who sent it.
    const json = JSON.stringify(message)
    local.surface.post(message)
    host.post(json)
  }

  return {
    shell: local.shell,
    surface: {
      post: fromSurface,
      receive: (handler) => {
        if (closed) return () => {}
        surfaceListeners.add(handler)
        return () => { surfaceListeners.delete(handler) }
      },
    },
    dispose: () => {
      closed = true
      surfaceListeners.clear()
      unsubscribeLocal()
      unsubscribeNative()
      local.dispose()
    },
  }
}

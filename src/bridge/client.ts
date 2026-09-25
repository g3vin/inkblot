/**
 * client.ts — the two typed ends of the bridge.
 *
 * `createShellBridge` is what the shell holds: it sends commands, asks questions, and
 * subscribes to events. `createSurfaceBridge` is what the document surface holds: it
 * handles commands, answers questions, and emits events.
 *
 * Both are typed against the generated protocol, and the typing is the point of the
 * file. `onCommand('setColor', handler)` gives `handler` a `SetColorCommand` and
 * nothing else; `send('setColor', { ... })` will not compile with a
 * `SetFontSizeCommand`'s fields. The bridge is the one place where a wrong shape would
 * otherwise be invisible until it reached a language that cannot see this file.
 */
import { BridgeErrorCode } from '../types'
import type {
  BridgeReply,
  BridgeRequest,
  InboundMessage,
  NativeCommand,
  OutboundMessage,
  WebviewEvent,
} from '../types'
import type { ShellTransport, SurfaceTransport } from './transport'

/* ---------------- deriving the per-message types from the unions ---------------- */

/** `'setColor' | 'setHighlight' | …` */
export type CommandType = NativeCommand['type']
export type EventType = WebviewEvent['type']
export type RequestType = BridgeRequest['type']
export type ReplyType = BridgeReply['type']

/** The payload that goes with one command name. */
export type CommandPayload<T extends CommandType> =
  Extract<NativeCommand, { type: T }>['payload']
export type EventPayload<T extends EventType> =
  Extract<WebviewEvent, { type: T }>['payload']
export type RequestPayload<T extends RequestType> =
  Extract<BridgeRequest, { type: T }>['payload']
export type ReplyPayload<T extends ReplyType> =
  Extract<BridgeReply, { type: T }>['payload']

/**
 * Which reply answers which request.
 *
 * Written out rather than derived because the correspondence is a decision, not a
 * naming convention: `getReadAloudPayload` is answered by `readAloudPayload`, and
 * nothing in the names says so. Spelling it out is what lets `request()` return the
 * right type instead of the whole `BridgeReply` union.
 */
export interface RequestReplyMap {
  getSelectionContext: 'selectionContext'
  getToolbarState: 'toolbarState'
  getReadAloudPayload: 'readAloudPayload'
  getDocumentText: 'documentText'
}

/** What a successful request resolves to. */
export type ReplyFor<T extends RequestType> = ReplyPayload<RequestReplyMap[T]>

export type Unsubscribe = () => void

/**
 * A request was answered with an error, or not answered at all.
 *
 * Its own class because the commonest cause is entirely ordinary — the user closed the
 * pane between the right-click and the menu being built — and a caller should be able
 * to tell that apart from a bug without parsing a message string.
 */
export class BridgeRequestError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'BridgeRequestError'
    this.code = code
  }
}

/**
 * How long to wait for an answer before giving up.
 *
 * There is a timeout at all because a shell blocked forever on a reply is a hang with
 * no symptom, and the surface can genuinely fail to answer — a webview that navigated,
 * a handler that threw past its own catch. Generous, because the only thing on the
 * other side is a synchronous read of a ProseMirror document: anything approaching
 * this number is a fault, not a slow machine.
 */
export const REQUEST_TIMEOUT_MS = 5000

/* ---------------- sequence checking ---------------- */

/**
 * Notices a gap in the stream.
 *
 * `seq` is not used for ordering — every transport this protocol targets delivers in
 * order — it is used for *noticing*. A bridge that silently drops a `setContent` loses
 * the user's document, and the only evidence would be that it did not happen.
 */
const createSequenceCheck = (label: string, onGap: (message: string) => void) => {
  let expected = 0
  return (seq: number) => {
    if (seq !== expected) {
      onGap(`Bridge dropped ${seq - expected} ${label} message(s): expected seq ${expected}, got ${seq}.`)
    }
    expected = Math.max(expected, seq) + 1
  }
}

const defaultOnGap = (message: string) => { console.error(message) }

export interface BridgeOptions {
  /** Called when the sequence has a hole in it. Tests make this throw. */
  onGap?: (message: string) => void
}

/* ---------------- the shell's end ---------------- */

export interface ShellBridge {
  /** Tell the document surface to do something. Fire and forget. */
  send<T extends CommandType>(type: T, payload: CommandPayload<T>): void
  /** Ask the document surface something only a live document can answer. */
  request<T extends RequestType>(type: T, payload: RequestPayload<T>): Promise<ReplyFor<T>>
  /** Subscribe to one kind of event. */
  on<T extends EventType>(type: T, handler: (payload: EventPayload<T>) => void): Unsubscribe
  /** Subscribe to every event, for logging and for the tests. */
  onAny(handler: (event: WebviewEvent) => void): Unsubscribe
  dispose(): void
}

export function createShellBridge(
  transport: ShellTransport,
  options: BridgeOptions = {}
): ShellBridge {
  const onGap = options.onGap ?? defaultOnGap
  const checkSequence = createSequenceCheck('event', onGap)
  const handlers = new Map<EventType, Set<(payload: never) => void>>()
  const anyHandlers = new Set<(event: WebviewEvent) => void>()
  const pending = new Map<string, {
    resolve: (value: never) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>()

  let seq = 0
  let nextRequestId = 0
  let disposed = false

  const settle = (id: string) => {
    const entry = pending.get(id)
    if (!entry) return null
    clearTimeout(entry.timer)
    pending.delete(id)
    return entry
  }

  const unsubscribe = transport.receive((message: OutboundMessage) => {
    if (message.kind === 'reply') {
      const entry = settle(message.message.id)
      if (!entry) return
      const reply = message.message.reply
      if (reply.type === 'error') {
        entry.reject(new BridgeRequestError(reply.payload.code, reply.payload.message))
        return
      }
      entry.resolve(reply.payload as never)
      return
    }

    checkSequence(message.message.seq)
    const event = message.message.event
    for (const handler of [...anyHandlers]) handler(event)
    const set = handlers.get(event.type)
    if (!set) return
    for (const handler of [...set]) handler(event.payload as never)
  })

  return {
    send(type, payload) {
      if (disposed) return
      transport.post({
        kind: 'command',
        message: { seq: seq++, command: { type, payload } as NativeCommand },
      } as InboundMessage)
    },

    request(type, payload) {
      type Resolved = ReplyFor<typeof type>
      if (disposed) {
        return Promise.reject(new BridgeRequestError('failed', 'The bridge is disposed.'))
      }

      const id = `r${nextRequestId++}`
      const answer = new Promise<Resolved>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new BridgeRequestError(
            'failed',
            `The document surface did not answer ${type} within ${REQUEST_TIMEOUT_MS}ms.`
          ))
        }, REQUEST_TIMEOUT_MS)
        pending.set(id, {
          resolve: resolve as (value: never) => void,
          reject,
          timer,
        })
      })

      transport.post({
        kind: 'request',
        message: { id, request: { type, payload } as BridgeRequest },
      } as InboundMessage)

      return answer
    },

    on(type, handler) {
      const set = handlers.get(type) ?? new Set()
      handlers.set(type, set)
      set.add(handler as (payload: never) => void)
      return () => { set.delete(handler as (payload: never) => void) }
    },

    onAny(handler) {
      anyHandlers.add(handler)
      return () => { anyHandlers.delete(handler) }
    },

    dispose() {
      disposed = true
      unsubscribe()
      // Reject rather than leave them hanging: a caller awaiting an answer from a
      // bridge that has gone away should find out, not wait out the timeout.
      for (const id of [...pending.keys()]) {
        settle(id)?.reject(new BridgeRequestError('failed', 'The bridge was disposed.'))
      }
      handlers.clear()
      anyHandlers.clear()
    },
  }
}

/* ---------------- the document surface's end ---------------- */

/** Answers a request. Returning nothing is the same as saying "no editor". */
export type RequestHandler<T extends RequestType> =
  (payload: RequestPayload<T>) => ReplyFor<T> | null | undefined

export interface SurfaceBridge {
  /** Report something to the shell. */
  emit<T extends EventType>(type: T, payload: EventPayload<T>): void
  /** Handle one kind of command. */
  onCommand<T extends CommandType>(
    type: T,
    handler: (payload: CommandPayload<T>) => void
  ): Unsubscribe
  /**
   * Answer one kind of request. At most one handler per type — a second registration
   * replaces the first, because two answers to one question is not a thing the
   * protocol can express.
   */
  onRequest<T extends RequestType>(type: T, handler: RequestHandler<T>): Unsubscribe
  dispose(): void
}

/** Which reply a request is answered with. The runtime half of `RequestReplyMap`. */
const REPLY_FOR_REQUEST: { [T in RequestType]: RequestReplyMap[T] } = {
  getSelectionContext: 'selectionContext',
  getToolbarState: 'toolbarState',
  getReadAloudPayload: 'readAloudPayload',
  getDocumentText: 'documentText',
}

export function createSurfaceBridge(
  transport: SurfaceTransport,
  options: BridgeOptions = {}
): SurfaceBridge {
  const onGap = options.onGap ?? defaultOnGap
  const checkSequence = createSequenceCheck('command', onGap)
  const commandHandlers = new Map<CommandType, Set<(payload: never) => void>>()
  type ErasedRequestHandler = (payload: never) => unknown
  const requestHandlers = new Map<RequestType, ErasedRequestHandler>()

  let seq = 0
  let disposed = false

  const reply = (id: string, value: BridgeReply) => {
    transport.post({ kind: 'reply', message: { id, reply: value } })
  }

  const answer = (id: string, request: BridgeRequest) => {
    const handler = requestHandlers.get(request.type)
    if (!handler) {
      reply(id, {
        type: 'error',
        payload: {
          code: BridgeErrorCode.Failed,
          message: `The document surface has no handler for ${request.type}.`,
        },
      })
      return
    }

    let result: unknown
    try {
      result = handler(request.payload as never)
    } catch (error) {
      reply(id, {
        type: 'error',
        payload: { code: BridgeErrorCode.Failed, message: String(error) },
      })
      return
    }

    if (result === null || result === undefined) {
      reply(id, {
        type: 'error',
        payload: {
          code: BridgeErrorCode.NoEditor,
          message: `No live editor to answer ${request.type}.`,
        },
      })
      return
    }

    reply(id, { type: REPLY_FOR_REQUEST[request.type], payload: result } as BridgeReply)
  }

  const unsubscribe = transport.receive((message: InboundMessage) => {
    if (message.kind === 'request') {
      answer(message.message.id, message.message.request)
      return
    }

    checkSequence(message.message.seq)
    const command = message.message.command
    const set = commandHandlers.get(command.type)
    if (!set) return
    for (const handler of [...set]) handler(command.payload as never)
  })

  return {
    emit(type, payload) {
      if (disposed) return
      transport.post({
        kind: 'event',
        message: { seq: seq++, event: { type, payload } as WebviewEvent },
      })
    },

    onCommand(type, handler) {
      const set = commandHandlers.get(type) ?? new Set()
      commandHandlers.set(type, set)
      set.add(handler as (payload: never) => void)
      return () => { set.delete(handler as (payload: never) => void) }
    },

    onRequest(type, handler) {
      const erased = handler as ErasedRequestHandler
      requestHandlers.set(type, erased)
      return () => {
        if (requestHandlers.get(type) === erased) requestHandlers.delete(type)
      }
    },

    dispose() {
      disposed = true
      unsubscribe()
      commandHandlers.clear()
      requestHandlers.clear()
    },
  }
}

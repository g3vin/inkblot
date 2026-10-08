/**
 * dictationSource.ts — the speech engine's side of the dictation protocol.
 *
 * The speech engine emits `dictation://*` events (the Tauri app's commands). This
 * turns them into the protocol's `dictationPartial` / `dictationFinal` /
 * `dictationLevel` / `dictationCancel` commands — the same messages a shell that owned
 * the microphone itself would send — so `DictationControl` only ever sees the protocol.
 *
 * **The draft state machine stays in the webview, on purpose.** `replaceInlineDraft`
 * is a read-modify-write on the document at speaking rate; a process round trip inside
 * that loop would lose the race with the next partial. The engine sends text; the
 * document decides what to do with it.
 */
import { shellBridge } from './appBridge'
import { setupDictationListeners } from '../lib/dictation'

export interface DictationSourceHandlers {
  /** Lifecycle stays out of the protocol: it is about the engine, not the document. */
  onStarted?(payload: { sessionId?: string }): void
  onStopped?(payload: unknown): void
  onError?(payload: unknown): void
}

/**
 * Bridge the engine's events onto the protocol. Returns a promise for the unsubscribe.
 *
 * Non-speech filtering, duplicate suppression and the draft diff all stay downstream,
 * in the control: they are decisions about the *document*, and the document is on the
 * other side of this.
 */
export async function startDictationSource(
  handlers: DictationSourceHandlers = {}
): Promise<() => void> {
  return setupDictationListeners({
    onStarted: (payload: unknown) => {
      handlers.onStarted?.((payload as { sessionId?: string }) || {})
    },
    onPartial: (payload: unknown) => {
      shellBridge.send('dictationPartial', {
        text: readText(payload),
        sessionId: readSessionId(payload),
      })
    },
    onFinal: (payload: unknown) => {
      shellBridge.send('dictationFinal', {
        text: readText(payload),
        sessionId: readSessionId(payload),
      })
    },
    onLevel: (payload: unknown) => {
      const level = readLevel(payload)
      if (level !== null) shellBridge.send('dictationLevel', { level })
    },
    onStopped: (payload: unknown) => {
      handlers.onStopped?.(payload)
    },
    onError: (payload: unknown) => {
      handlers.onError?.(payload)
    },
  })
}

/* The engine has never had a schema for these, and a transcript has arrived as both a
   bare string and an object for as long as the feature has existed. Normalizing here
   is what lets the protocol have one shape. */

const readText = (payload: unknown): string => {
  if (typeof payload === 'string') return payload
  const text = (payload as { text?: unknown })?.text
  return typeof text === 'string' ? text : ''
}

const readSessionId = (payload: unknown): string | undefined => {
  const sessionId = (payload as { sessionId?: unknown })?.sessionId
  return typeof sessionId === 'string' ? sessionId : undefined
}

const readLevel = (payload: unknown): number | null => {
  const source = payload as Record<string, unknown> | null
  const value = source?.level ?? source?.rms ?? source?.volume ?? source?.audioLevel
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  // The engine has reported both 0..1 and 0..100 depending on the backend.
  return Math.max(0, Math.min(1, value > 1 ? value / 100 : value))
}

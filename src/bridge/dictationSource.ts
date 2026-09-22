/**
 * dictationSource.ts — the speech engine's side of the dictation protocol.
 *
 * **This file is a stand-in for Swift.** In Phase 5 the shell owns the microphone and
 * whisper, and sends `dictationPartial` / `dictationFinal` / `dictationLevel` /
 * `dictationCancel` over the bridge. Today the shell is the web layer, so this
 * subscribes to the Tauri `dictation://*` events and sends exactly those commands —
 * same messages, same order, over the same client. When the Swift shell takes over,
 * this file is deleted and nothing downstream of it changes.
 *
 * That is worth more than it looks. Sharp edge #2 says the draft state machine must
 * stay in the webview, because `replaceInlineDraft` is a read-modify-write at speaking
 * rate and a round trip inside that loop loses the race with whisper. The only way to
 * know the split is drawn in the right place is to run the real state machine against
 * the real protocol, which is what this makes possible before any Swift exists.
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

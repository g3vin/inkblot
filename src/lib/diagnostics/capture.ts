/**
 * capture.ts — the console and uncaught errors, for reports.
 *
 * Console calls still reach the console unchanged; a sanitized copy of each is kept
 * (sanitize.ts). An uncaught error or rejection is kept too and, the first few times
 * a distinct one happens in a launch, saved as a crash report of its own.
 */
import { addCrumb } from './breadcrumbs'
import { Ring } from './ring'
import { sanitizeConsoleArgs, summarizeError, type ErrorSummary } from './sanitize'

export interface ConsoleLine {
  at: number
  level: 'error' | 'warn' | 'info' | 'log'
  text: string
}

export interface CapturedError extends ErrorSummary {
  at: number
  kind: 'error' | 'unhandledrejection' | 'render'
  source?: string | null
}

const consoleLines = new Ring<ConsoleLine>(500)
const errors = new Ring<CapturedError>(50)

export const recentConsole = (): ConsoleLine[] => consoleLines.toArray()
export const recentErrors = (): CapturedError[] => errors.toArray()

/** Noise every WebKit page sees, not a bug. */
const IGNORED = [/^ResizeObserver loop/]

/** A launch saves each distinct error once, and at most this many: a loop that throws must not fill the folder. */
const MAX_CRASHES_PER_LAUNCH = 5
const seen = new Set<string>()

export function recordError(kind: CapturedError['kind'], error: unknown, source?: string | null): CapturedError | null {
  const summary = summarizeError(error)
  if (IGNORED.some((pattern) => pattern.test(summary.message))) return null
  const captured: CapturedError = { at: Date.now(), kind, ...summary, source: source ?? null }
  errors.push(captured)
  // Name only: the trail is written to disk unguarded (index.ts), the message is in `errors`.
  addCrumb('error', { kind, name: summary.name })
  return captured
}

/** True the first time this error's signature is seen, up to the per-launch cap. */
export function isNewCrash(error: CapturedError): boolean {
  const firstFrame = error.stack?.split('\n').find((line) => line.includes('/')) ?? ''
  const signature = `${error.name}|${error.message}|${firstFrame.trim()}`
  if (seen.has(signature) || seen.size >= MAX_CRASHES_PER_LAUNCH) return false
  seen.add(signature)
  return true
}

/**
 * Start capturing. `onCrash` is called for each error worth its own report.
 * Returns a function that stops and puts the console back.
 */
export function installCapture(onCrash: (error: CapturedError) => void): () => void {
  const levels = ['error', 'warn', 'info', 'log'] as const
  // Through one reference, so recording the console is not mistaken for logging to it.
  const target = console as unknown as Record<ConsoleLine['level'], (...args: unknown[]) => void>
  const originals = levels.map((level) => target[level])
  levels.forEach((level, index) => {
    const original = originals[index]
    target[level] = (...args: unknown[]) => {
      try {
        consoleLines.push({ at: Date.now(), level, text: sanitizeConsoleArgs(args) })
      } catch {
        // A value that cannot be described is not worth losing the log call over.
      }
      original.apply(target, args)
    }
  })

  const onError = (event: ErrorEvent) => {
    const source = event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : null
    const captured = recordError('error', event.error ?? event.message, source)
    if (captured && isNewCrash(captured)) onCrash(captured)
  }
  const onRejection = (event: PromiseRejectionEvent) => {
    const captured = recordError('unhandledrejection', event.reason)
    if (captured && isNewCrash(captured)) onCrash(captured)
  }
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)

  return () => {
    levels.forEach((level, index) => { target[level] = originals[index] })
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
  }
}

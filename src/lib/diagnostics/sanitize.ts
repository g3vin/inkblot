/**
 * sanitize.ts — what a report may say, decided by allowlist, then checked again.
 *
 * A report never carries a writer's words. Three rules get it there:
 *
 * 1. `summarize` keeps numbers, booleans and structure, and a string only under a key
 *    known to hold an id, a mode or a name (`SAFE_KEYS`). Any other string becomes its
 *    length. A new field is redacted until someone adds its key here on purpose.
 * 2. `sanitizeConsoleArgs` keeps a log call's message and errors, and reduces its other
 *    arguments the same way.
 * 3. `guardAgainstDocuments` runs last, over the finished report: any string sharing a
 *    run of words with an open document is replaced. It catches what slipped past 1
 *    and 2, such as an error message that quotes the text it choked on.
 *
 * File, folder and project names are not writing and are kept; home folders become ~.
 * Headings are writing: `title` and `label` are not safe keys, since an outline or a
 * timeline names its passages with them.
 */

/** Keys whose string values are ids, modes, names or paths: never prose. */
const SAFE_KEYS = new Set([
  'type', 'kind', 'id', 'mode', 'target', 'pane', 'surfaceId', 'activeTabId', 'activeSplitId',
  'docPath', 'secondaryDoc', 'currentDoc', 'activeDoc', 'path', 'projectName', 'projectRoot',
  'sidebarTab', 'tab', 'blockType', 'font', 'fontFamily', 'alignment', 'writingFormat',
  'activeMarks', 'marks', 'format', 'scope', 'status', 'state', 'phase', 'theme', 'orientation',
  'splitOrientation', 'view', 'tool', 'lens', 'style', 'size', 'unit', 'units', 'trim', 'step',
  'name', 'level', 'source', 'command', 'request', 'event', 'section', 'key',
  'version', 'updatedAt', 'createdAt', 'at', 'role', 'reason', 'error', 'message', 'stack',
  'shortcut', 'keys', 'url', 'docName', 'folder', 'pageSize', 'preset', 'edition', 'color',
  'highlight', 'ink', 'accent', 'tray', 'focusMode', 'platform', 'locale', 'os',
])

const MAX_SAFE_STRING = 300
const MAX_ARRAY = 25
const MAX_DEPTH = 6

const redactedString = (value: string): string => `<string len=${value.length}>`

/**
 * A JSON-safe copy of `value` that keeps its shape and nothing a writer wrote.
 * `key` is the property `value` sits under; array items inherit their array's key.
 */
export function summarize(value: unknown, key = '', depth = 0): unknown {
  if (value === null || value === undefined) return value ?? null
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'string') {
    return SAFE_KEYS.has(key) && value.length <= MAX_SAFE_STRING ? value : redactedString(value)
  }
  if (typeof value !== 'object') return `<${typeof value}>`
  if (depth >= MAX_DEPTH) return '<deep>'
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY).map((item) => summarize(item, key, depth + 1))
    return value.length > MAX_ARRAY ? { length: value.length, first: items } : items
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'function') continue
    out[k] = summarize(v, k, depth + 1)
  }
  return out
}

export interface ErrorSummary {
  name: string
  message: string
  stack: string | null
}

export function summarizeError(error: unknown): ErrorSummary {
  if (error instanceof Error) {
    return { name: error.name, message: error.message.slice(0, 1000), stack: error.stack?.slice(0, 4000) ?? null }
  }
  if (typeof error === 'string') return { name: 'Error', message: error.slice(0, 1000), stack: null }
  return { name: 'NonError', message: JSON.stringify(summarize(error)).slice(0, 1000), stack: null }
}

/** Ids, keys and paths: short and without spaces, or path-shaped. */
const looksLikeAnIdentifier = (value: string): boolean =>
  (value.length <= 48 && !/\s/.test(value)) || /^(~|\/|[A-Za-z]:\\)[^\n]*$/.test(value)

/**
 * One console call as a line: its first argument (the message the code wrote), then
 * each other argument reduced to what it is.
 */
export function sanitizeConsoleArgs(args: unknown[]): string {
  return args.map((arg, index) => {
    if (arg instanceof Error) {
      const { name, message, stack } = summarizeError(arg)
      return stack ?? `${name}: ${message}`
    }
    if (typeof arg === 'string') {
      if (index === 0) return arg.slice(0, MAX_SAFE_STRING)
      return looksLikeAnIdentifier(arg) ? arg : redactedString(arg)
    }
    if (arg === null || typeof arg !== 'object') return String(arg)
    if (Array.isArray(arg)) return `<array length=${arg.length}>`
    return `<object keys=[${Object.keys(arg).slice(0, 12).join(', ')}]>`
  }).join(' ')
}

const HOME = /\/(Users|home)\/[^/\s"'`]+/g

/** `/Users/name/…` → `~/…`, everywhere in the report. */
export const scrubHome = (text: string): string => text.replace(HOME, '~')

/* ---------------- the leak guard ---------------- */

/** Runs of this many words shared with a document mark a string as writing. */
const SHINGLE = 4
const MIN_GUARDED_LENGTH = 16
export const REDACTED_TEXT = '<redacted: matched document text>'

const words = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []

/** Every run of `SHINGLE` words in the documents, for matching in memory only. */
export function documentShingles(documents: string[]): Set<string> {
  const shingles = new Set<string>()
  for (const text of documents) {
    const list = words(text)
    for (let i = 0; i + SHINGLE <= list.length; i++) shingles.add(list.slice(i, i + SHINGLE).join(' '))
  }
  return shingles
}

function sharesARun(text: string, shingles: Set<string>): boolean {
  const list = words(text)
  for (let i = 0; i + SHINGLE <= list.length; i++) {
    if (shingles.has(list.slice(i, i + SHINGLE).join(' '))) return true
  }
  return false
}

/** Replace each string in `node` with `replace(string)`, in place. */
function mapStrings(node: unknown, replace: (text: string) => string): unknown {
  if (typeof node === 'string') return replace(node)
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) node[i] = mapStrings(node[i], replace)
  } else if (node && typeof node === 'object') {
    const record = node as Record<string, unknown>
    for (const key of Object.keys(record)) record[key] = mapStrings(record[key], replace)
  }
  return node
}

/**
 * Replace every string in `report` that shares a run of words with an open document.
 * Returns how many were replaced. Mutates `report` in place.
 */
export function guardAgainstDocuments(report: unknown, shingles: Set<string>): number {
  if (!shingles.size) return 0
  let redactions = 0
  mapStrings(report, (text) => {
    if (text.length < MIN_GUARDED_LENGTH || !sharesARun(text, shingles)) return text
    redactions++
    return REDACTED_TEXT
  })
  return redactions
}

/** Every string in `report` with home folders scrubbed. Mutates in place. */
export const scrubHomeEverywhere = (report: unknown): void => { mapStrings(report, scrubHome) }

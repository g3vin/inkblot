/**
 * usePageLayout — Typeset and Print & Export, as the inspector sees them: the state the
 * page publishes (`pageLayoutState`, `pageLayoutCatalog`, `printJobStatus`) and every
 * edit as a command (PageLayoutModel.swift's JS twin).
 *
 * The page owns every part of it; this only reads what it published and asks. Under
 * a book scope Typeset edits the book's setup, which every chapter prints in; under the
 * document scope, the document's own.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { shellBridge, useBridgeEvent, useLatestBridgeState } from '../../../bridge'
import { PrintRange } from '../../../types'
import { readUnit, writeUnit } from './units'
import { PAGE_UNITS } from '../../../lib/appEvents'

const send = (type, payload = {}) => shellBridge.send(type, payload)

export const TRACKING_STEP = 5
const DONE_LINGER_MS = 10000

export const DEFAULT_PRINT_OPTIONS = { range: PrintRange.All, pages: '', watermark: '', recipients: '', scenes: [], highlightCharacter: '' }

export const recipientNames = (text) => String(text || '').split(/\n/).map((line) => line.trim()).filter(Boolean)

/** The options as the protocol takes them. */
export const printOptionsOf = (draft) => ({
  range: draft.range,
  pages: draft.pages.trim(),
  watermark: draft.watermark.trim(),
  recipients: draft.watermark.trim() ? recipientNames(draft.recipients) : [],
  scenes: draft.range === PrintRange.Scenes ? draft.scenes : [],
  highlightCharacter: draft.highlightCharacter,
})

export const isDefaultPrint = (draft) => JSON.stringify(printOptionsOf(draft)) === JSON.stringify(printOptionsOf(DEFAULT_PRINT_OPTIONS))

/** What Print will do differently, in a line — or null when nothing. */
export function printSummary(draft) {
  const parts = []
  if (draft.range === PrintRange.CurrentChapter) parts.push('current chapter')
  if (draft.range === PrintRange.Selection) parts.push('selection')
  if (draft.range === PrintRange.Scenes) parts.push(draft.scenes.length === 1 ? '1 scene' : `${draft.scenes.length} scenes`)
  if (draft.highlightCharacter) parts.push(`${draft.highlightCharacter} highlighted`)
  if (draft.pages.trim()) parts.push(`pages ${draft.pages.trim()}`)
  const mark = draft.watermark.trim()
  if (mark) {
    const names = recipientNames(draft.recipients)
    parts.push(names.length > 1 ? `watermarked, ${names.length} copies` : `watermarked “${mark}”`)
  }
  return parts.length ? `Printing ${parts.join(', ')}` : null
}

/* Print options are one for the window: the header's, the File menu's and ⌘P's. */
let sharedPrintOptions = DEFAULT_PRINT_OPTIONS
const printOptionListeners = new Set()
const setSharedPrintOptions = (next) => {
  sharedPrintOptions = next
  for (const listener of [...printOptionListeners]) listener(next)
}

export default function usePageLayout() {
  const state = useLatestBridgeState('pageLayoutState', null)
  const catalog = useLatestBridgeState('pageLayoutCatalog', null)
  const [job, setJob] = useState(null)
  const [unit, setUnitState] = useState(readUnit)
  const [printOptions, setPrintOptionsState] = useState(sharedPrintOptions)

  useEffect(() => {
    const onUnits = () => setUnitState(readUnit())
    window.addEventListener(PAGE_UNITS, onUnits)
    printOptionListeners.add(setPrintOptionsState)
    return () => {
      window.removeEventListener(PAGE_UNITS, onUnits)
      printOptionListeners.delete(setPrintOptionsState)
    }
  }, [])

  useBridgeEvent('printJobStatus', (status) => setJob(status?.phase === 'cancelled' ? null : status))
  useEffect(() => {
    if (job?.phase !== 'done') return undefined
    const timer = setTimeout(() => setJob((current) => (current?.jobId === job.jobId ? null : current)), DONE_LINGER_MS)
    return () => clearTimeout(timer)
  }, [job])

  const scope = state?.scope ?? 'document'
  const editsBook = scope !== 'document'
  const setup = state ? (editsBook ? (state.book?.pageSetup ?? state.setup) : state.setup) : null
  const book = state?.book ?? null

  const applySetup = useCallback((patch) => {
    if (!setup) return
    const next = typeof patch === 'function' ? patch(setup) : { ...setup, ...patch }
    send('setPageSetup', { setup: next, target: editsBook ? 'book' : 'document' })
  }, [setup, editsBook])

  const applyBook = useCallback((patch) => {
    if (!book) return
    const next = typeof patch === 'function' ? patch(book) : { ...book, ...patch }
    send('setBookSettings', { settings: next })
  }, [book])

  const commands = useMemo(() => ({
    setScope: (next) => send('setPrintScope', { scope: next }),
    setMode: (mode) => send('setEditorMode', { mode }),
    setTypesetView: (view) => send('setTypesetView', { view }),
    setDisplay: (patch) => send('setTypesetDisplay', patch),
    setParagraph: (patch) => send('setParagraphTypeset', patch),
    setTextStyle: (style) => send('setTextStyle', style ? { style } : {}),
    applyStyle: (id) => send('applyBookStyle', { id }),
    applyFormat: (formatId) => send('applyFormat', { formatId, target: editsBook ? 'book' : 'document' }),
    useSetupForBook: () => send('useSetupForBook', {}),
    clearBookSetup: () => send('clearBookSetup', {}),
    setAuthor: (profile) => send('setAuthorProfile', { profile }),
    setCover: (path) => send('setBookCover', path ? { path } : {}),
    setCoverImage: (part, path, setId) => send('setCoverImage', { part, ...(path ? { path } : {}), ...(setId ? { setId } : {}) }),
    editCovers: (action, extra = {}) => send('editCoverSets', { action, ...extra }),
    showCover: () => { send('setEditorMode', { mode: 'typeset' }); send('openBookItem', { id: 'cover' }) },
    setChapterMeta: (meta) => send('setChapterMeta', { meta }),
    setHeadImage: (target, path) => send('setHeadImage', { target, ...(path ? { path } : {}) }),
    refreshChapters: () => send('refreshBookChapters', {}),
    editEditions: (action, extra = {}) => send('editEditions', { action, ...extra }),
    exportAllEditions: () => send('exportAllEditions', {}),
    goToPage: (page) => send('goToPage', { page: Math.max(1, Math.round(page)) }),
    print: (printScope = scope, bound = false) => send('printDocument', { scope: printScope, bound, options: printOptionsOf(sharedPrintOptions) }),
    exportAs: (format, exportScope = scope, bound = false) => send('exportDocument', {
      format, scope: exportScope, bound, options: printOptionsOf(format === 'pdf' ? sharedPrintOptions : DEFAULT_PRINT_OPTIONS),
    }),
    exportAgain: () => send('exportAgain', {}),
    measure: () => send('measureBook', {}),
    fixPreflight: (issue) => { if (issue.fixedSetup) send('setPageSetup', { setup: issue.fixedSetup, target: editsBook ? 'book' : 'document' }) },
    showProofIssue: (issue) => send('showProofIssue', { anchor: issue.anchor }),
    fixProofIssue: (issue, fix) => {
      const patch = {
        tighten: { nudgeTracking: -TRACKING_STEP },
        loosen: { nudgeTracking: TRACKING_STEP },
        keepTogether: { keepTogether: true },
        keepWithNext: { keepWithNext: true },
        runLong: { pageAdjust: 1 },
        runShort: { pageAdjust: -1 },
      }[fix]
      if (patch) send('setParagraphTypeset', { anchor: issue.anchor, ...patch })
    },
    addProjectFont: (path) => send('addProjectFont', { path }),
    setSceneNumbers: (mode) => send('setSceneNumbers', { mode }),
    scriptReport: (report, output) => send('scriptReport', { report, output }),
    printSides: (scenes) => send('printDocument', {
      scope: 'document', bound: false,
      options: printOptionsOf({ ...DEFAULT_PRINT_OPTIONS, range: PrintRange.Scenes, scenes: [...scenes].sort((a, b) => a - b), highlightCharacter: sharedPrintOptions.highlightCharacter }),
    }),
    importScript: () => send('importScript', {}),
    openBookItem: (id) => send('openBookItem', { id }),
  }), [editsBook, scope])

  return {
    state,
    catalog,
    job,
    dismissJob: () => setJob(null),
    scope,
    editsBook,
    setup,
    book,
    hasDocument: Boolean(state?.docPath),
    bindingEnabled: (book?.binding?.binding ?? 'none') !== 'none',
    unit,
    setUnit: writeUnit,
    printOptions,
    setPrintOptions: (patch) => setSharedPrintOptions({ ...sharedPrintOptions, ...patch }),
    resetPrintOptions: () => setSharedPrintOptions(DEFAULT_PRINT_OPTIONS),
    applySetup,
    applyBook,
    ...commands,
  }
}

/** A list in its catalog order, grouped under each item's heading. */
export function grouped(items, groupOf) {
  const order = []
  const groups = new Map()
  for (const item of items ?? []) {
    const key = groupOf(item)
    if (!groups.has(key)) { order.push(key); groups.set(key, []) }
    groups.get(key).push(item)
  }
  return order.map((key) => [key, groups.get(key)])
}

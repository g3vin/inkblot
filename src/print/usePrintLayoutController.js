/**
 * usePrintLayoutController.js — Print Layout's end of the bridge.
 *
 * Answers the commands the native Finishing tabs and menus send (show pages, page
 * setup, formats, the book, scope, zoom, breaks, print, export) against the active
 * document, and publishes what those tabs draw: the catalog once, and
 * `pageLayoutState` whenever any of it changes. Mounted once, by EditorLayout, which is
 * the component that knows which document and editor are active.
 *
 * The same functions back the web's own menus, so the Tauri app and the Swift shell
 * do exactly the same thing for "Print Layout", "Print…" and "Export".
 *
 * **Publishing is cheap and quiet.** The state goes out when it changes, not on every
 * transaction: typing is debounced, and a state identical to the last is skipped. The
 * lists that never change — sizes, formats, tokens — go out once, in the catalog.
 */
import { useCallback, useEffect, useRef } from 'react'

import { documentSurface } from '../bridge'
import { isTextDoc } from '../lib/docKind'
import { nativeOwns } from '../lib/host'
import { countWords } from '../lib/wordCount'
import { listBookChapters } from './compile'
import { readDocPageSetup } from './DocPageSetup'
import { applyFormat, FORMAT_OPTIONS, formatOf } from './formats'
import { SIGNATURE_GUIDANCE } from './imposition'
import { paginationKey } from './PaginationExtension'
import { PAGE_SIZE_GROUP_LABELS, PAGE_SIZE_PRESETS } from './pageSizes'
import { normalizePageSetup, resolvePageSetup, suggestedInsideMarginMm } from './pageSetup'
import {
  bookFolderForScope,
  getAuthorProfile,
  getBookSettings,
  getCurrentPrintPage,
  getDisplayPointsPerInch,
  getPrintScope,
  getPrintZoom,
  isPrintLayoutEnabled,
  setAuthorProfile,
  setBookSettings,
  setDisplayPointsPerInch,
  setPrintLayoutEnabled,
  setPrintScope,
  setPrintZoom,
  subscribeCurrentPrintPage,
  subscribePrintLayoutStore,
} from './printLayoutStore'
import { BOOK_TYPOGRAPHY } from './typography'
import { actualSizeZoom } from './zoom'

/** The tokens a running head or foot can hold, for the inspector's token menu. */
export const RUNNING_TOKENS = [
  { token: '{page}', label: 'Page Number' },
  { token: '{pages}', label: 'Page Count' },
  { token: '{title}', label: 'Title' },
  { token: '{chapter}', label: 'Chapter' },
  { token: '{author}', label: 'Author' },
  { token: '{surname}', label: 'Author’s Surname' },
  { token: '{words}', label: 'Word Count' },
  { token: '{date}', label: 'Today’s Date' },
]

export const PAGE_LAYOUT_CATALOG = {
  presets: PAGE_SIZE_PRESETS.map((p) => ({
    id: p.id,
    label: p.label,
    group: PAGE_SIZE_GROUP_LABELS[p.group],
    widthMm: p.widthMm,
    heightMm: p.heightMm,
  })),
  formats: FORMAT_OPTIONS,
  signatureAdvice: SIGNATURE_GUIDANCE.map((g) => ({ sheets: g.sheets, label: g.label })),
  tokens: RUNNING_TOKENS,
  defaultTypography: BOOK_TYPOGRAPHY,
}

/** How long typing waits before the page count it changed is published. */
const TYPING_DEBOUNCE_MS = 120

const usable = (editor) => (editor && !editor.isDestroyed && editor.view && !editor.view.isDestroyed ? editor : null)

/**
 * The state the Finishing tabs draw, for one document. Pure but for the store reads,
 * so the tests can check it without a bridge.
 */
export const buildPageLayoutState = ({ projectName, docPath, editor, chapters = [] }) => {
  const scope = getPrintScope(projectName)
  const book = getBookSettings(projectName, bookFolderForScope(projectName, docPath))
  const ownSetup = editor ? readDocPageSetup(editor.state.doc) : null
  const { setup, source } = resolvePageSetup({ docSetup: ownSetup, bookSetup: book.pageSetup })
  const { formatId, modified } = formatOf(setup)
  const result = editor ? paginationKey.getState(editor.state)?.result : null
  const pageCount = result?.pageCount || 0
  return {
    enabled: Boolean(docPath) && isPrintLayoutEnabled(projectName, docPath),
    docPath: docPath || undefined,
    ready: Boolean(editor),
    setup,
    setupSource: source,
    hasOwnSetup: Boolean(ownSetup),
    formatId: formatId || undefined,
    formatModified: modified,
    pageCount,
    currentPage: Math.min(getCurrentPrintPage(docPath), Math.max(pageCount, 1)),
    zoom: getPrintZoom(),
    scope,
    book,
    bookSetupActive: Boolean(book.pageSetup),
    bookChapters: chapters,
    suggestedInsideMarginMm: suggestedInsideMarginMm(Math.max(pageCount, 1)),
    author: getAuthorProfile(),
    // The document's words; a book's would mean reading every chapter on each publish.
    wordCount: editor && scope === 'document' ? countWords(editor.state.doc.textContent) : 0,
  }
}

export default function usePrintLayoutController({
  projectName,
  activeDoc,
  currentDoc,
  secondaryDoc,
  editor,
  secondaryEditor,
  onPrint,
  onExport,
}) {
  // The editor that holds the active document: the pane it is open in.
  const activeTextDoc = activeDoc && isTextDoc(activeDoc) ? activeDoc : null
  const activeEditor = activeTextDoc
    ? usable(activeTextDoc === secondaryDoc && activeTextDoc !== currentDoc ? secondaryEditor : editor)
    : null
  const stateRef = useRef({ projectName, activeTextDoc, activeEditor, onPrint, onExport })
  useEffect(() => {
    stateRef.current = { projectName, activeTextDoc, activeEditor, onPrint, onExport }
  })
  const chaptersRef = useRef({ key: '', chapters: [] })
  const chaptersRevision = useRef(0)
  const lastSent = useRef('')
  const debounceRef = useRef(null)
  // A setup sent before the document's editor was there to take it: applied when it is.
  const pendingSetup = useRef(null)

  const togglePrintLayout = useCallback((enabled) => {
    const { projectName: project, activeTextDoc: doc } = stateRef.current
    if (!doc) return
    setPrintLayoutEnabled(project, doc, enabled ?? !isPrintLayoutEnabled(project, doc))
  }, [])

  const publish = useCallback(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = null
    const { projectName: project, activeTextDoc: doc, activeEditor: ed } = stateRef.current
    const folder = bookFolderForScope(project, doc)
    const chapterKey = `${project}:${folder}:${chaptersRevision.current}`
    if (project && chaptersRef.current.key !== chapterKey) {
      // Keep showing the last list until the new one is read: a refresh of the same
      // folder should not flash an empty book.
      chaptersRef.current = { key: chapterKey, chapters: chaptersRef.current.chapters }
      listBookChapters(project, folder)
        .then((chapters) => {
          if (chaptersRef.current.key !== chapterKey) return
          chaptersRef.current.chapters = chapters
          publish()
        })
        .catch(() => {})
    }
    const state = buildPageLayoutState({ projectName: project, docPath: doc, editor: ed, chapters: chaptersRef.current.chapters })
    // The shell's zoom control holds the bottom-right corner while it shows; a status
    // row there moves over for it (WordCountBadge.css).
    document.documentElement.classList.toggle('print-layout-active', state.enabled)
    const json = JSON.stringify(state)
    if (json === lastSent.current) return
    lastSent.current = json
    documentSurface.publishPageLayoutState(state)
  }, [])

  /** Publish soon: for typing and scrolling, which change the page counts at most. */
  const publishSoon = useCallback(() => {
    if (debounceRef.current) return
    debounceRef.current = setTimeout(publish, TYPING_DEBOUNCE_MS)
  }, [publish])

  // The catalog, once.
  useEffect(() => {
    documentSurface.publishPageLayoutCatalog(PAGE_LAYOUT_CATALOG)
  }, [])

  // The shell draws the Print Layout button and zoom control; the page leaves room.
  useEffect(() => {
    if (!nativeOwns('printControls')) return undefined
    document.documentElement.classList.add('native-print-controls')
    return () => document.documentElement.classList.remove('native-print-controls', 'print-layout-active')
  }, [])

  // Publish on every change to what the Finishing tabs show.
  useEffect(() => {
    publish()
    const unsubscribe = subscribePrintLayoutStore(publish)
    const unsubscribePage = subscribeCurrentPrintPage(publishSoon)
    const ed = activeEditor
    if (ed) ed.on('transaction', publishSoon)
    return () => {
      unsubscribe()
      unsubscribePage()
      if (ed && !ed.isDestroyed) ed.off('transaction', publishSoon)
    }
  }, [activeEditor, activeTextDoc, projectName, publish, publishSoon])

  useEffect(() => () => clearTimeout(debounceRef.current), [])

  // A setup that arrived before the editor did.
  useEffect(() => {
    const pending = pendingSetup.current
    if (!pending || !activeEditor || pending.docPath !== activeTextDoc) return
    pendingSetup.current = null
    activeEditor.commands.setPageSetup(pending.setup)
  }, [activeEditor, activeTextDoc])

  /** The book of the active document under the current scope, and where it is kept. */
  const currentBook = useCallback(() => {
    const { projectName: project, activeTextDoc: doc } = stateRef.current
    const folder = bookFolderForScope(project, doc)
    return { project, folder, book: getBookSettings(project, folder) }
  }, [])

  /** Give the document, or its book, a setup. */
  const applySetup = useCallback((setup, target = 'document') => {
    if (target === 'book') {
      const { project, folder, book } = currentBook()
      if (!project) return
      setBookSettings(project, folder, { ...book, pageSetup: normalizePageSetup(setup) })
      return
    }
    const { activeTextDoc: doc, activeEditor: ed } = stateRef.current
    if (!doc) return
    if (ed) ed.commands.setPageSetup(setup)
    else pendingSetup.current = { docPath: doc, setup }
  }, [currentBook])

  // Through the view when it is showing, which eases to the new zoom about the pane's
  // centre; straight to the store when it is not.
  const zoomTo = useCallback(({ zoom, fit }) => {
    const pagination = stateRef.current.activeEditor?.storage?.pagination
    const setZoom = (z) => (pagination?.zoomTo ? pagination.zoomTo(z) : setPrintZoom(z))
    if (fit === 'actual') {
      const z = actualSizeZoom(getDisplayPointsPerInch())
      if (z) setZoom(z)
      return
    }
    if (fit === 'width' || fit === 'page') {
      pagination?.fit?.(fit)
      return
    }
    if (typeof zoom === 'number') setZoom(zoom)
  }, [])

  useEffect(() => {
    const subscriptions = [
      documentSurface.onCommand('setPrintLayout', ({ enabled }) => togglePrintLayout(enabled)),
      documentSurface.onCommand('setPageSetup', ({ setup, target }) => applySetup(setup, target)),
      documentSurface.onCommand('applyFormat', ({ formatId, target }) => {
        const setup = applyFormat(formatId)
        if (setup) applySetup(setup, target)
      }),
      documentSurface.onCommand('useSetupForBook', () => {
        const { activeEditor: ed } = stateRef.current
        const { book } = currentBook()
        const own = ed ? readDocPageSetup(ed.state.doc) : null
        applySetup(resolvePageSetup({ docSetup: own, bookSetup: book.pageSetup }).setup, 'book')
      }),
      documentSurface.onCommand('clearBookSetup', () => {
        const { project, folder, book } = currentBook()
        if (!project) return
        const { pageSetup: _cleared, ...rest } = book
        setBookSettings(project, folder, rest)
      }),
      documentSurface.onCommand('refreshBookChapters', () => {
        chaptersRevision.current += 1
        publish()
      }),
      documentSurface.onCommand('setAuthorProfile', ({ profile }) => setAuthorProfile(profile)),
      documentSurface.onCommand('setPrintScope', ({ scope }) => {
        setPrintScope(stateRef.current.projectName, scope)
      }),
      documentSurface.onCommand('setBookSettings', ({ settings }) => {
        setBookSettings(stateRef.current.projectName, settings.folder, settings)
      }),
      documentSurface.onCommand('setPrintZoom', zoomTo),
      documentSurface.onCommand('setDisplayDensity', ({ pointsPerInch }) => setDisplayPointsPerInch(pointsPerInch)),
      documentSurface.onCommand('insertBreak', ({ kind }) => {
        stateRef.current.activeEditor?.chain().focus().insertPageBreak(kind).run()
      }),
      documentSurface.onCommand('goToPage', ({ page }) => {
        stateRef.current.activeEditor?.storage?.pagination?.goToPage?.(page)
      }),
      documentSurface.onCommand('printDocument', ({ scope, bound }) => {
        stateRef.current.onPrint?.({ scope, bound })
      }),
      documentSurface.onCommand('exportDocument', ({ format, scope, bound }) => {
        stateRef.current.onExport?.({ format, scope, bound })
      }),
    ]
    return () => subscriptions.forEach((unsubscribe) => unsubscribe())
  }, [applySetup, currentBook, publish, togglePrintLayout, zoomTo])

  // The web's own menus (App.jsx, and the Swift shell's mirror of them) and keys.
  useEffect(() => {
    const onToggle = () => togglePrintLayout()
    const onPrintEvent = (event) => stateRef.current.onPrint?.({ scope: 'document', bound: false, ...(event.detail || {}) })
    const onExportEvent = (event) => stateRef.current.onExport?.({ scope: 'document', bound: false, ...(event.detail || {}) })
    // ⌥⌘P toggles pages, as it does in Word; ⌘P prints, which a WKWebView otherwise
    // ignores. A shell that draws the Finishing tabs puts both in its menus, keys and
    // all — handling them here as well would print twice.
    const onKeyDown = (event) => {
      if (!event.metaKey || event.ctrlKey || event.shiftKey || event.code !== 'KeyP') return
      if (nativeOwns('pageSetup')) return
      event.preventDefault()
      if (event.altKey) togglePrintLayout()
      else stateRef.current.onPrint?.({ scope: 'document', bound: false })
    }
    window.addEventListener('inkblot:print-layout-toggle', onToggle)
    window.addEventListener('inkblot:print', onPrintEvent)
    window.addEventListener('inkblot:export', onExportEvent)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('inkblot:print-layout-toggle', onToggle)
      window.removeEventListener('inkblot:print', onPrintEvent)
      window.removeEventListener('inkblot:export', onExportEvent)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [togglePrintLayout])

  const pageCount = activeEditor ? paginationKey.getState(activeEditor.state)?.result?.pageCount || 0 : 0
  return { togglePrintLayout, zoomTo, applySetup, activeEditor, activeTextDoc, pageCount }
}

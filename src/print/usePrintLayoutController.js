/**
 * usePrintLayoutController.js — Print Layout's end of the bridge.
 *
 * Answers the commands the native inspector and menus send (show pages, page setup,
 * zoom, breaks, print, export) against the active document, and publishes
 * `pageLayoutState` — everything the inspector's Page tab draws — whenever any of it
 * changes. Mounted once, by EditorLayout, which is the component that knows which
 * document and editor are active.
 *
 * The same functions back the web's own menus, so the Tauri app and the Swift shell
 * do exactly the same thing for "Print Layout", "Print…" and "Export".
 */
import { useCallback, useEffect, useRef } from 'react'

import { documentSurface } from '../bridge'
import { isTextDoc } from '../lib/docKind'
import { bookFolderFor, listBookChapters } from './compile'
import { effectivePageSetup, readDocPageSetup } from './DocPageSetup'
import { SIGNATURE_GUIDANCE } from './imposition'
import { paginationKey } from './PaginationExtension'
import { PAGE_SIZE_GROUP_LABELS, PAGE_SIZE_PRESETS } from './pageSizes'
import { suggestedInsideMarginMm } from './pageSetup'
import {
  getBookSettings,
  getDisplayPointsPerInch,
  getPrintZoom,
  isPrintLayoutEnabled,
  setBookSettings,
  setDisplayPointsPerInch,
  setPrintLayoutEnabled,
  setPrintZoom,
  subscribePrintLayoutStore,
} from './printLayoutStore'
import { actualSizeZoom } from './zoom'

const PRESET_OPTIONS = PAGE_SIZE_PRESETS.map((p) => ({
  id: p.id,
  label: p.label,
  group: PAGE_SIZE_GROUP_LABELS[p.group],
  widthMm: p.widthMm,
  heightMm: p.heightMm,
}))

const SIGNATURE_ADVICE = SIGNATURE_GUIDANCE.map((g) => ({ sheets: g.sheets, label: g.label }))

const usable = (editor) => (editor && !editor.isDestroyed && editor.view && !editor.view.isDestroyed ? editor : null)

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

  const togglePrintLayout = useCallback((enabled) => {
    const { projectName: project, activeTextDoc: doc } = stateRef.current
    if (!doc) return
    setPrintLayoutEnabled(project, doc, enabled ?? !isPrintLayoutEnabled(project, doc))
  }, [])

  const publish = useCallback(() => {
    const { projectName: project, activeTextDoc: doc, activeEditor: ed } = stateRef.current
    const folder = bookFolderFor(doc, 'folder')
    const book = getBookSettings(project, folder)
    const result = ed ? paginationKey.getState(ed.state)?.result : null
    const pageCount = result?.pageCount || 0
    const chapterKey = `${project}:${folder}`
    if (project && chaptersRef.current.key !== chapterKey) {
      chaptersRef.current = { key: chapterKey, chapters: [] }
      listBookChapters(project, folder)
        .then((chapters) => {
          if (chaptersRef.current.key !== chapterKey) return
          chaptersRef.current.chapters = chapters
          publish()
        })
        .catch(() => {})
    }
    documentSurface.publishPageLayoutState({
      enabled: Boolean(doc) && isPrintLayoutEnabled(project, doc),
      docPath: doc || undefined,
      setup: ed ? effectivePageSetup(ed.state.doc) : effectivePageSetup(null),
      hasOwnSetup: Boolean(ed && readDocPageSetup(ed.state.doc)),
      pageCount,
      currentPage: 1,
      zoom: getPrintZoom(),
      book,
      bookChapters: chaptersRef.current.chapters,
      suggestedInsideMarginMm: suggestedInsideMarginMm(Math.max(pageCount, 1)),
      presets: PRESET_OPTIONS,
      signatureAdvice: SIGNATURE_ADVICE,
    })
  }, [])

  // Publish on every change to what the Page tab shows.
  useEffect(() => {
    publish()
    const unsubscribe = subscribePrintLayoutStore(publish)
    const ed = activeEditor
    if (ed) ed.on('transaction', publish)
    return () => {
      unsubscribe()
      if (ed && !ed.isDestroyed) ed.off('transaction', publish)
    }
  }, [activeEditor, activeTextDoc, projectName, publish])

  const zoomTo = useCallback(({ zoom, fit }) => {
    const ed = stateRef.current.activeEditor
    if (fit === 'actual') {
      const z = actualSizeZoom(getDisplayPointsPerInch())
      if (z) setPrintZoom(z)
      return
    }
    if (fit === 'width' || fit === 'page') {
      ed?.storage?.pagination?.fit?.(fit)
      return
    }
    if (typeof zoom === 'number') setPrintZoom(zoom)
  }, [])

  useEffect(() => {
    const subscriptions = [
      documentSurface.onCommand('setPrintLayout', ({ enabled }) => togglePrintLayout(enabled)),
      documentSurface.onCommand('setPageSetup', ({ setup }) => {
        stateRef.current.activeEditor?.commands.setPageSetup(setup)
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
  }, [togglePrintLayout, zoomTo])

  // The web's own menus (App.jsx, and the Swift shell's mirror of them) and keys.
  useEffect(() => {
    const onToggle = () => togglePrintLayout()
    const onPrintEvent = (event) => stateRef.current.onPrint?.({ scope: 'document', bound: false, ...(event.detail || {}) })
    const onExportEvent = (event) => stateRef.current.onExport?.({ scope: 'document', bound: false, ...(event.detail || {}) })
    // ⌥⌘P toggles pages, as it does in Word; ⌘P prints, which a WKWebView otherwise ignores.
    const onKeyDown = (event) => {
      if (!event.metaKey || event.ctrlKey || event.shiftKey || event.code !== 'KeyP') return
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
  return { togglePrintLayout, zoomTo, activeEditor, activeTextDoc, pageCount }
}

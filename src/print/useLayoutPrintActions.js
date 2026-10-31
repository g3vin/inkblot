/**
 * useLayoutPrintActions — Print Layout for the editor: the controller, wired to print,
 * export (one format, or every edition), measure the book, and open a page of the
 * book's own. What each print or export was made from goes into the typeset history
 * as a milestone.
 *
 * Returns the controller (`usePrintLayoutController`).
 */
import { useCallback } from 'react'
import usePrintLayoutController from './usePrintLayoutController'
import { measurePrint, runPrintJob } from './printJob'
import { runExport, runExportAllEditions } from './export/runExport'
import { bookFolderFor } from './compile'
import { getBookForDoc, getBookSettings, getPrintScope, setMeasurement } from './printLayoutStore'
import { TYPESET_MILESTONE_EVENT } from './useTypesetHistory'

/** What a format is called in the typeset history: "Exported PDF". */
const EXPORT_NAMES = { pdf: 'PDF', epub: 'EPUB', docx: 'Word', html: 'HTML', markdown: 'Markdown', plainText: 'Plain text', fountain: 'Fountain', fdx: 'Final Draft' }
const milestone = (label) => window.dispatchEvent(new CustomEvent(TYPESET_MILESTONE_EVENT, { detail: { label } }))

export function useLayoutPrintActions({ projectName, activeDoc, currentDoc, secondaryDoc, editor, secondaryEditor, setActiveDoc, setCurrentDoc }) {
  const printOptions = useCallback((scope) => {
    const docPath = activeDoc || currentDoc
    return {
      projectName,
      docPath,
      liveEditors: [
        { path: currentDoc, editor },
        { path: secondaryDoc, editor: secondaryEditor },
      ],
      // Printed alone, a document takes its book's setup when it has none — the book
      // the Finishing tabs show, under the project's scope.
      book: scope === 'document' ? getBookForDoc(projectName, docPath) : getBookSettings(projectName, bookFolderFor(docPath, scope)),
    }
  }, [activeDoc, currentDoc, editor, projectName, secondaryDoc, secondaryEditor])
  return usePrintLayoutController({
    projectName: projectName,
    activeDoc: activeDoc || currentDoc,
    currentDoc,
    secondaryDoc: secondaryDoc,
    editor,
    secondaryEditor: secondaryEditor,
    // What a print or an export was made from is kept in the typeset history.
    onPrint: ({ scope, bound, options }) => {
      runPrintJob({ ...printOptions(scope), scope, bound, options })
        .then((done) => { if (done !== false && !options?.report) milestone(bound ? 'Printed for binding' : 'Printed') })
        .catch((error) => console.error('[print] failed:', error))
    },
    onExport: ({ format, scope, bound, options, path }) => {
      runExport({ ...printOptions(scope), format, scope, bound, options, path })
        .then((written) => { if (written) milestone(`Exported ${EXPORT_NAMES[format] || format}`) })
        .catch((error) => console.error('[export] failed:', error))
    },
    onExportAllEditions: () => {
      const scope = getPrintScope(projectName) === 'project' ? 'project' : 'folder'
      runExportAllEditions({ ...printOptions(scope), scope })
        .then((done) => { if (done?.written?.length) milestone(`Exported ${done.written.length} files for every edition`) })
        .catch((error) => console.error('[export] every edition failed:', error))
    },
    // A page of the book's own — a dedication — opened from the Book navigator.
    onOpenDoc: (path) => {
      setActiveDoc(path)
      setCurrentDoc(path)
    },
    onMeasure: ({ scope }) => {
      const { projectName, docPath } = printOptions(scope)
      measurePrint({ ...printOptions(scope), scope })
        .then((measured) => { if (measured) setMeasurement(projectName, scope, docPath, measured) })
        .catch((error) => console.error('[measure] failed:', error))
    },
  })
}

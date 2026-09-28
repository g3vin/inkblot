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
import { importAssetFromPath } from '../lib/assets'
import { getProjectRoot, joinPath } from '../lib/projectPaths'
import { countEditorWords } from '../lib/wordCount'
import { editCovers, withCoverPart } from './chapterDesign'
import { bookSpine, buildCoverState, loadCoverSizes } from './coverState'
import { newItemId } from './bookItems'
import { reconcileBookItems } from './bookItems'
import { addBookItem, editBookItem, moveBookItem, openablePath, removeBookItem, setBookItemHidden } from './bookContents'
import { bookRows } from './bookRows'
import { BOOK_CHAPTERS_CHANGED_EVENT } from './useBookPlacement'
import { OPEN_BOOK_ITEM_EVENT } from './BookPages'
import useTypesetHistory from './useTypesetHistory'
import { applyBookStyle, BOOK_STYLES, bookStyle } from './bookStyles'
import { readChapterMeta } from './DocChapterMeta'
import { listBookChapters } from './compile'
import { readDocPageSetup } from './DocPageSetup'
import { applyFormat, FORMAT_OPTIONS, formatOf, writingFormatOf } from './formats'
import { SIGNATURE_GUIDANCE } from './imposition'
import { paginationKey } from './PaginationExtension'
import { PAGE_SIZE_GROUP_LABELS, PAGE_SIZE_PRESETS } from './pageSizes'
import { normalizePageSetup, resolvePageSetup, suggestedInsideMarginMm } from './pageSetup'
import { printedPageAt } from './printJob'
import { readWritingFormat } from '../script/DocWritingFormat'
import { breakdown } from '../script/reports'
import { saveScriptReport } from '../script/runReport'
import { readSceneNumbers } from '../script/sceneNumbers'
import {
  bookFolderForScope,
  getAuthorProfile,
  getBookSettings,
  getCurrentPrintPage,
  getDisplayPointsPerInch,
  getEbookIssues,
  getProofIssues,
  getStoredBook,
  getTypesetDisplay,
  getEditorMode,
  getTypesetView,
  getLastExport,
  getMeasurement,
  getPrintScope,
  getPrintZoom,
  getSelectedBookItem,
  isShowingCover,
  isPrintLayoutEnabled,
  setAuthorProfile,
  setBookSettings,
  setDisplayPointsPerInch,
  setEditorMode,
  setTypesetView,
  setTypesetDisplay,
  setStoredBook,
  setProofFocus,
  setPrintScope,
  setPrintZoom,
  setSelectedBookItem,
  setShowingCover,
  subscribeCurrentPrintPage,
  subscribePrintLayoutStore,
} from './printLayoutStore'
import { preflight, readingMinutes, spineWidthMm, SPINE_TEXT_MIN_PAGES } from './preflight'
import { decodeDataUri, imageSize } from './export/images'
import { BOOK_TYPOGRAPHY, primaryFamily } from './typography'
import { addProjectFont, loadProjectFonts, onProjectFontsChanged, projectFontFamilies } from './projectFonts'
import { paragraphTypesetOf, setParagraphTypeset } from './ParagraphTypeset'
import { textStylesOf } from './textStyles'
import { activeEditionOf, editEditions, isEbookEdition } from './editions'
import { typesetEntries } from './typesetHistoryStore'
import { readAnchor, resolveAnchor } from '../bridge/anchors'
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
  bookStyles: BOOK_STYLES,
}

/** A failed navigator command, said once in the console: the next publish shows the book as it is. */
const failed = (what) => (error) => console.error(`[book] ${what} failed:`, error)

/** How long typing waits before the page count it changed is published. */
const TYPING_DEBOUNCE_MS = 120

const usable = (editor) => (editor && !editor.isDestroyed && editor.view && !editor.view.isDestroyed ? editor : null)

// Pixel widths of the document's pictures, by src: read once, not on every publish.
const pixelWidths = new Map()
const pixelWidth = (src) => {
  if (!pixelWidths.has(src)) {
    const image = src.startsWith('data:') ? decodeDataUri(src) : null
    pixelWidths.set(src, (image && imageSize(image)?.width) || 0)
    if (pixelWidths.size > 500) pixelWidths.delete(pixelWidths.keys().next().value)
  }
  return pixelWidths.get(src)
}

/** The active document's pictures as placed: their pixels over the inches they print at. */
const placedImages = (editor, setup) => {
  const images = []
  if (!editor) return images
  const textWidthIn = (setup.widthMm - setup.margins.insideMm - setup.margins.outsideMm - setup.margins.gutterMm) / 25.4
  editor.state.doc.descendants((node) => {
    if (node.type.name !== 'image' || typeof node.attrs.src !== 'string') return
    const pixels = pixelWidth(node.attrs.src)
    if (!pixels) return
    const asked = Number.parseFloat(node.attrs.width)
    const askedIn = Number.isFinite(asked) && asked > 0 ? asked / 96 : pixels / 96
    const maxIn = textWidthIn * ((setup.typography?.images?.maxWidthPct || 100) / 100)
    images.push({ pixelsWide: pixels, printedInches: Math.min(maxIn, askedIn), askedInches: askedIn > maxIn ? askedIn : undefined })
  })
  return images
}

/** The paragraph the caret is in: what the typesetter has set on it. */
const paragraphAtCaret = (editor) => {
  const $from = editor?.state.selection.$from
  if (!$from) return undefined
  for (let d = $from.depth; d > 0; d -= 1) {
    if ($from.node(d).type.name === 'paragraph') return paragraphTypesetOf($from.node(d))
  }
  return undefined
}

/** Typeset's display, the proof's findings as anchors, the caret's paragraph, the fonts. */
const typesetDisplayState = ({ projectName, docPath, editor }) => {
  const display = getTypesetDisplay(projectName)
  const found = display.proof && editor ? getProofIssues(docPath) : []
  return {
    spread: display.spread,
    showGrid: display.grid,
    proof: display.proof,
    proofIssues: found
      .map((issue) => {
        const anchor = readAnchor(editor, issue.from, issue.to)
        return anchor ? { id: issue.id, kind: issue.kind, page: issue.page, anchor, fixes: issue.fixes } : null
      })
      .filter(Boolean),
    paragraph: paragraphAtCaret(editor),
    projectFonts: projectFontFamilies(projectName),
  }
}

/** Pictures to the page's edges put the PDF in bleed, which the printer must be told. */
const bleedIssues = (editor) => {
  let bleeds = false
  editor?.state.doc.descendants((node) => {
    if (node.type.name === 'image' && node.attrs.layout === 'bleed') bleeds = true
    return !bleeds
  })
  return bleeds
    ? [{ id: 'interior-bleed', severity: 'note', message: 'A picture runs to the page’s edges, so the PDF is set with ⅛″ of bleed at the top, the bottom and the outside of every page. Choose “Bleed” for the interior when you upload it to KDP or IngramSpark.' }]
    : []
}

/** A book set in a project font its licence will not let a PDF or an EPUB embed. */
const fontIssues = (projectName, setup) => {
  const family = setup?.typography ? primaryFamily(setup.typography.fontFamily) : null
  const font = family ? projectFontFamilies(projectName).find((f) => f.family === family) : null
  return font && !font.embeddable
    ? [{ id: 'font-embedding', severity: 'error', message: `${family}’s licence does not allow it to be embedded, and a printer’s PDF or a store’s EPUB must embed its fonts. Set the book in another face, or get a licence that allows embedding.` }]
    : []
}

/**
 * The Publish tab's figures: the pages (as shown, or as last measured), spine, reading
 * time and preflight — for a book with a service chosen, or any document with pages.
 */
const publishingReport = ({ projectName, docPath, scope, book, setup, editor, pageCount, words }) => {
  const measured = getMeasurement(projectName, scope, docPath)
  // The pages on screen are the document's; a book's are only known once measured.
  const pages = measured?.pageCount || (scope === 'document' ? pageCount : 0)
  const allWords = measured?.words || (scope === 'document' ? words : 0)
  const target = book.publishing || { service: 'none', paper: 'cream' }
  const serviceFor = target.service === 'none' ? 'kdp' : target.service
  return {
    pageCount: pages,
    measured: Boolean(measured?.pageCount),
    words: allWords,
    readingMinutes: readingMinutes(allWords),
    spineWidthMm: pages ? Math.round(spineWidthMm({ pageCount: pages, paper: target.paper, service: serviceFor }) * 100) / 100 : 0,
    spineText: pages >= SPINE_TEXT_MIN_PAGES,
    issues: [
      ...preflight({ setup, target, pageCount: pages, images: scope === 'document' ? placedImages(editor, setup) : [] }),
      // The e-book's, once the Digital view has read it.
      ...(getEbookIssues() || []),
      ...fontIssues(projectName, setup),
      ...bleedIssues(editor),
    ],
  }
}

/**
 * A script's scenes and cast, for the Publish tab's Script Production section; none
 * for prose.
 */
export const scriptSummary = (editor, setup) => {
  const doc = editor?.state.doc
  const format = readWritingFormat(doc)
  if (!doc || format === 'prose') return undefined
  const data = breakdown(doc, printedPageAt(editor, setup) || undefined)
  return {
    format,
    sceneNumbers: readSceneNumbers(doc),
    characters: data.characters.map((c) => c.name),
    scenes: data.scenes.map((scene) => ({ number: scene.number || undefined, heading: scene.heading, page: scene.page || 0 })),
  }
}

/** A project picture as a file on disk, for a thumbnail: none for a data URI, or before the root is known. */
const fileOf = (projectRoot, path) => (projectRoot && path && !path.startsWith('data:') ? joinPath(projectRoot, path) : undefined)

/** What the shell is told of the last export: enough to say "Export Again: Book.pdf". */
const lastExportState = (last) => (last ? { format: last.format, scope: last.scope, path: last.path } : undefined)

/**
 * The state the Finishing tabs draw, for one document. Pure but for the store reads,
 * so the tests can check it without a bridge.
 */
export const buildPageLayoutState = ({ projectName, docPath, editor, chapters = [], projectRoot = null }) => {
  const scope = getPrintScope(projectName)
  const folder = bookFolderForScope(projectName, docPath)
  const book = getBookSettings(projectName, folder)
  // The book's contents as the navigator lists them, and which is selected: the one
  // chosen there, while it is still the document open — or else the document open.
  const items = reconcileBookItems(book, chapters, folder)
  const rows = bookRows(items, book.chapterNumbering)
  const chosen = rows.find((row) => row.id === getSelectedBookItem(projectName))
  const selected = chosen && (!chosen.path || chosen.path === docPath) ? chosen : rows.find((row) => row.path && row.path === docPath)
  const ownSetup = editor ? readDocPageSetup(editor.state.doc) : null
  const { setup, source } = resolvePageSetup({ docSetup: ownSetup, bookSetup: book.pageSetup })
  const { formatId, modified } = formatOf(setup)
  const result = editor ? paginationKey.getState(editor.state)?.result : null
  const pageCount = result?.pageCount || 0
  // The document's words; a book's would mean reading every chapter on each publish.
  const docWords = editor && scope === 'document' ? countEditorWords(editor) : 0
  return {
    enabled: Boolean(docPath) && isPrintLayoutEnabled(projectName, docPath),
    mode: getEditorMode(projectName),
    typesetView: getTypesetView(projectName),
    ...typesetDisplayState({ projectName, docPath, editor }),
    textStyles: textStylesOf(book),
    docPath: docPath || undefined,
    ready: Boolean(editor),
    setup,
    setupSource: source,
    hasOwnSetup: Boolean(ownSetup),
    formatId: formatId || undefined,
    formatModified: modified,
    pageCount,
    currentPage: Math.min(getCurrentPrintPage(docPath), Math.max(pageCount, 1)),
    zoom: getPrintZoom(projectName, docPath),
    scope,
    book,
    bookSetupActive: Boolean(book.pageSetup),
    bookChapters: chapters,
    bookItems: rows,
    selectedBookItem: selected?.id,
    cover: buildCoverState({ projectName, docPath, book, setup, projectRoot, showing: isShowingCover() }),
    chapterMeta: editor ? (readChapterMeta(editor.state.doc) || undefined) : undefined,
    chapterImageFile: fileOf(projectRoot, readChapterMeta(editor?.state.doc)?.image),
    ornamentImageFile: fileOf(projectRoot, book.chapterDesign?.ornamentImage),
    suggestedInsideMarginMm: suggestedInsideMarginMm(Math.max(pageCount, 1)),
    author: getAuthorProfile(),
    wordCount: docWords,
    lastExport: lastExportState(getLastExport(projectName)),
    publishing: docPath ? publishingReport({
      projectName,
      docPath,
      scope,
      book,
      // Under a book scope the book's own setup is what it prints in.
      setup: scope !== 'document' && book.pageSetup ? book.pageSetup : setup,
      editor,
      pageCount,
      words: docWords,
    }) : undefined,
    hasSelection: Boolean(editor && !editor.state.selection.empty),
    script: scriptSummary(editor, setup),
    // The cover on disk, for the Book tab's thumbnail: a project asset, once the root is known.
    coverFile: projectRoot && book.coverImage && !book.coverImage.startsWith('data:')
      ? joinPath(projectRoot, book.coverImage)
      : undefined,
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
  onMeasure,
  onOpenDoc,
  onExportAllEditions,
}) {
  // The editor that holds the active document: the pane it is open in.
  const activeTextDoc = activeDoc && isTextDoc(activeDoc) ? activeDoc : null
  const activeEditor = activeTextDoc
    ? usable(activeTextDoc === secondaryDoc && activeTextDoc !== currentDoc ? secondaryEditor : editor)
    : null
  // A pane's own controls name its document; the rest act on the active one.
  const editorFor = (docPath) => {
    if (!docPath || docPath === activeTextDoc) return activeEditor
    if (docPath === currentDoc) return usable(editor)
    if (docPath === secondaryDoc) return usable(secondaryEditor)
    return null
  }
  const stateRef = useRef({ projectName, activeTextDoc, activeEditor, editorFor, onPrint, onExport, onMeasure, onOpenDoc, onExportAllEditions })
  useEffect(() => {
    stateRef.current = { projectName, activeTextDoc, activeEditor, editorFor, onPrint, onExport, onMeasure, onOpenDoc, onExportAllEditions }
  })
  const chaptersRef = useRef({ key: '', chapters: [] })
  const rootRef = useRef({ project: null, root: null })
  const chaptersRevision = useRef(0)
  const lastSent = useRef('')
  const debounceRef = useRef(null)
  // A setup sent before the document's editor was there to take it: applied when it is.
  const pendingSetup = useRef(null)

  // Pages on or off is the window's mode now: Typeset shows every text pane as pages.
  const togglePrintLayout = useCallback((enabled) => {
    const { projectName: project } = stateRef.current
    const typeset = enabled ?? getEditorMode(project) !== 'typeset'
    setEditorMode(project, typeset ? 'typeset' : 'write')
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
    if (project && rootRef.current.project !== project) {
      rootRef.current = { project, root: null }
      getProjectRoot(project)
        .then((root) => {
          if (rootRef.current.project !== project) return
          rootRef.current.root = root
          publish()
        })
        .catch(() => {})
    }
    // The cover pictures' sizes, for their checks: read once, then published again.
    if (project) {
      loadCoverSizes(project, getBookSettings(project, folder))
        .then((read) => { if (read) publish() })
        .catch(() => {})
    }
    const state = buildPageLayoutState({
      projectName: project,
      docPath: doc,
      editor: ed,
      chapters: chaptersRef.current.chapters,
      projectRoot: rootRef.current.root,
    })
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

  // Publish on every change to what the Finishing tabs show.
  useEffect(() => {
    publish()
    // The project's fonts, read once, for the pickers and for the pages to set in.
    if (projectName) loadProjectFonts(projectName).catch(() => {})
    const unsubscribeFonts = onProjectFontsChanged(() => publish())
    const unsubscribe = subscribePrintLayoutStore(publish)
    const unsubscribePage = subscribeCurrentPrintPage(publishSoon)
    const ed = activeEditor
    if (ed) ed.on('transaction', publishSoon)
    return () => {
      unsubscribe()
      unsubscribeFonts()
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
  const zoomTo = useCallback(({ zoom, fit, docPath }) => {
    const { projectName: project, activeTextDoc: active, editorFor } = stateRef.current
    const doc = docPath || active
    const pagination = editorFor(doc)?.storage?.pagination
    const setZoom = (z) => (pagination?.zoomTo ? pagination.zoomTo(z) : setPrintZoom(z, project, doc))
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
      documentSurface.onCommand('setEditorMode', ({ mode }) => setEditorMode(stateRef.current.projectName, mode)),
      documentSurface.onCommand('setTypesetView', ({ view }) => setTypesetView(stateRef.current.projectName, view)),
      documentSurface.onCommand('setTypesetDisplay', (patch) => setTypesetDisplay(stateRef.current.projectName, patch)),
      // A typesetter's fix on a paragraph: the one a proof mark is in, or those selected.
      documentSurface.onCommand('setParagraphTypeset', ({ anchor, ...patch }) => {
        const ed = stateRef.current.activeEditor
        if (!ed) return
        const range = anchor ? resolveAnchor(ed, anchor) : { from: ed.state.selection.from, to: ed.state.selection.to }
        if (!range) return
        const tr = ed.state.tr
        if (setParagraphTypeset(tr, range.from, range.to, patch)) ed.view.dispatch(tr)
      }),
      // The book's editions: added from a preset, typeset, given a cover, exported.
      documentSurface.onCommand('editEditions', ({ action, id, name, kind, coverSetId }) => {
        const { project, folder } = currentBook()
        if (!project) return
        const apply = (versionBook = null) => {
          const stored = getStoredBook(project, folder)
          const next = editEditions(stored, { action, id, name, kind, coverSetId, versionBook, newId: `ed-${Date.now().toString(36)}` })
          if (next === stored) return
          setStoredBook(project, folder, next)
          // An e-book edition is typeset as the e-book; a print one as pages.
          if (action === 'activate' || action === 'add' || action === 'duplicate') {
            const edition = activeEditionOf(next)
            setTypesetView(project, edition && isEbookEdition(edition) ? 'digital' : 'print')
          }
        }
        if (action !== 'fromTypesetVersion') {
          apply()
          return
        }
        typesetEntries(project, folder)
          .then((entries) => apply(entries.find((e) => e.id === id)?.snapshot?.book || null))
          .catch(failed('Making an edition from that version'))
      }),
      documentSurface.onCommand('exportAllEditions', () => stateRef.current.onExportAllEditions?.()),
      // A note at the caret, opened to be written.
      documentSurface.onCommand('insertFootnote', () => {
        const ed = stateRef.current.activeEditor
        if (ed && !ed.storage.typesetLock?.locked) ed.chain().focus().insertFootnote().run()
      }),
      // A named text style on the selected paragraphs, in Write or in Typeset.
      documentSurface.onCommand('setTextStyle', ({ style }) => {
        const ed = stateRef.current.activeEditor
        if (!ed) return
        const { from, to } = ed.state.selection
        const tr = ed.state.tr
        if (setParagraphTypeset(tr, from, to, { styleName: style || null })) ed.view.dispatch(tr)
      }),
      documentSurface.onCommand('showProofIssue', ({ anchor }) => {
        const ed = stateRef.current.activeEditor
        const range = ed ? resolveAnchor(ed, anchor) : null
        if (!range) return
        const issue = getProofIssues(stateRef.current.activeTextDoc).find((i) => i.from === range.from)
        setProofFocus(issue?.id || null)
        ed.chain().setTextSelection(range).scrollIntoView().run()
      }),
      documentSurface.onCommand('addProjectFont', ({ path }) => {
        const project = stateRef.current.projectName
        if (project) addProjectFont(project, path).then(() => publish()).catch(failed('Adding the font'))
      }),
      // The Book navigator: the book's own order and contents, never the file tree's.
      documentSurface.onCommand('moveBookItem', ({ id, before }) => {
        const { project, folder } = currentBook()
        if (project) moveBookItem(project, folder, id, before).catch(failed('Moving it'))
      }),
      documentSurface.onCommand('setBookItemHidden', ({ id, hidden }) => {
        const { project, folder } = currentBook()
        if (project) setBookItemHidden(project, folder, id, hidden).catch(failed('Hiding it'))
      }),
      documentSurface.onCommand('addBookItem', (command) => {
        const { project, folder } = currentBook()
        if (!project) return
        addBookItem(project, folder, command)
          .then((item) => {
            if (!item) return
            setSelectedBookItem(project, item.id)
            // A new page of the book's is opened, to be written.
            if (item.path) stateRef.current.onOpenDoc?.(item.path)
          })
          .catch(failed('Adding it'))
      }),
      documentSurface.onCommand('removeBookItem', ({ id }) => {
        const { project, folder } = currentBook()
        if (project) removeBookItem(project, folder, id).catch(failed('Removing it'))
      }),
      documentSurface.onCommand('editBookItem', (command) => {
        const { project, folder } = currentBook()
        if (project) editBookItem(project, folder, command).catch(failed('Changing it'))
      }),
      documentSurface.onCommand('applyBookStyle', ({ id }) => {
        const style = bookStyle(id)
        const { project, folder, book } = currentBook()
        if (!style || !project) return
        const { activeEditor: ed } = stateRef.current
        const own = ed ? readDocPageSetup(ed.state.doc) : null
        const fallback = resolvePageSetup({ docSetup: own, bookSetup: book.pageSetup }).setup
        setBookSettings(project, folder, applyBookStyle(book, style, fallback))
      }),
      documentSurface.onCommand('setChapterMeta', ({ meta }) => {
        stateRef.current.activeEditor?.commands.setChapterMeta(meta)
      }),
      documentSurface.onCommand('setHeadImage', ({ target, path }) => {
        const { project, folder } = currentBook()
        if (!project) return
        const apply = (image) => {
          if (target === 'chapter') {
            const ed = stateRef.current.activeEditor
            if (!ed) return
            const meta = readChapterMeta(ed.state.doc) || { subtitle: '', epigraph: '', epigraphSource: '' }
            ed.commands.setChapterMeta({ ...meta, image: image || undefined })
            return
          }
          const book = getBookSettings(project, folder)
          const design = { ...book.chapterDesign }
          if (image) {
            design.ornamentImage = image
            design.ornament = 'image'
          } else {
            delete design.ornamentImage
            if (design.ornament === 'image') design.ornament = 'none'
          }
          setBookSettings(project, folder, { ...book, chapterDesign: design })
        }
        if (!path) {
          apply(null)
          return
        }
        // Copied into the project, so the book keeps the picture wherever the file was.
        importAssetFromPath(project, path).then(apply).catch(failed('Setting the picture'))
      }),
      documentSurface.onCommand('setFolderBookOptions', ({ folder, numberInTree, startAt, continuous }) => {
        const project = stateRef.current.projectName
        if (!project) return
        const book = getBookSettings(project, folder)
        const numbering = { ...book.chapterNumbering }
        if (numberInTree !== undefined) numbering.showInTree = Boolean(numberInTree)
        if (startAt !== undefined) numbering.startAt = startAt === 0 ? 0 : 1
        setBookSettings(project, folder, {
          ...book,
          chapterNumbering: numbering,
          ...(continuous !== undefined ? { continuous: Boolean(continuous) } : {}),
        })
      }),
      documentSurface.onCommand('setCoverImage', ({ setId, part, path }) => {
        const { project, folder } = currentBook()
        if (!project) return
        const apply = (image) => {
          let book = withCoverPart(getBookSettings(project, folder), part, image, setId || undefined)
          // A spine or a wrap is made for the spine the book has now: say so, to notice
          // when the page count moves it.
          if (image && (part === 'spine' || part === 'wrap')) {
            const { spineMm } = bookSpine(project, stateRef.current.activeTextDoc, book)
            if (spineMm) {
              const id = setId || book.activeCover
              book = { ...book, covers: book.covers.map((c) => (c.id === id ? { ...c, madeForSpineMm: spineMm } : c)) }
            }
          }
          setBookSettings(project, folder, book)
        }
        if (!path) apply(null)
        else importAssetFromPath(project, path).then(apply).catch(failed('Setting the cover'))
      }),
      documentSurface.onCommand('editCoverSets', (command) => {
        const { project, folder } = currentBook()
        if (!project) return
        setBookSettings(project, folder, editCovers(getBookSettings(project, folder), { ...command, newId: `cover-${newItemId()}` }))
      }),
      documentSurface.onCommand('openBookItem', ({ id }) => {
        const { project, folder } = currentBook()
        if (!project) return
        // The cover is not a page of the book: it has a view of its own.
        setShowingCover(id === 'cover')
        if (id === 'cover') return
        setSelectedBookItem(project, id)
        openablePath(project, folder, id)
          .then((path) => { if (path) stateRef.current.onOpenDoc?.(path) })
          .catch(failed('Opening it'))
      }),
      documentSurface.onCommand('setPrintLayout', ({ enabled, docPath }) => togglePrintLayout(enabled, docPath)),
      documentSurface.onCommand('setPageSetup', ({ setup, target }) => applySetup(setup, target)),
      documentSurface.onCommand('applyFormat', ({ formatId, target }) => {
        const setup = applyFormat(formatId)
        if (!setup) return
        applySetup(setup, target)
        // A script's format makes the document a script: its lines become elements.
        const writing = writingFormatOf(formatId)
        const ed = stateRef.current.activeEditor
        if (writing && target !== 'book' && ed) ed.commands.setWritingFormat(writing)
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
        window.dispatchEvent(new CustomEvent(BOOK_CHAPTERS_CHANGED_EVENT))
      }),
      documentSurface.onCommand('setAuthorProfile', ({ profile }) => setAuthorProfile(profile)),
      documentSurface.onCommand('setBookCover', ({ path }) => {
        const { project, folder, book } = currentBook()
        if (!project) return
        if (!path) {
          setBookSettings(project, folder, withCoverPart(book, 'front', null))
          return
        }
        // Copied into the project, so the book keeps its cover wherever the file was.
        importAssetFromPath(project, path)
          .then((front) => setBookSettings(project, folder, withCoverPart(getBookSettings(project, folder), 'front', front)))
          .catch((error) => console.error('Setting the cover failed:', error))
      }),
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
      documentSurface.onCommand('printDocument', ({ scope, bound, options }) => {
        stateRef.current.onPrint?.({ scope, bound, options })
      }),
      documentSurface.onCommand('exportDocument', ({ format, scope, bound, options }) => {
        stateRef.current.onExport?.({ format, scope, bound, options })
      }),
      documentSurface.onCommand('measureBook', () => {
        const { projectName: project } = stateRef.current
        stateRef.current.onMeasure?.({ scope: getPrintScope(project) })
      }),
      documentSurface.onCommand('setSceneNumbers', ({ mode }) => {
        stateRef.current.activeEditor?.chain().focus().setSceneNumbers(mode).run()
      }),
      documentSurface.onCommand('scriptReport', ({ report, output }) => {
        const { activeEditor: ed, activeTextDoc: path } = stateRef.current
        if (output === 'print') stateRef.current.onPrint?.({ scope: 'document', bound: false, options: { report } })
        else saveScriptReport({ editor: ed, docPath: path, report }).catch((error) => console.error('[report] failed:', error))
      }),
      // File ▸ Import Fountain Script…: the pane holding the tree does it (EditorLayout).
      documentSurface.onCommand('importScript', () => window.dispatchEvent(new CustomEvent('inkblot:import-script'))),
      documentSurface.onCommand('exportAgain', () => {
        const last = getLastExport(stateRef.current.projectName)
        if (last) stateRef.current.onExport?.(last)
      }),
    ]
    return () => subscriptions.forEach((unsubscribe) => unsubscribe())
  }, [applySetup, currentBook, publish, togglePrintLayout, zoomTo])

  // The typeset history: kept as the book is set, restored, previewed.
  useTypesetHistory({ stateRef, currentBook, activeEditor })

  // A page of another entry, clicked in the Typeset view of the whole book.
  useEffect(() => {
    const onOpenItem = (event) => {
      const { project, folder } = currentBook()
      const id = event.detail?.id
      if (!project || !id) return
      setShowingCover(false)
      setSelectedBookItem(project, id)
      openablePath(project, folder, id)
        .then((path) => { if (path) stateRef.current.onOpenDoc?.(path) })
        .catch(failed('Opening it'))
    }
    window.addEventListener(OPEN_BOOK_ITEM_EVENT, onOpenItem)
    return () => window.removeEventListener(OPEN_BOOK_ITEM_EVENT, onOpenItem)
  }, [currentBook])

  // The web's own menus (App.jsx, and the Swift shell's mirror of them) and keys.
  useEffect(() => {
    const onToggle = (event) => togglePrintLayout(undefined, event?.detail?.docPath)
    const onPrintEvent = (event) => stateRef.current.onPrint?.({ scope: 'document', bound: false, ...(event.detail || {}) })
    const onExportEvent = (event) => stateRef.current.onExport?.({ scope: 'document', bound: false, ...(event.detail || {}) })
    // ⌥⌘P toggles pages, as it does in Word; ⌘P prints.
    const onKeyDown = (event) => {
      if (!event.metaKey || event.ctrlKey || event.shiftKey || event.code !== 'KeyP') return
      event.preventDefault()
      if (event.altKey) togglePrintLayout()
      else stateRef.current.onPrint?.({ scope: 'document', bound: false })
    }
    // File ▸ Write As, in a shell whose menus are the page's (DocWritingFormat.js).
    const onWritingFormat = (event) => {
      stateRef.current.activeEditor?.chain().focus().setWritingFormat(event.detail?.format).run()
    }
    window.addEventListener('inkblot:writing-format', onWritingFormat)
    window.addEventListener('inkblot:print-layout-toggle', onToggle)
    window.addEventListener('inkblot:print', onPrintEvent)
    window.addEventListener('inkblot:export', onExportEvent)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('inkblot:writing-format', onWritingFormat)
      window.removeEventListener('inkblot:print-layout-toggle', onToggle)
      window.removeEventListener('inkblot:print', onPrintEvent)
      window.removeEventListener('inkblot:export', onExportEvent)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [togglePrintLayout])

  const pageCount = activeEditor ? paginationKey.getState(activeEditor.state)?.result?.pageCount || 0 : 0
  return { togglePrintLayout, zoomTo, applySetup, activeEditor, activeTextDoc, pageCount }
}

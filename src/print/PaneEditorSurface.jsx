/**
 * PaneEditorSurface.jsx — a text pane's scroll area: the continuous editor, or the
 * same editor as pages.
 *
 * EditorCanvas renders one of these per text pane. Which view it shows is the
 * document's own view state (printLayoutStore), so each pane — and each document in
 * it — remembers whether it was being read as pages. The <EditorContent> is mounted
 * in both cases, and in the same place in the tree relative to the editor, so
 * switching views never recreates the editor: selection, undo history and every
 * node view survive the switch.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { EditorContent } from '@tiptap/react'

import BookPages from './BookPages'
import ContinuousStack from './ContinuousStack'
import CoverView from './CoverView'
import DigitalPreview from './DigitalPreview'
import { setLiveHead } from './ChapterHeadDecorations'
import { readChapterMeta } from './DocChapterMeta'
import PrintLayoutView from './PrintLayoutView'
import TypesetEditText from './TypesetEditText'
import FootnoteEditor from './FootnoteEditor'
import { isMatterPath } from './TypesetLock'
import { useBookPlacement } from './useBookPlacement'
import { useProof } from './useProof'
import { compositionOf } from './typography'
import { applyTextStyleSheet, textStylesOf } from './textStyles'
import { notesOptionsOf } from './notes'
import { TypesetToast } from './TypesetOverlay'
import { readDocPageSetup } from './DocPageSetup'
import { documentSurface } from '../bridge'
import { assetUrl, isAssetPath, writeAssetFromFile } from '../lib/assets'
import { useDocPageSetup } from './useDocPageSetup'
import { bookAuthor, getBookForDoc, getBookSettings, getPrintZoom, getTypesetDisplay, getTypesetView, isPrintLayoutEnabled, isShowingCover, isTypesetMode, setBookSettings, setPrintZoom, usePrintLayoutStore } from './printLayoutStore'
import { resolvePageSetup } from './pageSetup'

/**
 * The book's setup, when the document has none of its own to show instead — as JSON,
 * because the store parses a fresh object on every read and a memo keyed on that
 * would lay the pages out again on every render.
 */
const bookSetupJson = (projectName, docPath, ownSetup) => {
  if (ownSetup || !projectName || !docPath) return ''
  const setup = getBookForDoc(projectName, docPath).pageSetup
  return setup ? JSON.stringify(setup) : ''
}

const baseName = (path) => (path || '').split('/').filter(Boolean).pop() || ''

/** URLs the page can show for project pictures, by their stored paths. */
const useAssetUrls = (projectName, sources) => {
  const wanted = sources.filter((src) => typeof src === 'string' && isAssetPath(src))
  const key = wanted.join('|')
  const [urls, setUrls] = useState(() => new Map())
  useEffect(() => {
    if (!projectName || !wanted.length) return undefined
    let live = true
    Promise.all(wanted.map(async (src) => [src, await assetUrl(projectName, src)]))
      .then((pairs) => { if (live) setUrls(new Map(pairs)) })
      .catch(() => {})
    return () => { live = false }
  }, [projectName, key]) // eslint-disable-line react-hooks/exhaustive-deps -- `key` names `wanted`
  return urls
}

export default function PaneEditorSurface({ editor, projectName, docPath, header = null, scrollRef, onOpenDoc }) {
  usePrintLayoutStore()
  const [scrollEl, setScrollEl] = useState(null)
  const ownSetup = useDocPageSetup(editor)
  // A chapter with no setup of its own shows its book's, as the book will print it.
  const bookJson = bookSetupJson(projectName, docPath, ownSetup)
  const pageSetup = useMemo(
    () => resolvePageSetup({ docSetup: ownSetup, bookSetup: bookJson ? JSON.parse(bookJson) : null }).setup,
    [ownSetup, bookJson]
  )
  // Pages show in Typeset, and in Write's page view — where the prose is written on
  // them, as the document's own pages, with none of Typeset's book around it.
  const printLayout = Boolean(editor) && isPrintLayoutEnabled(projectName, docPath)
  const typesetting = printLayout && isTypesetMode(projectName)
  // In Typeset, the e-book as a reader shows it, in place of the pages.
  const digital = typesetting && getTypesetView(projectName) === 'digital'
  // In Typeset a chapter's prose is locked — it is written in Write — and the book's own
  // pages, its front and back matter, are not: they are only ever edited here.
  const locked = typesetting && !isMatterPath(docPath)
  useEffect(() => {
    if (editor && !editor.isDestroyed && editor.storage.typesetLock) editor.storage.typesetLock.locked = locked
  }, [editor, locked])
  // Where the document sits in its book: in Typeset, a chapter is shown among the book's
  // pages, opening with its designed head.
  const placement = useBookPlacement(editor ? projectName : null, editor ? docPath : null)
  const row = placement?.row
  const inBook = Boolean(typesetting && row && !row.hidden)
  const design = placement?.book?.chapterDesign
  const headed = inBook && row.kind === 'chapter' && design
  const meta = headed ? readChapterMeta(editor?.state.doc) : null
  const images = useAssetUrls(projectName, headed ? [design.ornamentImage, meta?.image] : [])
  useEffect(() => {
    setLiveHead(editor, headed
      ? { design, label: row.label || null, name: baseName(docPath), imageUrl: (src) => images.get(src) || src }
      : null)
  }, [design, docPath, editor, headed, images, row?.label])
  // The book's named text styles, as it sets them.
  const textStylesJson = printLayout && placement ? JSON.stringify(textStylesOf(placement.book)) : ''
  useEffect(() => {
    if (textStylesJson) applyTextStyleSheet(JSON.parse(textStylesJson))
  }, [textStylesJson])
  // What the page's handles change, in Typeset.
  const [toast, setToast] = useState(null)
  const typeset = useMemo(() => {
    if (!typesetting || !editor || !placement) return null
    const { folder } = placement
    const book = placement.book
    const editBook = (change, label) => {
      const before = getBookSettings(projectName, folder)
      setBookSettings(projectName, folder, change(before))
      setToast({ label, before, folder })
    }
    return {
      design: headed ? design : null,
      numbering: book.chapterNumbering,
      editBook,
      editDesign: (patch, label) => editBook((b) => ({ ...b, chapterDesign: { ...b.chapterDesign, ...patch } }), label),
      // The document's own setup where it has one — undone like any edit — or the book's.
      editSetup: (next, label) => {
        if (readDocPageSetup(editor.state.doc)) editor.commands.setPageSetup(next)
        else editBook((b) => ({ ...b, pageSetup: next }), label)
      },
      setHeadPicture: (file) => {
        writeAssetFromFile(projectName, file)
          .then((image) => {
            const current = readChapterMeta(editor.state.doc) || { subtitle: '', epigraph: '', epigraphSource: '' }
            editor.commands.setChapterMeta({ ...current, image })
            if (design && !design.showImage) editBook((b) => ({ ...b, chapterDesign: { ...b.chapterDesign, showImage: true } }), 'Chapter picture')
          })
          .catch((error) => console.error('[typeset] the picture could not be added:', error))
      },
      focus: (sectionId) => documentSurface.publishTypesetFocus({ sectionId }),
    }
  }, [design, editor, headed, placement, typesetting, projectName])
  // How Typeset shows the pages: in spreads (the whole book, still), with the grid,
  // with the proof's marks — which are read off the live pages.
  const typesetDisplay = getTypesetDisplay(projectName)
  const display = typesetting ? typesetDisplay : { ...typesetDisplay, spread: false, grid: false, proof: false }
  const showingCover = typesetting && placement && isShowingCover()
  const spread = inBook && display.spread && !digital && !showingCover
  useProof({
    editor,
    docPath,
    active: Boolean(typesetting && display.proof && !digital && !spread && !showingCover),
    hyphenLimit: compositionOf(pageSetup.typography).hyphenLimitLines,
  })
  // Where the book sets its notes, and how it marks them.
  const bookNotes = notesOptionsOf(placement?.book || (projectName && docPath ? getBookForDoc(projectName, docPath) : null))
  const notesView = useMemo(
    () => ({ footnotes: bookNotes.placement === 'page', marks: bookNotes.marks }),
    [bookNotes.placement, bookNotes.marks]
  )
  const zoom = getPrintZoom(projectName, docPath)
  const onZoomChange = useCallback((z) => setPrintZoom(z, projectName, docPath), [projectName, docPath])
  const author = projectName && docPath ? bookAuthor(getBookForDoc(projectName, docPath)) : ''

  const setScroll = useCallback((el) => {
    setScrollEl(el)
    if (typeof scrollRef === 'function') scrollRef(el)
    else if (scrollRef) scrollRef.current = el
  }, [scrollRef])

  const editorContent = editor ? <EditorContent editor={editor} className="editor" /> : null
  // In Write, a folder read as one document: its other documents above and below.
  const continuous = !printLayout && editor && placement?.book?.continuous && placement.row && placement.row.kind === 'chapter'
  const content = continuous ? (
    <ContinuousStack
      projectName={projectName}
      docPath={docPath}
      editor={editor}
      placement={placement}
      scrollEl={scrollEl}
      onOpenDoc={onOpenDoc}
    >
      {editorContent}
    </ContinuousStack>
  ) : editorContent
  const pageContent = editorContent

  return (
    <div
      ref={setScroll}
      className={`pane-scroll${printLayout ? ' is-print-layout' : ''}${locked ? ' is-typeset-locked' : ''}${digital ? ' is-digital' : ''}`}
      tabIndex={printLayout ? -1 : undefined}
    >
      {header}
      <TypesetEditText editor={editor} projectName={projectName} docPath={docPath} typesetting={typesetting} />
      <FootnoteEditor editor={editor} locked={locked} />
      {showingCover ? (
        <CoverView projectName={projectName} docPath={docPath} folder={placement.folder} setup={pageSetup} />
      ) : digital ? (
        <DigitalPreview projectName={projectName} docPath={docPath} editor={editor} placement={inBook ? placement : null} />
      ) : printLayout && inBook ? (
        <BookPages
          projectName={projectName}
          docPath={docPath}
          editor={editor}
          placement={placement}
          zoom={zoom}
          scrollEl={scrollEl}
          spread={spread}
          showGrid={display.grid}
          setup={pageSetup}
          renderLive={({ firstPhysical, folioStart, noteStart, author: bookBy, bookTitle }) => (
            <PrintLayoutView
              editor={editor}
              pageSetup={pageSetup}
              docPath={docPath}
              zoom={zoom}
              onZoomChange={onZoomChange}
              docTitle={bookTitle || baseName(docPath)}
              author={bookBy || author}
              scrollEl={scrollEl}
              statusHost={scrollEl?.parentElement || null}
              firstPhysical={firstPhysical}
              folioStart={folioStart}
              typeset={typeset}
              showGrid={display.grid}
              notes={{ ...notesView, start: noteStart }}
            >
              {pageContent}
            </PrintLayoutView>
          )}
        />
      ) : printLayout ? (
        <PrintLayoutView
          editor={editor}
          pageSetup={pageSetup}
          docPath={docPath}
          zoom={zoom}
          onZoomChange={onZoomChange}
          docTitle={baseName(docPath)}
          author={author}
          scrollEl={scrollEl}
          // The pane, not the scroller: the zoom bar stays put while the pages scroll.
          statusHost={scrollEl?.parentElement || null}
          typeset={typeset}
          showGrid={display.grid}
          notes={notesView}
        >
          {pageContent}
        </PrintLayoutView>
      ) : content}
      <TypesetToast
        toast={toast}
        onUndo={() => {
          if (toast) setBookSettings(projectName, toast.folder, toast.before)
          setToast(null)
        }}
        onDone={() => setToast(null)}
      />
    </div>
  )
}

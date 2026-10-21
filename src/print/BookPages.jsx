/**
 * BookPages.jsx — the whole book, as pages, in Typeset.
 *
 * The document open is live — its pages are the editor, with the typesetting handles —
 * and the rest of the book stands before and after it as the pages it prints on: the
 * same pages Print makes (`preparePrint`), cut from the book as it compiles, so the front
 * matter, every chapter's head, each folio and running head are what paper will show.
 * The live chapter sits among them on the side of the spread it opens on, numbered on
 * from the page before it.
 *
 * The book is composed again, in the background, a moment after anything changes it —
 * its design, its contents, the page count of the chapter being set. Until it has been,
 * the pages already shown stay; the live chapter is held still on screen as the pages
 * before it change. Clicking a page of another entry opens it.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { PAGE_GAP } from './printLayoutConstants'
import { pageLeftMargin, pageMetrics } from './pageSetup'
import { preparePrint } from './printJob'
import { baselineGridStyle } from './typography'
import { snapToDevicePixel } from './zoom'
import { bookAuthor, getPrintScope, getTypesetPreview, setTypesetDisplay, usePrintLayoutStore } from './printLayoutStore'
import { previewBook, previewContent, TYPESET_PREVIEW_EVENT } from './useTypesetHistory'

/** How long after a change the book is composed again. */
const COMPOSE_DELAY_MS = 900

/** The event a click on another entry's page sends; the controller opens it. */
export const OPEN_BOOK_ITEM_EVENT = 'inkblot:open-book-item'

/** A page as the pages show it: at its trim, without the bleed a printer is sent. */
const trimmed = (page) => {
  if (!page.classList.contains('has-bleed')) return page
  const inner = page.firstElementChild
  Object.assign(inner.style, { position: 'relative', left: '', top: '', overflow: 'hidden' })
  return inner
}

/**
 * Pages `fill` puts in, laid out at their real size and scaled by the zoom, as the live
 * chapter's stage is. Not CSS `zoom`: under it WebKit holds type to a minimum size, so
 * zoomed out, a page's text grew against the page and ran off its lines.
 */
function ZoomedPages({ className, zoom, fill, style, onOpen }) {
  const ref = useRef(null)
  // The pages' size unscaled; the box they take on the desk is this times the zoom.
  const [size, setSize] = useState(null)
  useLayoutEffect(() => {
    const host = ref.current
    if (!host) return
    fill(host)
    setSize({ width: host.offsetWidth, height: host.offsetHeight })
  }, [fill])
  const onClick = (event) => {
    const item = event.target.closest?.('.book-page')?.dataset.item
    if (item) onOpen(item)
  }
  return (
    <div
      className={`book-zoomed ${className} print-scope`}
      style={size ? { width: `${snapToDevicePixel(size.width * zoom)}px`, height: `${snapToDevicePixel(size.height * zoom)}px` } : undefined}
      onClick={onClick}
      role="presentation"
    >
      <div ref={ref} className="book-zoomed-pages" style={{ ...style, transform: `scale(${zoom})` }} />
    </div>
  )
}

/** Printed pages, shown at the zoom, one under the other. */
function PageStack({ pages, zoom, onOpen }) {
  const fill = useCallback((host) => {
    host.replaceChildren(...pages.map((page) => {
      const frame = document.createElement('div')
      frame.className = 'book-page'
      frame.dataset.item = page.dataset.item || ''
      frame.appendChild(page)
      return frame
    }))
  }, [pages])
  if (!pages.length) return null
  return (
    <ZoomedPages
      className="book-pages-stack"
      zoom={zoom}
      fill={fill}
      style={{ gap: `${PAGE_GAP}px`, paddingBottom: `${PAGE_GAP}px` }}
      onOpen={onOpen}
    />
  )
}

/**
 * The whole book as it opens: the first page alone on the right, then each verso beside
 * its recto — still pages, copied, so the stacks keep theirs. With the grid, each text
 * block ruled at the leading.
 */
function SpreadStack({ pages, zoom, setup, showGrid, onOpen }) {
  const fill = useCallback((host) => {
    const metrics = setup ? pageMetrics(setup) : null
    const grid = showGrid && setup?.typography ? baselineGridStyle(setup.typography) : null
    const frameFor = (page, physical) => {
      const frame = document.createElement('div')
      frame.className = `book-page ${physical % 2 ? 'is-recto' : 'is-verso'}`
      if (!page) {
        frame.classList.add('is-empty')
        frame.style.width = `${metrics?.width || 0}px`
        return frame
      }
      frame.dataset.item = page.dataset.item || ''
      frame.appendChild(page.cloneNode(true))
      if (grid && metrics) {
        const lines = document.createElement('div')
        lines.className = 'book-page-grid'
        Object.assign(lines.style, grid, {
          left: `${pageLeftMargin(setup, physical)}px`,
          top: `${metrics.contentTop}px`,
          width: `${metrics.contentWidth}px`,
          height: `${metrics.contentHeight}px`,
        })
        frame.appendChild(lines)
      }
      return frame
    }
    const rows = []
    // Page 1 is a recto: it faces nothing.
    for (let i = -1; i < pages.length; i += 2) {
      const row = document.createElement('div')
      row.className = 'book-spread'
      row.append(frameFor(pages[i] || null, i + 1), frameFor(pages[i + 1] || null, i + 2))
      rows.push(row)
    }
    host.replaceChildren(...rows)
  }, [pages, setup, showGrid])
  return <ZoomedPages className="book-spreads" zoom={zoom} fill={fill} style={{ gap: `${PAGE_GAP}px` }} onOpen={onOpen} />
}

export default function BookPages({ projectName, docPath, editor, placement, zoom, scrollEl, spread = false, showGrid = false, setup = null, renderLive }) {
  const version = usePrintLayoutStore()
  const [composed, setComposed] = useState({ before: [], after: [], all: [], firstPhysical: 1, folioStart: null, busy: true })
  // The current book whole, while comparing it with a version.
  const [composedAll, setComposedAll] = useState(null)
  const runRef = useRef(0)
  const timerRef = useRef(null)
  const liveRef = useRef(null)
  const anchorRef = useRef(null)
  const itemId = placement?.row?.id
  // A typeset version previewed: the whole book as that version set it, and — to
  // compare — beside it as it is now.
  const preview = getTypesetPreview()
  const [previewPages, setPreviewPages] = useState(null)

  useEffect(() => {
    if (!preview) {
      setPreviewPages(null)
      return undefined
    }
    let live = true
    const scope = getPrintScope(projectName) === 'project' ? 'project' : 'folder'
    preparePrint({
      projectName,
      docPath,
      scope,
      book: previewBook(placement.book, preview.snapshot),
      liveEditors: [{ path: docPath, editor }],
      mapContent: previewContent(preview.snapshot),
    })
      .then((prepared) => { if (live) setPreviewPages((prepared?.elements || []).map(trimmed)) })
      .catch((error) => console.error('[typeset] previewing failed:', error))
    return () => { live = false }
  }, [preview?.id, preview?.snapshot, projectName, docPath]) // eslint-disable-line react-hooks/exhaustive-deps -- keyed on the preview; the placement and editor are read as they stand then

  const compose = useCallback(async () => {
    const run = ++runRef.current
    setComposed((c) => ({ ...c, busy: true }))
    try {
      const scope = getPrintScope(projectName) === 'project' ? 'project' : 'folder'
      const prepared = await preparePrint({
        projectName,
        docPath,
        scope,
        book: placement.book,
        liveEditors: [{ path: docPath, editor }],
      })
      if (run !== runRef.current) return
      const pages = (prepared?.elements || []).map(trimmed)
      if (preview?.compare) setComposedAll(pages)
      const first = pages.findIndex((page) => page.dataset.item === itemId)
      // Notes numbered on through the book: the live chapter's first is one past those
      // before it — each counted once, though a paragraph over a page shows twice.
      const noteStart = (() => {
        if (placement.book?.notes?.numbering !== 'continuous' || first <= 0) return 1
        const ids = new Set()
        for (const page of pages.slice(0, first)) {
          for (const ref of page.querySelectorAll('.footnote-ref[data-footnote]')) ids.add(ref.dataset.footnote)
        }
        return ids.size + 1
      })()
      let last = first
      while (last + 1 < pages.length && (pages[last + 1].dataset.item === itemId || !pages[last + 1].dataset.item)) last += 1
      // A blank page the book puts before the chapter to open it on a recto is the
      // chapter's own side of the spread: it stays with the pages before.
      setComposed(first < 0
        ? { before: pages, after: [], all: pages, firstPhysical: 1, folioStart: null, noteStart: 1, busy: false }
        : {
          all: pages,
          noteStart,
          before: pages.slice(0, first),
          after: pages.slice(last + 1),
          firstPhysical: first + 1,
          folioStart: Number(pages[first].dataset.page) || null,
          busy: false,
        })
    } catch (error) {
      if (run === runRef.current) setComposed((c) => ({ ...c, busy: false }))
      console.error('[typeset] composing the book failed:', error)
    }
  }, [docPath, editor, itemId, placement, preview?.compare, projectName])

  const schedule = useCallback((delay = COMPOSE_DELAY_MS) => {
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(compose, delay)
  }, [compose])

  // Again whenever the book or the document changes; soon at first.
  useEffect(() => {
    schedule(200)
    return () => clearTimeout(timerRef.current)
  }, [schedule, version])

  useEffect(() => {
    if (!editor) return undefined
    const onTransaction = ({ transaction }) => { if (transaction.docChanged) schedule() }
    editor.on('transaction', onTransaction)
    return () => editor.off('transaction', onTransaction)
  }, [editor, schedule])

  // The live chapter holds still on screen while the pages before it change. Not when
  // the zoom moved it: the zoom keeps its own place (PrintLayoutView's settle).
  useLayoutEffect(() => {
    const live = liveRef.current
    if (!live || !scrollEl) return
    const top = live.offsetTop
    const last = anchorRef.current
    if (last && last.zoom === zoom && last.top !== top) scrollEl.scrollTop += top - last.top
    anchorRef.current = { top, zoom }
  }, [composed.before, scrollEl, zoom])

  const open = useCallback((id) => {
    if (id && id !== itemId) window.dispatchEvent(new CustomEvent(OPEN_BOOK_ITEM_EVENT, { detail: { id } }))
  }, [itemId])

  if (preview) {
    const act = (action) => window.dispatchEvent(new CustomEvent(TYPESET_PREVIEW_EVENT, { detail: { action } }))
    return (
      <div className="book-pages is-previewing">
        <div className="book-preview-bar" role="toolbar" aria-label="Previewing a typeset version">
          <span>{preview.compare ? 'Comparing' : 'Previewing'} {preview.name ? `“${preview.name}”` : 'an earlier typeset'}</span>
          <button type="button" onClick={() => act('restore')}>Restore</button>
          <button type="button" onClick={() => act('done')}>Done</button>
        </div>
        <div className={preview.compare ? 'book-compare' : ''}>
          <div>
            {preview.compare ? <div className="book-compare-label">That version</div> : null}
            {previewPages ? <PageStack pages={previewPages} zoom={preview.compare ? zoom * 0.5 : zoom} onOpen={() => {}} /> : <div className="book-pages-status">Setting that version…</div>}
          </div>
          {preview.compare ? (
            <div>
              <div className="book-compare-label">Now</div>
              <PageStack pages={composedAll || [...composed.before, ...composed.after]} zoom={zoom * 0.5} onOpen={() => {}} />
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  if (spread) {
    return (
      <div className="book-pages is-spreads">
        <SpreadStack
          pages={composed.all}
          zoom={zoom}
          setup={setup}
          showGrid={showGrid}
          onOpen={(id) => {
            // A page picked in the spreads is worked on as a page.
            setTypesetDisplay(projectName, { spread: false })
            open(id)
          }}
        />
        {composed.busy ? <div className="book-pages-status" aria-live="polite">Setting the book…</div> : null}
      </div>
    )
  }

  return (
    <div className="book-pages">
      <PageStack pages={composed.before} zoom={zoom} onOpen={open} />
      <div ref={liveRef} className="book-pages-live">
        {renderLive({ firstPhysical: composed.firstPhysical, folioStart: composed.folioStart, noteStart: composed.noteStart || 1, author: bookAuthor(placement.book), bookTitle: placement.book.title })}
      </div>
      <PageStack pages={composed.after} zoom={zoom} onOpen={open} />
      {composed.busy ? <div className="book-pages-status" aria-live="polite">Setting the book…</div> : null}
    </div>
  )
}

/**
 * PrintLayoutView.jsx — the pane's editor, shown as the pages it will print on.
 *
 * Wraps the pane's live <EditorContent> (passed as children) in a stage laid out in
 * real units and scaled by the zoom, draws the paper, running heads and gap masks
 * around it from the pagination plugin's result, and hands the plugin its frame.
 * The editor is the same instance as in the continuous view: every node view,
 * toolbar command, note and drag keeps working, because nothing about it changes
 * but its width and the pushes the plugin decorates it with.
 *
 * With more than one column the live editor is a *galley*: it flows at the column
 * width through one slot per column, each drawn as its own strip, so every column
 * of every page is still edited in place. The composed page, with its columns side
 * by side, is what Print Preview and print show.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { paginationKey } from './PaginationExtension'
import {
  formatPageNumber,
  isRecto,
  normalizePageSetup,
  pageLeftMargin,
  pageMetrics,
  runningTextFor,
} from './pageSetup'
import { clampZoom, fitPageZoom, fitWidthZoom, ZOOM_STEPS } from './zoom'
import { PAGE_GAP } from './printLayoutConstants'
import { nativeOwns } from '../lib/host'
import './PrintLayout.css'

const EMPTY_RESULT = { pageCount: 1, slotCount: 1, slotStarts: [0], chapterStartSlots: [0], pushes: [] }

/** Top-level H1s, in order, as { pos, text }: the chapter titles running heads show. */
const chapterHeadings = (doc) => {
  const out = []
  doc.forEach((node, pos) => {
    if (node.type.name === 'heading' && node.attrs.level === 1) out.push({ pos, text: node.textContent })
  })
  return out
}

const chapterAt = (headings, pos, fallback) => {
  let text = fallback
  for (const h of headings) {
    if (h.pos > pos) break
    if (h.text) text = h.text
  }
  return text
}

export default function PrintLayoutView({
  editor,
  pageSetup,
  zoom,
  onZoomChange,
  docTitle = '',
  author = '',
  scrollEl,
  statusHost,
  showGuides = false,
  children,
}) {
  const setup = useMemo(() => normalizePageSetup(pageSetup), [pageSetup])
  const metrics = useMemo(() => pageMetrics(setup), [setup])
  const [result, setResult] = useState(EMPTY_RESULT)
  const [currentPage, setCurrentPage] = useState(1)
  const [headings, setHeadings] = useState([])
  const zoomRef = useRef(zoom)
  const galley = setup.columns > 1

  useEffect(() => {
    zoomRef.current = zoom
  }, [zoom])

  // In a galley each column is its own strip, a page's height apart.
  const slotStride = metrics.height + PAGE_GAP
  const frame = useMemo(() => ({
    slotHeight: metrics.contentHeight,
    stride: slotStride,
    columns: setup.columns,
    minLines: setup.widowOrphanLines,
  }), [metrics.contentHeight, slotStride, setup.columns, setup.widowOrphanLines])

  // Hand the plugin its frame; take it back when the view goes.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return undefined
    editor.commands.setPaginationFrame(frame)
    return () => {
      if (!editor.isDestroyed) editor.commands.setPaginationFrame(null)
    }
  }, [editor, frame])

  // Follow the plugin's result.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return undefined
    const read = () => {
      const state = paginationKey.getState(editor.state)
      setResult(state?.result || EMPTY_RESULT)
      setHeadings(chapterHeadings(editor.state.doc))
    }
    read()
    editor.on('transaction', read)
    return () => editor.off('transaction', read)
  }, [editor])

  // Mirrored margins move the text block left and right between recto and verso.
  // The live text column cannot move per page, so the paper does instead: each
  // sheet sits so its own margin lands on the column.
  const rectoLeft = pageLeftMargin(setup, 1)
  const versoLeft = pageLeftMargin(setup, 2)
  const flowX = Math.max(rectoLeft, versoLeft)
  const stageWidth = metrics.width + Math.abs(rectoLeft - versoLeft)
  const slots = Math.max(result.slotCount, 1)
  const stripCount = galley ? slots : Math.max(result.pageCount, 1)
  const stageHeight = stripCount * slotStride - PAGE_GAP

  const pages = useMemo(() => {
    const out = []
    const chapterStarts = new Set(result.chapterStartSlots)
    for (let strip = 0; strip < stripCount; strip += 1) {
      const pageIndex = galley ? Math.floor(strip / setup.columns) : strip
      const physical = pageIndex + 1
      const firstSlot = pageIndex * setup.columns
      const pageSlots = result.slotStarts.slice(firstSlot, firstSlot + setup.columns)
      const blank = pageIndex > 0 && pageSlots.every((s) => s == null)
      const startPos = pageSlots.find((s) => s != null) ?? 0
      const ctx = {
        page: setup.pageNumberStart + pageIndex,
        pages: setup.pageNumberStart + Math.max(result.pageCount, 1) - 1,
        title: docTitle,
        chapter: chapterAt(headings, startPos, docTitle),
        author,
      }
      const flags = { chapterFirstPage: chapterStarts.has(firstSlot), blank }
      out.push({
        strip,
        physical,
        column: galley ? strip % setup.columns : 0,
        left: flowX - pageLeftMargin(setup, physical),
        top: strip * slotStride,
        blank,
        header: runningTextFor(setup, 'header', physical, ctx, flags),
        footer: runningTextFor(setup, 'footer', physical, ctx, flags),
        folio: formatPageNumber(ctx.page, setup.pageNumberFormat),
      })
    }
    return out
  }, [author, docTitle, flowX, galley, headings, result, setup, slotStride, stripCount])

  // Which page is in view, for "Page X of Y".
  useEffect(() => {
    if (!scrollEl) return undefined
    const onScroll = () => {
      const stageTop = scrollEl.querySelector('.pl-sizer')?.offsetTop || 0
      const y = (scrollEl.scrollTop - stageTop + scrollEl.clientHeight / 3) / (zoomRef.current || 1)
      const strip = Math.max(0, Math.min(stripCount - 1, Math.floor(y / slotStride)))
      setCurrentPage((galley ? Math.floor(strip / setup.columns) : strip) + 1)
    }
    onScroll()
    scrollEl.addEventListener('scroll', onScroll, { passive: true })
    return () => scrollEl.removeEventListener('scroll', onScroll)
  }, [galley, scrollEl, setup.columns, slotStride, stripCount])

  // Keep what is under the cursor under the cursor across a zoom.
  const applyZoom = useCallback((next, anchor) => {
    const target = clampZoom(next)
    const prev = zoomRef.current || 1
    if (!scrollEl || target === prev) {
      onZoomChange?.(target)
      return
    }
    const rect = scrollEl.getBoundingClientRect()
    const ax = anchor ? anchor.x - rect.left : scrollEl.clientWidth / 2
    const ay = anchor ? anchor.y - rect.top : scrollEl.clientHeight / 2
    const docY = (scrollEl.scrollTop + ay) / prev
    const docX = (scrollEl.scrollLeft + ax) / prev
    onZoomChange?.(target)
    requestAnimationFrame(() => {
      scrollEl.scrollTop = docY * target - ay
      scrollEl.scrollLeft = docX * target - ax
    })
  }, [onZoomChange, scrollEl])

  // Pinch and ⌘/ctrl-wheel zoom the pages, not the webview.
  useEffect(() => {
    if (!scrollEl) return undefined
    const onWheel = (event) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      const factor = Math.exp(-event.deltaY * 0.01)
      applyZoom((zoomRef.current || 1) * factor, { x: event.clientX, y: event.clientY })
    }
    scrollEl.addEventListener('wheel', onWheel, { passive: false })
    return () => scrollEl.removeEventListener('wheel', onWheel)
  }, [applyZoom, scrollEl])

  // ⌘+ / ⌘− / ⌘0 while the pane has focus.
  useEffect(() => {
    if (!scrollEl) return undefined
    const onKey = (event) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return
      const z = zoomRef.current || 1
      if (event.key === '=' || event.key === '+') {
        event.preventDefault()
        applyZoom(ZOOM_STEPS.find((s) => s > z + 0.001) ?? z)
      } else if (event.key === '-') {
        event.preventDefault()
        applyZoom([...ZOOM_STEPS].reverse().find((s) => s < z - 0.001) ?? z)
      } else if (event.key === '0') {
        event.preventDefault()
        applyZoom(1)
      }
    }
    scrollEl.addEventListener('keydown', onKey)
    return () => scrollEl.removeEventListener('keydown', onKey)
  }, [applyZoom, scrollEl])

  const fit = useCallback((mode) => {
    if (!scrollEl) return
    const padding = 48
    const width = scrollEl.clientWidth - padding
    const height = scrollEl.clientHeight - padding
    applyZoom(mode === 'page'
      ? fitPageZoom(stageWidth, metrics.height, width, height)
      : fitWidthZoom(stageWidth, width))
  }, [applyZoom, metrics.height, scrollEl, stageWidth])

  // Bring a page to the top of the view.
  const goToPage = useCallback((page) => {
    if (!scrollEl) return
    const strip = galley ? (page - 1) * setup.columns : page - 1
    const stageTop = scrollEl.querySelector('.pl-sizer')?.offsetTop || 0
    scrollEl.scrollTo({ top: stageTop + strip * slotStride * (zoomRef.current || 1) - 16, behavior: 'smooth' })
  }, [galley, scrollEl, setup.columns, slotStride])

  useLayoutEffect(() => {
    if (!editor || editor.isDestroyed) return undefined
    const storage = editor.storage.pagination
    if (!storage) return undefined
    storage.goToPage = goToPage
    storage.fit = fit
    return () => {
      if (storage.goToPage === goToPage) storage.goToPage = null
      if (storage.fit === fit) storage.fit = null
    }
  }, [editor, fit, goToPage])

  const stageStyle = {
    width: `${stageWidth}px`,
    height: `${stageHeight}px`,
    transform: `scale(${zoom})`,
    '--pl-flow-w': `${galley ? metrics.columnWidth : metrics.contentWidth}px`,
    '--pl-content-top': `${metrics.contentTop}px`,
    '--pl-content-h': `${metrics.contentHeight}px`,
  }

  const masks = []
  for (let strip = 0; strip < stripCount - 1; strip += 1) {
    masks.push({ top: strip * slotStride + metrics.height, height: PAGE_GAP })
  }

  const pageCount = Math.max(result.pageCount, 1)
  const status = (
    <div className="pl-status" role="toolbar" aria-label="Print Layout">
      <span className="pl-page-count">
        Page {Math.min(currentPage, pageCount)} of {pageCount}
      </span>
      <button type="button" onClick={() => applyZoom([...ZOOM_STEPS].reverse().find((s) => s < zoom - 0.001) ?? zoom)} aria-label="Zoom out" title="Zoom out (⌘−)">−</button>
      <select
        value=""
        onChange={(event) => {
          const v = event.target.value
          if (v === 'width' || v === 'page') fit(v)
          else if (v) applyZoom(Number(v))
        }}
        aria-label="Zoom"
        title="Zoom"
      >
        <option value="" hidden>{Math.round(zoom * 100)}%</option>
        <option value="width">Fit width</option>
        <option value="page">Fit page</option>
        {ZOOM_STEPS.map((s) => <option key={s} value={s}>{Math.round(s * 100)}%</option>)}
      </select>
      <button type="button" onClick={() => applyZoom(ZOOM_STEPS.find((s) => s > zoom + 0.001) ?? zoom)} aria-label="Zoom in" title="Zoom in (⌘+)">+</button>
      {nativeOwns('pageSetup') ? null : (
        <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('inkblot:page-setup'))} title="Page Setup">Page Setup…</button>
      )}
    </div>
  )

  return (
    <div className="print-layout">
      <div className="pl-sizer" style={{ width: `${stageWidth * zoom}px`, height: `${stageHeight * zoom}px` }}>
        <div className="pl-stage" style={stageStyle}>
          <div className="pl-pages" aria-hidden="true">
            {pages.map((page) => (
              <div
                key={page.strip}
                className={`pl-page${page.blank ? ' is-blank' : ''}${isRecto(page.physical) ? ' is-recto' : ' is-verso'}`}
                style={{ left: `${page.left}px`, top: `${page.top}px`, width: `${metrics.width}px`, height: `${metrics.height}px` }}
                data-page={page.physical}
              >
                {page.header ? (
                  <div
                    className="pl-running is-header"
                    style={{ left: `${pageLeftMargin(setup, page.physical)}px`, width: `${metrics.contentWidth}px`, top: `${metrics.headerTop}px`, height: `${Math.max(0, metrics.contentTop - metrics.headerTop)}px` }}
                  >
                    <span>{page.header.left}</span><span>{page.header.center}</span><span>{page.header.right}</span>
                  </div>
                ) : null}
                {page.footer ? (
                  <div
                    className="pl-running is-footer"
                    style={{ left: `${pageLeftMargin(setup, page.physical)}px`, width: `${metrics.contentWidth}px`, top: `${metrics.contentTop + metrics.contentHeight}px`, height: `${Math.max(0, metrics.footerBottom - metrics.contentTop - metrics.contentHeight)}px` }}
                  >
                    <span>{page.footer.left}</span><span>{page.footer.center}</span><span>{page.footer.right}</span>
                  </div>
                ) : null}
                {galley ? (
                  <div className="pl-slot-label" style={{ left: `${pageLeftMargin(setup, page.physical)}px`, top: `${Math.max(4, metrics.contentTop - 16)}px` }}>
                    Page {page.folio} · column {page.column + 1} of {setup.columns}
                  </div>
                ) : null}
                {showGuides ? (
                  <div
                    className="pl-guide"
                    style={{ left: `${pageLeftMargin(setup, page.physical)}px`, top: `${metrics.contentTop}px`, width: `${galley ? metrics.columnWidth : metrics.contentWidth}px`, height: `${metrics.contentHeight}px` }}
                  />
                ) : null}
              </div>
            ))}
          </div>
          <div className="pl-flow" style={{ left: `${flowX}px` }}>
            {children}
          </div>
          <div className="pl-masks" aria-hidden="true">
            {masks.map((mask) => (
              <div key={mask.top} className="pl-mask" style={{ left: '-4000px', right: '-4000px', top: `${mask.top}px`, height: `${mask.height}px` }} />
            ))}
          </div>
        </div>
      </div>
      {statusHost ? createPortal(status, statusHost) : status}
    </div>
  )
}

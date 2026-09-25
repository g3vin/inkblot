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
  describeWordCount,
  formatPageNumber,
  isRecto,
  normalizePageSetup,
  pageLeftMargin,
  pageMetrics,
  runningTextFor,
  setupUsesToken,
  surnameOf,
} from './pageSetup'
import { loadTypographyFont, typographyClasses, typographyKey, typographyVars } from './typography'
import { countWords } from '../lib/wordCount'
import { clampZoom, fitPageZoom, fitWidthZoom, MAX_ZOOM, MIN_ZOOM, ZOOM_STEPS } from './zoom'
import { PAGE_GAP } from './printLayoutConstants'
import { setCurrentPrintPage } from './printLayoutStore'
import { nativeOwns } from '../lib/host'
import './PrintLayout.css'
import './PrintTypography.css'

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
  docPath = '',
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

  // Before the zoom's own layout effect below, which reads it.
  useLayoutEffect(() => {
    zoomRef.current = zoom
  }, [zoom])

  // In a galley each column is its own strip, a page's height apart.
  const slotStride = metrics.height + PAGE_GAP
  // The print type: its key re-measures every line, and so does its font arriving —
  // measured in a fallback, the lines would break in the wrong places until then.
  const typeKey = typographyKey(setup.typography)
  const [fontsLoaded, setFontsLoaded] = useState(0)
  useEffect(() => {
    let live = true
    loadTypographyFont(setup.typography).then(() => { if (live) setFontsLoaded((n) => n + 1) })
    return () => { live = false }
  }, [typeKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const frame = useMemo(() => ({
    slotHeight: metrics.contentHeight,
    stride: slotStride,
    columns: setup.columns,
    minLines: setup.widowOrphanLines,
    typeKey,
    revision: fontsLoaded,
  }), [metrics.contentHeight, slotStride, setup.columns, setup.widowOrphanLines, typeKey, fontsLoaded])

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

  // Words only when a running head shows them.
  const wordsText = useMemo(() => (
    setupUsesToken(setup, 'words') && editor && !editor.isDestroyed
      ? describeWordCount(countWords(editor.state.doc.textContent))
      : ''
  ), [editor, result, setup]) // eslint-disable-line react-hooks/exhaustive-deps

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
        surname: surnameOf(author),
        words: wordsText,
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
  }, [author, docTitle, flowX, galley, headings, result, setup, slotStride, stripCount, wordsText])

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

  // And for the inspector's, which is drawn from what the controller publishes.
  useEffect(() => {
    setCurrentPrintPage(docPath, currentPage)
  }, [currentPage, docPath])

  /*
   * Zoom, as smooth as the display allows.
   *
   * Laying the pages out again at every step of a pinch is what made the text shimmy:
   * each step re-rasterised every glyph at a new scale, and the scroll that held the
   * anchor still landed a step behind. So a zoom in progress lays nothing out. It
   * scales the sizer as one composited layer — a transform the compositor applies on
   * its own — holding the point under the cursor (or the pane's centre) still. Only
   * when it ends is the zoom committed: the store's zoom changes, the stage is laid
   * out once at the new size, and in the same frame (`settle`) the scroll is set so
   * every page lands exactly where the transform last drew it.
   */
  const sizerRef = useRef(null)
  // { base: the committed zoom it started from, s, tx, ty: the transform, ax, ay: its anchor }
  const liveRef = useRef(null)
  // What `settle` needs once the committed zoom has been laid out.
  const pendingRef = useRef(null)
  const commitTimerRef = useRef(0)
  const animationRef = useRef({ frame: 0, target: null })
  const pinchingRef = useRef(false)

  const liveZoom = () => (liveRef.current ? liveRef.current.base * liveRef.current.s : zoomRef.current || 1)

  /** Draws the pages at `next`, keeping the screen point (ax, ay) where it is. */
  const zoomVisual = useCallback((next, ax, ay) => {
    const sizer = sizerRef.current
    if (!sizer) return
    let live = liveRef.current
    if (!live) {
      live = { base: zoomRef.current || 1, s: 1, tx: 0, ty: 0, ax, ay }
      // Picked up mid-settle: from wherever the settling transition has got to.
      if (sizer.classList.contains('is-settling')) {
        const m = new DOMMatrixReadOnly(getComputedStyle(sizer).transform)
        live.tx = m.e
        live.ty = m.f
        sizer.classList.remove('is-settling')
      }
      liveRef.current = live
      sizer.classList.add('is-zooming')
    }
    // Unrounded while it moves (clampZoom's rounding would step); rounded at the end.
    const target = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next))
    const current = live.base * live.s
    live.ax = ax
    live.ay = ay
    if (target !== current) {
      // screen = o + t + s·q for a point q of the sizer, o its untransformed origin;
      // scaling by f about a moves t to f·t + (1 − f)(a − o).
      const f = target / current
      const rect = sizer.getBoundingClientRect()
      live.tx = f * live.tx + (1 - f) * (ax - (rect.left - live.tx))
      live.ty = f * live.ty + (1 - f) * (ay - (rect.top - live.ty))
      live.s = target / live.base
    }
    sizer.style.transform = `translate(${live.tx}px, ${live.ty}px) scale(${live.s})`
  }, [])

  /** Scrolls the laid-out pages to where the transform last drew them, and drops it. */
  const settle = useCallback((pending) => {
    const sizer = sizerRef.current
    if (!sizer || !scrollEl) return
    sizer.classList.remove('is-zooming', 'is-settling')
    sizer.style.transform = ''
    const wantTop = pending.scrollTop + (sizer.offsetTop - pending.offsetTop) - pending.ty
    const wantLeft = pending.scrollLeft + (sizer.offsetLeft - pending.offsetLeft) - pending.tx
    scrollEl.scrollTop = wantTop
    scrollEl.scrollLeft = wantLeft
    // The scroll range could not take it all — the document's top, or pages that now
    // fit across and centre. Ease the rest in rather than jump.
    const dx = scrollEl.scrollLeft - wantLeft
    const dy = scrollEl.scrollTop - wantTop
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return
    sizer.style.transform = `translate(${dx}px, ${dy}px)`
    void sizer.offsetWidth
    sizer.classList.add('is-settling')
    sizer.style.transform = ''
    const done = (event) => {
      if (event.target !== sizer) return
      sizer.removeEventListener('transitionend', done)
      if (!liveRef.current) sizer.classList.remove('is-settling')
    }
    sizer.addEventListener('transitionend', done)
  }, [scrollEl])

  /** Ends the zoom in progress: one layout at the new zoom, then `settle`. */
  const commitZoom = useCallback(() => {
    window.clearTimeout(commitTimerRef.current)
    commitTimerRef.current = 0
    const live = liveRef.current
    const sizer = sizerRef.current
    if (!live || !sizer || !scrollEl) return
    const target = clampZoom(live.base * live.s)
    zoomVisual(target, live.ax, live.ay)
    liveRef.current = null
    const pending = {
      zoom: target,
      tx: live.tx,
      ty: live.ty,
      scrollTop: scrollEl.scrollTop,
      scrollLeft: scrollEl.scrollLeft,
      offsetTop: sizer.offsetTop,
      offsetLeft: sizer.offsetLeft,
    }
    if (target === zoomRef.current) {
      settle(pending)
      return
    }
    // The store re-renders synchronously, before the next paint; the layout effect
    // below settles it there.
    pendingRef.current = pending
    onZoomChange?.(target)
  }, [onZoomChange, scrollEl, settle, zoomVisual])

  useLayoutEffect(() => {
    const pending = pendingRef.current
    if (!pending || pending.zoom !== zoom) return
    pendingRef.current = null
    settle(pending)
  }, [settle, zoom])

  const stopAnimation = () => {
    if (animationRef.current.frame) cancelAnimationFrame(animationRef.current.frame)
    animationRef.current = { frame: 0, target: null }
  }

  /** A zoom to a set level — a step, a fit, a menu choice — eased over a few frames. */
  const applyZoom = useCallback((next, anchor) => {
    if (!scrollEl) {
      onZoomChange?.(clampZoom(next))
      return
    }
    stopAnimation()
    window.clearTimeout(commitTimerRef.current)
    const rect = scrollEl.getBoundingClientRect()
    const ax = anchor ? anchor.x : rect.left + scrollEl.clientWidth / 2
    const ay = anchor ? anchor.y : rect.top + scrollEl.clientHeight / 2
    const from = liveZoom()
    const to = clampZoom(next)
    if (to === from) {
      commitZoom()
      return
    }
    const start = performance.now()
    const duration = 220
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - (1 - t) ** 3
      // Geometric, so every frame of the ease is the same proportion of zoom.
      zoomVisual(from * (to / from) ** eased, ax, ay)
      if (t < 1) {
        animationRef.current.frame = requestAnimationFrame(step)
      } else {
        animationRef.current = { frame: 0, target: null }
        commitZoom()
      }
    }
    animationRef.current = { frame: requestAnimationFrame(step), target: to }
  }, [commitZoom, onZoomChange, scrollEl, zoomVisual])

  /** The level a step in or out goes to — from where a running step is headed, so
   *  pressing ⌘+ three times goes three steps. */
  const stepZoom = useCallback((direction) => {
    const z = animationRef.current.target ?? liveZoom()
    const next = direction > 0
      ? ZOOM_STEPS.find((s) => s > z + 0.001) ?? z
      : [...ZOOM_STEPS].reverse().find((s) => s < z - 0.001) ?? z
    applyZoom(next)
  }, [applyZoom])

  useEffect(() => () => {
    window.clearTimeout(commitTimerRef.current)
    if (animationRef.current.frame) cancelAnimationFrame(animationRef.current.frame)
  }, [])

  // Pinch and ⌘/ctrl-wheel zoom the pages, not the webview. WebKit sends a trackpad
  // pinch as gesture events (which, unhandled, magnify the whole page); a mouse's
  // ⌘-wheel, and other engines' pinch, as ctrl-wheel.
  useEffect(() => {
    if (!scrollEl) return undefined
    const onWheel = (event) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      if (pinchingRef.current) return
      stopAnimation()
      const factor = Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.01))
      zoomVisual(liveZoom() * factor, event.clientX, event.clientY)
      window.clearTimeout(commitTimerRef.current)
      commitTimerRef.current = window.setTimeout(commitZoom, 160)
    }
    let pinchFrom = 1
    const onGestureStart = (event) => {
      event.preventDefault()
      stopAnimation()
      window.clearTimeout(commitTimerRef.current)
      pinchingRef.current = true
      pinchFrom = liveZoom()
    }
    const onGestureChange = (event) => {
      event.preventDefault()
      zoomVisual(pinchFrom * event.scale, event.clientX, event.clientY)
    }
    const onGestureEnd = (event) => {
      event.preventDefault()
      pinchingRef.current = false
      commitZoom()
    }
    scrollEl.addEventListener('wheel', onWheel, { passive: false })
    scrollEl.addEventListener('gesturestart', onGestureStart, { passive: false })
    scrollEl.addEventListener('gesturechange', onGestureChange, { passive: false })
    scrollEl.addEventListener('gestureend', onGestureEnd, { passive: false })
    return () => {
      scrollEl.removeEventListener('wheel', onWheel)
      scrollEl.removeEventListener('gesturestart', onGestureStart)
      scrollEl.removeEventListener('gesturechange', onGestureChange)
      scrollEl.removeEventListener('gestureend', onGestureEnd)
    }
  }, [commitZoom, scrollEl, zoomVisual])

  // ⌘+ / ⌘− / ⌘0 while the pane has focus.
  useEffect(() => {
    if (!scrollEl) return undefined
    const onKey = (event) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return
      if (event.key === '=' || event.key === '+') {
        event.preventDefault()
        stepZoom(1)
      } else if (event.key === '-') {
        event.preventDefault()
        stepZoom(-1)
      } else if (event.key === '0') {
        event.preventDefault()
        applyZoom(1)
      }
    }
    scrollEl.addEventListener('keydown', onKey)
    return () => scrollEl.removeEventListener('keydown', onKey)
  }, [applyZoom, scrollEl, stepZoom])

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
    commitZoom()
    const strip = galley ? (page - 1) * setup.columns : page - 1
    const stageTop = scrollEl.querySelector('.pl-sizer')?.offsetTop || 0
    scrollEl.scrollTo({ top: stageTop + strip * slotStride * (zoomRef.current || 1) - 16, behavior: 'smooth' })
  }, [commitZoom, galley, scrollEl, setup.columns, slotStride])

  useLayoutEffect(() => {
    if (!editor || editor.isDestroyed) return undefined
    const storage = editor.storage.pagination
    if (!storage) return undefined
    storage.goToPage = goToPage
    storage.fit = fit
    storage.zoomTo = applyZoom
    return () => {
      if (storage.goToPage === goToPage) storage.goToPage = null
      if (storage.fit === fit) storage.fit = null
      if (storage.zoomTo === applyZoom) storage.zoomTo = null
    }
  }, [applyZoom, editor, fit, goToPage])

  const stageStyle = {
    ...typographyVars(setup.typography),
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
  // Beside the word count, in the pane's status row; drawn as glass under the Swift
  // shell, which measures it with the word count (it is a `.word-count` too).
  const pageCountBadge = (
    <div className="word-count pl-page-count-badge">
      Page {Math.min(currentPage, pageCount)} of {pageCount}
    </div>
  )
  // Under the Swift shell the zoom control is native (PrintLayoutControls.swift).
  const zoomBar = nativeOwns('printControls') ? null : (
    <div className="pl-status" role="toolbar" aria-label="Zoom">
      <button type="button" onClick={() => stepZoom(-1)} aria-label="Zoom out" title="Zoom out (⌘−)">−</button>
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
      <button type="button" onClick={() => stepZoom(1)} aria-label="Zoom in" title="Zoom in (⌘+)">+</button>
      {nativeOwns('pageSetup') ? null : (
        <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('inkblot:page-setup'))} title="Page Setup">Page Setup…</button>
      )}
    </div>
  )
  const pageCountHost = statusHost?.querySelector(':scope > .pane-status') || null

  return (
    <div className="print-layout">
      <div ref={sizerRef} className="pl-sizer" style={{ width: `${stageWidth * zoom}px`, height: `${stageHeight * zoom}px` }}>
        <div className={['pl-stage', ...typographyClasses(setup.typography)].join(' ')} style={stageStyle}>
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
      {pageCountHost ? createPortal(pageCountBadge, pageCountHost) : null}
      {zoomBar && statusHost ? createPortal(zoomBar, statusHost) : zoomBar}
    </div>
  )
}

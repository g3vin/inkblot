/**
 * ToolbarHost — one toolbar, drawn from its saved layout.
 *
 * Five toolbars (lib/chromeLayout.ts): a document's, a canvas's, a map's, a
 * timeline's and Typeset's. Each item is its own component (registry.jsx) and reads the state the
 * page publishes — `toolbarState`, `canvasToolbarChanged`, `mapChromeChanged`,
 * `timelineChromeChanged`, `pageLayoutState`, `viewOptions` — and sends back commands over the bridge. So the
 * host needs nothing from the document but the live editor, which the voice controls
 * keep.
 *
 * It is a dynamic toolbar (docs/DESIGN.md §6). Its items are pages the writer swipes
 * through as the sidebars' panels are (useSpaceSwipe, with its haptics), or turns with
 * the dots at the row's end; a page too wide for the row carries on onto the next. A
 * pop-up opened from the row opens in it, beside its button (`ToolbarDockContext`,
 * Popover.jsx), setting aside what no longer fits until it closes.
 *
 * Customize Toolbar… (`inkblot:customize-toolbar`) opens the palette, and while it is
 * open the page's items become tokens that drag to reorder, onto a dot to move to that
 * page, and off the toolbar to remove.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useReducedMotion } from 'framer-motion'
import '../Toolbar.css'
import './Toolbar.customize.css'
import { FLEXIBLE_SPACE, PAGE, SPACE, isSpacer, toolbarItem } from '../../lib/chromeLayout'
import { useCommands } from '../../lib/commands'
import useSpaceSwipe from '../../hooks/useSpaceSwipe'
import { CUSTOMIZE_TOOLBAR_EVENT, useToolbarContext } from './toolbarContext'
import ToolbarItem from './ToolbarItem'
import usePointerReorder from '../../ui/usePointerReorder'
import useToolbarLayout from './useToolbarLayout'
import { applyPageDrop, fitPage, moveToPage, pushedAside, removePage } from './toolbarEdits'
import ToolbarPalette from './ToolbarPalette'
import { useRevealOnChange } from '../../ui/revealState.js'
import { ToolbarDockContext } from '../../ui/layer'

const slotKey = (context, id, index) => `${context}:${id}:${index}`
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
/** What scrolls sideways on its own inside the row (a font strip): not a page swipe. */
const OWN_SCROLL = '.tb-strip'
/**
 * The travel that turns a page, shorter than the row: the page fades with the fingers,
 * the swipe clicks onto the next page (with a tick) as they pass half of it, and
 * letting go from there turns the page. A flick turns it however short.
 */
const SWIPE_PAGE_PX = 350
/** How faint the page is a whole page's travel along: still there, not gone. */
const SWIPE_FADE_FLOOR = 0.25
/** How far the page's items lean with a swipe, a page's travel along: that it caught. */
const SWIPE_LEAN_PX = 16

export default function ToolbarHost({ context, editor, activeDoc, hasProject, panel, split, timer }) {
  const { items, display, setItems, reset, setDisplay } = useToolbarLayout(context)
  const ctx = useToolbarContext({ editor, activeDoc, hasProject, panel, split, timer, display })
  const [customizing, setCustomizing] = useState(false)
  const reducedMotion = useReducedMotion()
  const rowRef = useRef(null)
  const viewportRef = useRef(null)

  useEffect(() => {
    const open = () => setCustomizing(true)
    window.addEventListener(CUSTOMIZE_TOOLBAR_EVENT, open)
    return () => window.removeEventListener(CUSTOMIZE_TOOLBAR_EVENT, open)
  }, [])

  // A page made in Customize stays, empty, until something is dropped on it: an empty
  // page is not saved.
  const [making, setMaking] = useState(false)
  const [page, setPage] = useState(0)
  // One host for every toolbar: switching between a document, a canvas, a map and
  // Typeset keeps it (and what it measured), closes Customize, turns back to the first
  // page, and fades the new toolbar's items in.
  const [shownContext, setShownContext] = useState(context)
  if (shownContext !== context) {
    setShownContext(context)
    setCustomizing(false)
    setMaking(false)
    setPage(0)
  }
  const contextReveal = useRevealOnChange(context)

  // The writer's pages, each slot with its index in the saved list.
  const userPages = useMemo(() => {
    const pages = [[]]
    items.forEach((id, index) => {
      if (id === PAGE) pages.push([])
      else pages[pages.length - 1].push({ id, index, key: slotKey(context, id, index) })
    })
    if (customizing && making) pages.push([])
    return pages
  }, [items, context, customizing, making])

  // Each slot's own width (its open choice not counted), kept while it is set aside so
  // the pages don't reflow under it; and the room a page has.
  const [widths, setWidths] = useState({})
  // The slots are remounted when the pages are carried on differently: observe the new ones.
  const [pageCount, setPageCount] = useState(1)
  const [room, setRoom] = useState({ width: 0, available: Infinity, gap: 0 })
  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return undefined
    const measure = () => {
      const next = {}
      for (const slot of viewport.querySelectorAll('.tb-slot')) {
        if (slot.hidden) continue
        const inline = slot.querySelector(':scope > .tb-dock-inline')
        const open = inline && inline.childElementCount ? inline.offsetWidth + (parseFloat(getComputedStyle(slot).columnGap) || 0) : 0
        next[slot.dataset.key] = slot.classList.contains('is-flexible') ? 0 : slot.offsetWidth - open
      }
      setWidths((was) => {
        const merged = { ...was, ...next }
        return Object.keys(merged).length === Object.keys(was).length && Object.keys(merged).every((key) => merged[key] === was[key]) ? was : merged
      })
      const pageEl = viewport.querySelector('.tb-page')
      const style = pageEl ? getComputedStyle(pageEl) : null
      const width = viewport.clientWidth
      const available = width - (parseFloat(style?.paddingLeft) || 0) - (parseFloat(style?.paddingRight) || 0)
      const gap = parseFloat(style?.columnGap) || 0
      setRoom((was) => (was.width === width && was.available === available && was.gap === gap ? was : { width, available, gap }))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    // The slots too: an item's width follows its state (a font's name, a zoom's readout).
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    for (const slot of viewport.querySelectorAll('.tb-slot')) observer.observe(slot)
    return () => observer.disconnect()
  }, [items, display, context, customizing, pageCount])

  // The pages as shown: each of the writer's, carried on over as many as the row needs.
  // While customizing, the writer's own, as they are.
  const pages = useMemo(() => {
    if (customizing) return userPages
    return userPages.flatMap((slots) => {
      const runs = fitPage(slots.map(({ key, id }) => (id === FLEXIBLE_SPACE ? 0 : widths[key] ?? 0)), room.available, room.gap)
      const shown = runs.map(([start, end]) => slots.slice(start, end)).filter((run) => run.some(({ id }) => !isSpacer(id)))
      return shown.length ? shown : [slots]
    })
  }, [customizing, userPages, widths, room])
  const count = pages.length
  const current = clamp(page, 0, count - 1)
  useEffect(() => { setPageCount(count) }, [count])

  const swipe = useSpaceSwipe({
    targetRef: rowRef,
    index: current,
    count,
    panelWidth: SWIPE_PAGE_PX,
    onSettle: setPage,
    enabled: count > 1,
    ignore: OWN_SCROLL,
  })
  const turnTo = (next) => {
    const target = clamp(next, 0, count - 1)
    swipe.jumpTo(target)
    setPage(target)
  }

  // Escape turns back to the first page, unless it's closing a pop-up first.
  const { jumpTo } = swipe
  useEffect(() => {
    if (current === 0) return undefined
    const onKey = (event) => {
      if (event.key !== 'Escape' || document.querySelector('.ib-dock, .ib-popover, .ib-menu')) return
      jumpTo(0)
      setPage(0)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current, jumpTo])

  useCommands(() => [
    { id: 'toolbar.next-page', section: 'View', title: 'Show the next toolbar page', icon: 'chevron-right', keywords: ['toolbar', 'page'], when: () => current < count - 1, run: () => turnTo(current + 1) },
    { id: 'toolbar.previous-page', section: 'View', title: 'Show the previous toolbar page', icon: 'chevron-left', keywords: ['toolbar', 'page'], when: () => current > 0, run: () => turnTo(current - 1) },
  ], [current, count])

  // A choice open in place: its slot, and how much wider it has made it.
  const [opened, setOpened] = useState(null)

  // Where its pop-ups open (Popover.jsx). Not while customizing: the items are tokens.
  const [wrapper, setWrapper] = useState(null)
  const dock = useMemo(() => (wrapper && !customizing ? {
    whole: wrapper,
    owns: (anchor) => Boolean(rowRef.current?.contains(anchor)),
    inlineFor: (anchor) => anchor.closest('.tb-slot')?.querySelector(':scope > .tb-dock-inline') ?? null,
    // While it's open: what it sets aside as it grows, and closing it when its page is
    // turned away from.
    watch(anchor, onOut) {
      const slot = anchor?.closest('.tb-slot')
      const inline = slot?.querySelector(':scope > .tb-dock-inline')
      if (!slot || !inline) return () => {}
      const key = slot.dataset.key
      const pageEl = slot.closest('.tb-page')
      const grow = () => setOpened({ key, extra: inline.offsetWidth + (parseFloat(getComputedStyle(slot).columnGap) || 0) })
      grow()
      const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(grow)
      resize?.observe(inline)
      const turned = new MutationObserver(() => { if (pageEl?.hasAttribute('inert')) onOut() })
      if (pageEl) turned.observe(pageEl, { attributes: true, attributeFilter: ['inert'] })
      return () => {
        resize?.disconnect()
        turned.disconnect()
        setOpened((was) => (was?.key === key ? null : was))
      }
    },
  } : null), [wrapper, customizing])

  const aside = useMemo(() => {
    const onPage = opened && !customizing ? pages[current]?.findIndex(({ key }) => key === opened.key) ?? -1 : -1
    if (onPage === -1) return new Set()
    const slots = pages[current]
    const set = pushedAside(slots.map(({ key, id }) => (id === FLEXIBLE_SPACE ? 0 : widths[key] ?? 0)), onPage, opened.extra, room.available, room.gap)
    return new Set([...set].map((i) => slots[i].key))
  }, [opened, customizing, pages, current, widths, room])

  const drag = usePointerReorder({
    listRef: rowRef,
    itemSelector: '[data-reorder-id]',
    axis: 'x',
    slop: 16,
    disabled: !customizing,
    onDrop: ({ id, payload, inside, index, point }) => {
      const slots = userPages[current] ?? []
      const local = payload ? -1 : slots.findIndex((slot) => `t:${slot.index}` === id)
      const dot = inside ? document.elementFromPoint?.(point.x, point.y)?.closest?.('[data-page-dot]') : null
      const target = dot ? Number(dot.dataset.pageDot) : current
      let next
      if (dot && !payload) next = moveToPage(items, current, local, target)
      else next = applyPageDrop(items, target, { source: payload ?? { kind: 'toolbar', index: local }, inside, index: dot ? Infinity : index })
      if (payload?.kind === 'defaults') setMaking(false)
      else if (making && target === userPages.length - 1 && inside) setMaking(false)
      setItems(next)
    },
  })

  const draggingId = drag.dragging && String(drag.dragging).startsWith('t:') ? String(drag.dragging) : null
  const ghostLabel = drag.dragging
    ? (() => {
        const id = draggingId ? items[Number(draggingId.slice(2))] : String(drag.dragging).slice(2)
        if (id === SPACE) return 'Space'
        if (id === FLEXIBLE_SPACE) return 'Flexible space'
        if (id === PAGE) return 'Page break'
        if (id === 'defaults') return 'Default set'
        return toolbarItem(id)?.label ?? id
      })()
    : null
  // Where the dragged item would land, drawn as a caret between tokens.
  const caretAt = drag.dragging && drag.inside ? drag.insertIndex : null

  const onKeyDown = (event) => {
    if (!event.ctrlKey || event.metaKey || event.altKey || count < 2) return
    if (event.key === 'ArrowRight' && current < count - 1) { event.preventDefault(); turnTo(current + 1) }
    else if (event.key === 'ArrowLeft' && current > 0) { event.preventDefault(); turnTo(current - 1) }
  }

  // Drawn once per change of what they hold, not per frame of a swipe.
  const onSlotDown = drag.onPointerDown
  const pageNodes = useMemo(() => pages.map((slots, pageIndex) => {
    const here = pageIndex === current
    const shown = here && draggingId ? slots.filter((slot) => `t:${slot.index}` !== draggingId) : slots
    const edges = customizing ? null : [shown.findIndex(({ id }) => !isSpacer(id)), shown.findLastIndex(({ id }) => !isSpacer(id))]
    return (
      <div
        key={pageIndex}
        className="tb-page"
        data-current={here || undefined}
        style={{ flexBasis: `${100 / count}%` }}
        inert={!here || undefined}
        aria-hidden={here ? undefined : 'true'}
      >
        {shown.map(({ id, index, key }, position) => (
          <div
            key={key}
            data-key={key}
            className={`tb-slot${isSpacer(id) ? ' is-spacer' : ''}${id === FLEXIBLE_SPACE ? ' is-flexible' : ''}`}
            hidden={aside.has(key) || (edges && isSpacer(id) && (position < edges[0] || position > edges[1])) || undefined}
            data-reorder-id={customizing && here ? `t:${index}` : undefined}
            onPointerDown={customizing && here ? (event) => onSlotDown(event, `t:${index}`) : undefined}
            onClickCapture={customizing ? (event) => { event.preventDefault(); event.stopPropagation() } : undefined}
          >
            {here && caretAt === position ? <span className="tb-caret-line" aria-hidden="true" /> : null}
            <ToolbarItem id={id} ctx={ctx} />
            <div className="tb-dock-inline" />
          </div>
        ))}
        {here && caretAt !== null && caretAt >= shown.length ? <span className="tb-caret-line is-end" aria-hidden="true" /> : null}
        {customizing && !shown.length ? <span className="tb-page-empty">Drag items here</span> : null}
      </div>
    )
  }), [pages, current, count, draggingId, customizing, caretAt, aside, ctx, onSlotDown])

  // The pill rides the swipe's own spring (useSpaceSwipe paints it every frame, so
  // nothing else eases it). The page only leans the fingers' way while they swipe, and
  // fades as far as they've gone; it glides to the page that turns from wherever it leant.
  const travel = swipe.dragging ? clamp(swipe.progress - current, -1, 1) : 0
  const lean = travel * -SWIPE_LEAN_PX
  const trackStyle = {
    '--tb-swipe-fade': 1 - (1 - SWIPE_FADE_FLOOR) * Math.abs(travel),
    '--tb-swipe-floor': SWIPE_FADE_FLOOR,
    width: `${count * 100}%`,
    transform: `translateX(calc(-${(current * 100) / count}% + ${lean}px))`,
    // The swipe's own landing: the fingers' speed in it when let go, the quick spring
    // from rest for a click or a key.
    transition: swipe.dragging || reducedMotion ? 'none' : `transform ${swipe.snap}`,
  }
  const pillStyle = { '--tb-page-progress': clamp(swipe.progress, -0.3, count - 0.7) }

  return (
    <ToolbarDockContext.Provider value={dock}>
      <div ref={setWrapper} className="toolbar-wrapper">
        <div
          ref={rowRef}
          className={`toolbar tb-row${customizing ? ' is-customizing' : ''}${drag.dragging && !drag.inside ? ' is-removing' : ''}`}
          data-context={context}
          data-display={display}
          data-reveal={contextReveal}
          role="toolbar"
          aria-label="Toolbar"
          onKeyDown={onKeyDown}
        >
          <div ref={viewportRef} className="tb-viewport">
            <div className={`tb-track${swipe.dragging ? ' is-swiping' : ''}`} style={trackStyle}>
              {pageNodes}
            </div>
          </div>
          {count > 1 ? (
            <div className="tb-pages" role="group" aria-label="Toolbar pages">
              <span className="tb-page-pill" style={pillStyle} aria-hidden="true" />
              {pages.map((_, pageIndex) => (
                <button
                  key={pageIndex}
                  type="button"
                  className="tb-page-dot"
                  data-page-dot={pageIndex}
                  aria-label={`Page ${pageIndex + 1} of ${count}`}
                  aria-current={pageIndex === current ? 'true' : undefined}
                  title={`Page ${pageIndex + 1} (⌃← ⌃→)`}
                  onClick={() => turnTo(pageIndex)}
                >
                  <span aria-hidden="true" />
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {customizing ? (
          <ToolbarPalette
            context={context}
            items={items}
            ctx={ctx}
            display={display}
            page={current}
            pageCount={count}
            onAddPage={() => { setMaking(true); swipe.jumpTo(userPages.length); setPage(userPages.length) }}
            onRemovePage={() => {
              if (making && current === userPages.length - 1) setMaking(false)
              else setItems(removePage(items, current))
              turnTo(current - 1)
            }}
            onDisplay={setDisplay}
            onReset={() => { reset(); setMaking(false); turnTo(0) }}
            onDragStart={(event, id, payload) => drag.onPointerDown(event, `p:${id}`, { external: true, payload })}
            onClose={() => { setCustomizing(false); setMaking(false) }}
          />
        ) : null}
        {drag.ghost && ghostLabel ? createPortal(
          <div className="ui-reorder-ghost tb-ghost" style={{ left: drag.ghost.x, top: drag.ghost.y }}>
            {ghostLabel}
          </div>,
          document.body,
        ) : null}
      </div>
    </ToolbarDockContext.Provider>
  )
}

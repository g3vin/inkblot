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
 * It is a dynamic toolbar (docs/DESIGN.md §6): a pop-up opened from its row opens in
 * it (`ToolbarDockContext`, Popover.jsx), and » turns the row to its second page, the
 * items that didn't fit, with ‹ first to come back.
 *
 * Customize Toolbar… (`inkblot:customize-toolbar`) opens the palette, and while it is
 * open the toolbar's items become tokens that drag to reorder, and off the toolbar to
 * remove.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import '../Toolbar.css'
import './Toolbar.customize.css'
import { FLEXIBLE_SPACE, MORE, SPACE, isSpacer, toolbarItem } from '../../lib/chromeLayout'
import { CUSTOMIZE_TOOLBAR_EVENT, useToolbarContext } from './toolbarContext'
import ToolbarItem from './ToolbarItem'
import usePointerReorder from '../../ui/usePointerReorder'
import useToolbarLayout from './useToolbarLayout'
import { applyToolbarDrop } from './toolbarEdits'
import ToolbarPalette from './ToolbarPalette'
import { useRevealOnChange } from '../../ui/revealState.js'
import { fittingCount } from './toolbarEdits'
import Icon from '../../ui/Icon.jsx'
import { ToolbarDockContext } from '../../ui/layer'

export default function ToolbarHost({ context, editor, activeDoc, hasProject, panel, split, timer }) {
  const { items, display, setItems, reset, setDisplay } = useToolbarLayout(context)
  const ctx = useToolbarContext({ editor, activeDoc, hasProject, panel, split, timer, display })
  const [customizing, setCustomizing] = useState(false)
  const listRef = useRef(null)

  useEffect(() => {
    const open = () => setCustomizing(true)
    window.addEventListener(CUSTOMIZE_TOOLBAR_EVENT, open)
    return () => window.removeEventListener(CUSTOMIZE_TOOLBAR_EVENT, open)
  }, [])

  const drag = usePointerReorder({
    listRef,
    itemSelector: '[data-reorder-id]',
    axis: 'x',
    slop: 16,
    disabled: !customizing,
    onDrop: ({ id, payload, inside, index }) => {
      const source = payload ?? { kind: 'toolbar', index: Number(String(id).slice(2)) }
      setItems(applyToolbarDrop(items, { source, inside, index }))
    },
  })

  // What fits, measured from the slots' own widths; the rest goes behind ».
  const [fitting, setFitting] = useState(Infinity)
  // » shows the second page: what didn't fit, in place of what did. Escape comes back,
  // unless it's closing a pop-up first.
  const [paged, setPaged] = useState(false)
  useEffect(() => {
    if (!paged) return undefined
    const onKey = (event) => {
      if (event.key !== 'Escape' || document.querySelector('.ib-dock, .ib-popover, .ib-menu')) return
      setPaged(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [paged])
  const overflowRef = useRef(null)
  // One host for every toolbar: switching between a document, a canvas, a map and
  // Typeset keeps it (and what it measured), closes Customize, turns back to the first
  // page, and fades the new toolbar's items in.
  const [shownContext, setShownContext] = useState(context)
  if (shownContext !== context) {
    setShownContext(context)
    setCustomizing(false)
    setPaged(false)
  }
  const contextReveal = useRevealOnChange(context)

  // Turning the page moves focus to the button that turns it back.
  const backRef = useRef(null)
  const turned = useRef(false)
  const turn = (to) => { turned.current = true; setPaged(to) }
  useEffect(() => {
    if (!turned.current) return
    turned.current = false
    ;(paged ? backRef : overflowRef).current?.focus()
  }, [paged])

  // Where its pop-ups open (Popover.jsx). Not while customizing: the items are tokens.
  const [wrapper, setWrapper] = useState(null)
  const dock = useMemo(() => (wrapper && !customizing ? {
    whole: wrapper,
    owns: (anchor) => Boolean(listRef.current?.contains(anchor)),
    inlineFor: (anchor) => anchor.closest('.tb-slot')?.querySelector(':scope > .tb-dock-inline') ?? null,
    watch(anchor, onOut) {
      const slot = anchor?.closest('.tb-slot')
      if (!slot) return () => {}
      const check = () => { if (slot.dataset.overflowed === 'true') onOut() }
      check()
      const observer = new MutationObserver(check)
      observer.observe(slot, { attributes: true, attributeFilter: ['data-overflowed'] })
      return () => observer.disconnect()
    },
  } : null), [wrapper, customizing])
  useLayoutEffect(() => {
    const row = listRef.current
    if (paged) return undefined
    if (!row || customizing) { setFitting(Infinity); return undefined }
    const measure = () => {
      const slots = [...row.querySelectorAll(':scope > .tb-slot')]
      const widths = slots.map((slot) => (slot.classList.contains('is-flexible') ? 0 : slot.offsetWidth))
      const style = getComputedStyle(row)
      const gap = parseFloat(style.columnGap) || 0
      const available = row.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0)
      const next = fittingCount(widths, available, gap)
      setFitting((was) => (was === next ? was : next))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(row)
    return () => observer.disconnect()
  }, [customizing, items, display, context, paged])

  const draggingIndex = drag.dragging && String(drag.dragging).startsWith('t:') ? Number(String(drag.dragging).slice(2)) : null
  const ghostLabel = drag.dragging
    ? (() => {
        const id = draggingIndex !== null ? items[draggingIndex] : String(drag.dragging).slice(2)
        if (id === SPACE) return 'Space'
        if (id === FLEXIBLE_SPACE) return 'Flexible space'
        if (id === MORE) return 'More'
        if (id === 'defaults') return 'Default set'
        return toolbarItem(id)?.label ?? id
      })()
    : null

  // Where the dragged item would land, drawn as a caret between tokens.
  const caretAt = drag.dragging && drag.inside ? drag.insertIndex : null
  const shown = items.map((id, index) => ({ id, index })).filter(({ index }) => index !== draggingIndex)
  // Behind »: what does not fit, and everything after the More marker (while not
  // customizing, when the marker is a token like any other).
  const moreAt = customizing ? -1 : shown.findIndex(({ id }) => id === MORE)
  const visible = moreAt === -1 ? fitting : Math.min(fitting, moreAt)
  const hidden = shown.slice(visible).filter(({ id }) => !isSpacer(id) && id !== MORE)

  const onPage2 = paged && hidden.length > 0
  return (
    <ToolbarDockContext.Provider value={dock}>
      <div ref={setWrapper} className="toolbar-wrapper">
        <div
          ref={listRef}
          className={`toolbar tb-row${customizing ? ' is-customizing' : ''}${drag.dragging && !drag.inside ? ' is-removing' : ''}`}
          data-context={context}
          data-display={display}
          data-reveal={contextReveal}
          role="toolbar"
          aria-label="Toolbar"
        >
          {onPage2 ? (
            <button ref={backRef} type="button" className="tb-overflow is-back" aria-label="Back to the toolbar" title="Back (Esc)" onClick={() => turn(false)}>
              <Icon name="chevron-left" />
            </button>
          ) : null}
          {shown.map(({ id, index }, position) => {
            const away = onPage2 ? position < visible || isSpacer(id) || id === MORE : position >= visible
            return (
            <div
              key={`${context}:${id}:${index}`}
              className={`tb-slot${isSpacer(id) ? ' is-spacer' : ''}${id === FLEXIBLE_SPACE ? ' is-flexible' : ''}`}
              data-overflowed={away ? 'true' : undefined}
              aria-hidden={away ? 'true' : undefined}
              data-reorder-id={customizing ? `t:${index}` : undefined}
              onPointerDown={customizing ? (event) => drag.onPointerDown(event, `t:${index}`) : undefined}
              onClickCapture={customizing ? (event) => { event.preventDefault(); event.stopPropagation() } : undefined}
            >
              {caretAt === position ? <span className="tb-caret-line" aria-hidden="true" /> : null}
              <ToolbarItem id={id} ctx={ctx} />
              <div className="tb-dock-inline" />
            </div>
            )
          })}
          {caretAt !== null && caretAt >= shown.length ? <span className="tb-caret-line is-end" aria-hidden="true" /> : null}
          {hidden.length && !onPage2 ? (
            <button ref={overflowRef} type="button" className="tb-overflow" aria-label="More toolbar items" title="More" onClick={() => turn(true)}>
              <Icon name="overflow" />
            </button>
          ) : null}
        </div>
        {customizing ? (
          <ToolbarPalette
            context={context}
            items={items}
            ctx={ctx}
            display={display}
            onDisplay={setDisplay}
            onReset={reset}
            onDragStart={(event, id, payload) => drag.onPointerDown(event, `p:${id}`, { external: true, payload })}
            onClose={() => setCustomizing(false)}
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

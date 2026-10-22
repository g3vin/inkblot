/**
 * ToolbarHost — one toolbar, drawn from its saved layout.
 *
 * Four toolbars (lib/chromeLayout.ts): a document's, a canvas's, a map's and
 * Typeset's. Each item is its own component (registry.jsx) and reads the state the
 * page publishes — `toolbarState`, `canvasToolbarChanged`, `mapChromeChanged`,
 * `pageLayoutState`, `viewOptions` — and sends back commands over the bridge. So the
 * host needs nothing from the document but the live editor, which the voice controls
 * keep.
 *
 * Customize Toolbar… (`inkblot:customize-toolbar`) opens the palette, and while it is
 * open the toolbar's items become tokens that drag to reorder, and off the toolbar to
 * remove.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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
import Popover from '../../ui/Popover'
import { fittingCount } from './toolbarEdits'

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
  const [overflowOpen, setOverflowOpen] = useState(false)
  const overflowRef = useRef(null)
  useLayoutEffect(() => {
    const row = listRef.current
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
  }, [customizing, items, display, context])

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

  // », a labelled list: every item behind it shows its name (DESIGN.md §9 → Pop-ups).
  const listed = { ...ctx, display: 'iconAndLabel' }
  return (
    <div className="toolbar-wrapper">
      <div
        ref={listRef}
        className={`toolbar tb-row${customizing ? ' is-customizing' : ''}${drag.dragging && !drag.inside ? ' is-removing' : ''}`}
        data-context={context}
        data-display={display}
        role="toolbar"
        aria-label="Toolbar"
      >
        {shown.map(({ id, index }, position) => (
          <div
            key={`${id}:${index}`}
            className={`tb-slot${isSpacer(id) ? ' is-spacer' : ''}${id === FLEXIBLE_SPACE ? ' is-flexible' : ''}`}
            data-overflowed={position >= visible ? 'true' : undefined}
            aria-hidden={position >= visible ? 'true' : undefined}
            data-reorder-id={customizing ? `t:${index}` : undefined}
            onPointerDown={customizing ? (event) => drag.onPointerDown(event, `t:${index}`) : undefined}
            onClickCapture={customizing ? (event) => { event.preventDefault(); event.stopPropagation() } : undefined}
          >
            {caretAt === position ? <span className="tb-caret-line" aria-hidden="true" /> : null}
            <ToolbarItem id={id} ctx={ctx} />
          </div>
        ))}
        {caretAt !== null && caretAt >= shown.length ? <span className="tb-caret-line is-end" aria-hidden="true" /> : null}
        {hidden.length ? (
          <button
            ref={overflowRef}
            type="button"
            className="tb-overflow"
            aria-label="More toolbar items"
            aria-haspopup="dialog"
            aria-expanded={overflowOpen}
            title="More"
            onClick={() => setOverflowOpen((open) => !open)}
          >
            »
          </button>
        ) : null}
      </div>
      <Popover anchorRef={overflowRef} open={overflowOpen && hidden.length > 0} onClose={() => setOverflowOpen(false)} align="end" className="tb-overflow-popover">
        <div className="toolbar tb-overflow-list" data-display="iconAndLabel" role="toolbar" aria-orientation="vertical" aria-label="More toolbar items">
          {hidden.map(({ id, index }) => (
            <div key={`${id}:${index}`} className="tb-slot"><ToolbarItem id={id} ctx={listed} /></div>
          ))}
        </div>
      </Popover>
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
  )
}

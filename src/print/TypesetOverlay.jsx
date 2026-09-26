/**
 * TypesetOverlay.jsx — typesetting on the page itself, in Typeset.
 *
 * The pages are the main surface; the Typeset tab is for exact values. Over the live
 * chapter's pages, in the stage's own units (so it scales with the zoom), this draws what
 * a designer would reach for:
 *
 *   the text block          its four edges drag the margins — inside and outside as the
 *                           spread has them, ⌥ both sides at once, ⇧ unsnapped
 *   the running head & foot drag to move them; click to edit what they say and the folio
 *   the chapter's head      drag its top to set how far down the page it opens; a small
 *                           bar sets its alignment, its number, its picture and ornament
 *   a picture in the head   drag it between above, between and below; drag its corner to
 *                           size it
 *   a scene break           click to choose its glyph
 *   the opening letter      click for a drop cap, small capitals, both or neither
 *   a picture in the text   snap its width to the text block, and align it
 *
 * A drag previews live and commits once, when it is let go. What it changes is the
 * document's own setup when it has one (undone with ⌘Z like any edit), or the book's —
 * then a note offers to undo it. Picking a handle also tells the inspector
 * (`typesetFocus`), which opens the section where the same thing is set exactly.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { pageLeftMargin } from './pageSetup'
import { mmToPx } from './pageSizes'
import { TYPESET_META } from './TypesetLock'

const PX_PER_MM = mmToPx(1)
const SNAP_MM = 0.5
const GLYPHS = ['* * *', '#', '⁂', '❧', '❦', '✦', '~', '—', '• • •', '']
const RUNNING_TOKENS = ['{page}', '{title}', '{chapter}', '{author}', '{surname}']
/** How close to an edge the pointer must be, in page px, to take hold of it. */
const GRAB = 5

const round = (mm, snap) => (snap ? Math.round(mm / SNAP_MM) * SNAP_MM : Math.round(mm * 10) / 10)
const describe = (mm) => `${mm.toFixed(1)} mm · ${(mm / 25.4).toFixed(2)}″`

/** Which margin an edge of a page is: the left edge is the inside on a recto. */
const marginOf = (setup, physical, side) => {
  if (side === 'top') return 'topMm'
  if (side === 'bottom') return 'bottomMm'
  const verso = setup.mirrorMargins && physical % 2 === 0
  if (side === 'left') return verso ? 'outsideMm' : 'insideMm'
  return verso ? 'insideMm' : 'outsideMm'
}

const OPPOSITE = { topMm: 'bottomMm', bottomMm: 'topMm', insideMm: 'outsideMm', outsideMm: 'insideMm' }

/** A rect of `el` in the stage's units: relative to the stage, divided by the zoom. */
const stageRect = (el, stage, zoom) => {
  const r = el.getBoundingClientRect()
  const s = stage.getBoundingClientRect()
  return { x: (r.left - s.left) / zoom, y: (r.top - s.top) / zoom, w: r.width / zoom, h: r.height / zoom }
}

export default function TypesetOverlay({ pages, metrics, setup, zoom, editor, typeset }) {
  const rootRef = useRef(null)
  const [stage, setStage] = useState(null)
  const [hover, setHover] = useState(null)
  const [drag, setDrag] = useState(null)
  const [popover, setPopover] = useState(null)
  const [headBox, setHeadBox] = useState(null)
  const [imageHover, setImageHover] = useState(null)
  const [revision, setRevision] = useState(0)

  useLayoutEffect(() => {
    setStage(rootRef.current?.parentElement || null)
  }, [])

  // Which page the pointer is over, from where it is on the stage.
  useEffect(() => {
    if (!stage) return undefined
    const onMove = (event) => {
      const s = stage.getBoundingClientRect()
      const y = (event.clientY - s.top) / zoom
      const index = pages.findIndex((page) => y >= page.top && y < page.top + metrics.height)
      setHover(index >= 0 ? index : null)
      const img = event.target.closest?.('.pl-flow .ProseMirror > * img, .pl-flow .ProseMirror .image-wrapper')
      setImageHover(img && !img.closest('.chapter-head') ? img.closest('[data-node-view-wrapper], .image-wrapper') || img : null)
    }
    const onLeave = () => { if (!drag) setHover(null) }
    stage.addEventListener('pointermove', onMove)
    stage.addEventListener('pointerleave', onLeave)
    return () => {
      stage.removeEventListener('pointermove', onMove)
      stage.removeEventListener('pointerleave', onLeave)
    }
  }, [drag, metrics.height, pages, stage, zoom])

  // Where the chapter's head is, in the stage: after every change to the document.
  useEffect(() => {
    if (!stage || !editor) return undefined
    const measure = () => {
      const top = stage.querySelector('.pl-flow .chapter-head.is-live-top')
      const bottom = stage.querySelector('.pl-flow .chapter-head.is-live-bottom')
      if (!top) {
        setHeadBox(null)
        return
      }
      const a = stageRect(top, stage, zoom)
      const b = bottom ? stageRect(bottom, stage, zoom) : a
      const sink = parseFloat(getComputedStyle(top).paddingTop) || 0
      setHeadBox({ x: a.x, y: a.y, w: a.w, h: b.y + b.h - a.y, sink })
    }
    const frame = requestAnimationFrame(measure)
    editor.on('transaction', measure)
    return () => {
      cancelAnimationFrame(frame)
      editor.off('transaction', measure)
    }
  }, [editor, revision, stage, zoom, pages])

  // A scene break or the chapter's first letter, clicked: their pickers.
  useEffect(() => {
    if (!stage) return undefined
    const onClick = (event) => {
      const flow = event.target.closest?.('.pl-flow .ProseMirror')
      if (!flow) return
      const s = stage.getBoundingClientRect()
      const at = { x: (event.clientX - s.left) / zoom, y: (event.clientY - s.top) / zoom }
      if (event.target.tagName === 'HR') {
        typeset.focus('page.typography')
        setPopover({ kind: 'sceneBreak', ...at })
        return
      }
      const first = flow.querySelector(':scope > .chapter-head.is-live-bottom + p, :scope > h1 + p, :scope > p:first-child')
      if (first && first.contains(event.target) && setup.typography) {
        const range = document.createRange()
        const text = first.firstChild?.nodeType === Node.TEXT_NODE ? first.firstChild : null
        if (!text?.length) return
        range.setStart(text, 0)
        range.setEnd(text, 1)
        const r = range.getBoundingClientRect()
        const big = setup.typography.chapterOpening === 'dropCap' || setup.typography.chapterOpening === 'dropCapAndSmallCaps'
        const reach = big ? 3 : 1.2
        if (event.clientX <= r.right + 4 && event.clientY <= r.bottom + r.height * reach) {
          typeset.focus('book.headings')
          setPopover({ kind: 'opening', ...at })
        }
      }
    }
    stage.addEventListener('click', onClick)
    return () => stage.removeEventListener('click', onClick)
  }, [setup.typography, stage, typeset, zoom])

  /* ---------------- drags ---------------- */

  const startDrag = useCallback((event, spec) => {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setPopover(null)
    typeset.focus(spec.section)
    setDrag({ ...spec, x0: event.clientX, y0: event.clientY, value: spec.start })
  }, [typeset])

  const onPointerMove = useCallback((event) => {
    if (!drag) return
    const dx = (event.clientX - drag.x0) / zoom
    const dy = (event.clientY - drag.y0) / zoom
    setDrag((d) => (d ? { ...d, value: d.compute(dx, dy, event), alt: event.altKey } : d))
  }, [drag, zoom])

  const onPointerUp = useCallback(() => {
    if (!drag) return
    const { value, commit, start, alt } = drag
    setDrag(null)
    if (value !== start && value != null) commit(value, { alt })
    setRevision((n) => n + 1)
  }, [drag])

  const marginDrag = (page, side) => (event) => {
    const key = marginOf(setup, page.physical, side)
    const start = setup.margins[key]
    // Moving the right or bottom edge right or down narrows that margin.
    const sign = side === 'right' || side === 'bottom' ? -1 : 1
    const horizontal = side === 'left' || side === 'right'
    startDrag(event, {
      kind: 'margin',
      side,
      key,
      page: page.strip,
      section: 'page.size',
      start,
      compute: (dx, dy, e) => Math.max(0, round(start + (sign * (horizontal ? dx : dy)) / PX_PER_MM, !e.shiftKey)),
      commit: (value, { alt }) => {
        const margins = { ...setup.margins, [key]: value }
        if (alt) margins[OPPOSITE[key]] = value
        typeset.editSetup({ ...setup, margins }, 'Margins')
      },
    })
  }

  const distanceDrag = (which) => (event) => {
    const key = which === 'header' ? 'headerDistanceMm' : 'footerDistanceMm'
    const start = setup[key]
    const sign = which === 'header' ? 1 : -1
    startDrag(event, {
      kind: 'distance',
      which,
      section: 'page.headerFooter',
      start,
      compute: (dx, dy, e) => Math.max(0, round(start + (sign * dy) / PX_PER_MM, !e.shiftKey)),
      commit: (value) => typeset.editSetup({ ...setup, [key]: value }, which === 'header' ? 'Running Head' : 'Folio'),
    })
  }

  const sinkDrag = (event) => {
    if (!setup.typography) return
    const start = setup.typography.chapterSinkMm
    startDrag(event, {
      kind: 'sink',
      section: 'book.headings',
      start,
      compute: (dx, dy, e) => Math.max(0, round(start + dy / PX_PER_MM, !e.shiftKey)),
      commit: (value) => typeset.editSetup({ ...setup, typography: { ...setup.typography, chapterSinkMm: value } }, 'Chapter Head Position'),
    })
  }

  /** A picture in the head, dragged up or down to another place, or sized by its corner. */
  const pictureDrag = (el, mode) => (event) => {
    const isOrnament = el.classList.contains('ch-ornament')
    if (mode === 'size') {
      const start = typeset.design.imageWidthPct
      const width = headBox?.w || metrics.contentWidth
      startDrag(event, {
        kind: 'pictureSize',
        section: 'book.headings',
        start,
        compute: (dx) => Math.min(100, Math.max(5, Math.round(start + (dx * 2 * 100) / width))),
        commit: (value) => typeset.editDesign({ imageWidthPct: value }, 'Picture Size'),
      })
      return
    }
    const slots = slotAnchors()
    startDrag(event, {
      kind: 'pictureSlot',
      section: 'book.headings',
      start: typeset.design.ornamentPosition,
      from: stageRect(el, stage, zoom),
      compute: (dx, dy) => {
        const y = stageRect(el, stage, zoom).y + dy
        return slots.reduce((best, slot) => (Math.abs(slot.y - y) < Math.abs(best.y - y) ? slot : best), slots[0]).slot
      },
      commit: (slot) => typeset.editDesign({ ornamentPosition: slot }, isOrnament ? 'Ornament' : 'Picture'),
    })
  }

  /** Where each place for a head's picture is, in the stage: above, between, below. */
  const slotAnchors = () => {
    const at = (selector, edge) => {
      const el = stage?.querySelector(`.pl-flow ${selector}`)
      if (!el) return null
      const r = stageRect(el, stage, zoom)
      return edge === 'top' ? r.y : r.y + r.h
    }
    const top = at('.chapter-head.is-live-top', 'top') ?? headBox?.y ?? 0
    const number = at('.chapter-head.is-live-top .ch-number', 'bottom')
    const title = at('.ProseMirror > h1.ch-live-title', 'bottom') ?? at('.chapter-head .ch-title', 'bottom')
    return [
      { slot: 'above', y: top + (headBox?.sink || 0) },
      { slot: 'between', y: number ?? top + 20 },
      { slot: 'below', y: title ?? top + 60 },
    ]
  }

  /* ---------------- the pictures in the head, as handles ---------------- */

  const [pictures, setPictures] = useState([])
  useEffect(() => {
    if (!stage) return
    const els = [...stage.querySelectorAll('.pl-flow .chapter-head :is(.ch-image, .ch-ornament.is-image)')]
    setPictures(els.map((el) => ({ el, rect: stageRect(el, stage, zoom) })))
  }, [headBox, stage, zoom])

  /* ---------------- a picture in the text ---------------- */

  const imagePos = (el) => {
    if (!editor || !el) return null
    try {
      const pos = editor.view.posAtDOM(el, 0)
      const $pos = editor.state.doc.resolve(pos)
      for (let d = $pos.depth; d >= 0; d -= 1) {
        const node = d === $pos.depth ? editor.state.doc.nodeAt(pos) : $pos.node(d)
        if (node?.type.name === 'image') return d === $pos.depth ? pos : $pos.before(d)
      }
      const at = editor.state.doc.nodeAt(pos)
      if (at?.type.name === 'image') return pos
      const before = editor.state.doc.nodeAt(pos - 1)
      return before?.type.name === 'image' ? pos - 1 : null
    } catch {
      return null
    }
  }

  const setImage = (attrs) => {
    const pos = imagePos(imageHover)
    if (pos == null) return
    const tr = editor.state.tr
    for (const [key, value] of Object.entries(attrs)) tr.setNodeAttribute(pos, key, value)
    tr.setMeta(TYPESET_META, true)
    editor.view.dispatch(tr)
  }

  /* ---------------- drawing ---------------- */

  const page = hover != null ? pages[hover] : null
  const dragging = drag?.kind === 'margin' ? pages.find((p) => p.strip === drag.page) : null
  const shown = dragging || page
  const margins = drag?.kind === 'margin' ? { ...setup.margins, [drag.key]: drag.value, ...(drag.alt ? { [OPPOSITE[drag.key]]: drag.value } : {}) } : setup.margins
  const preview = { ...setup, margins }
  const box = shown ? {
    x: shown.left + pageLeftMargin(preview, shown.physical),
    y: shown.top + mmToPx(margins.topMm),
    w: metrics.width - mmToPx(margins.insideMm + margins.outsideMm + margins.gutterMm),
    h: metrics.height - mmToPx(margins.topMm + margins.bottomMm),
  } : null
  const headerY = shown ? shown.top + mmToPx(drag?.kind === 'distance' && drag.which === 'header' ? drag.value : setup.headerDistanceMm) : 0
  const footerY = shown ? shown.top + metrics.height - mmToPx(drag?.kind === 'distance' && drag.which === 'footer' ? drag.value : setup.footerDistanceMm) : 0

  return (
    <div
      ref={rootRef}
      className={`typeset-overlay${drag ? ' is-dragging' : ''}`}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDrag(null)}
    >
      {box && !shown.blank ? (
        <>
          <div className="to-block" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />
          <div className="to-edge is-h" title="Top margin — drag; ⌥ both, ⇧ unsnapped" style={{ left: box.x, top: box.y - GRAB, width: box.w }} onPointerDown={marginDrag(shown, 'top')} />
          <div className="to-edge is-h" title="Bottom margin" style={{ left: box.x, top: box.y + box.h - GRAB, width: box.w }} onPointerDown={marginDrag(shown, 'bottom')} />
          <div className="to-edge is-v" title={`${marginOf(setup, shown.physical, 'left') === 'insideMm' ? 'Inside' : 'Outside'} margin`} style={{ left: box.x - GRAB, top: box.y, height: box.h }} onPointerDown={marginDrag(shown, 'left')} />
          <div className="to-edge is-v" title={`${marginOf(setup, shown.physical, 'right') === 'insideMm' ? 'Inside' : 'Outside'} margin`} style={{ left: box.x + box.w - GRAB, top: box.y, height: box.h }} onPointerDown={marginDrag(shown, 'right')} />
          <div className="to-running is-header" title="Running head — click to edit, drag to move" style={{ left: box.x, top: headerY - 2, width: box.w, height: Math.max(12, box.y - headerY) }}
            onPointerDown={distanceDrag('header')}
            onClick={(e) => { e.stopPropagation(); typeset.focus('page.headerFooter'); setPopover({ kind: 'running', which: 'header', verso: shown.physical % 2 === 0 && Boolean(setup.versoHeader), x: box.x, y: headerY + 14 }) }} />
          <div className="to-running is-footer" title="Folio — click to edit, drag to move" style={{ left: box.x, top: box.y + box.h, width: box.w, height: Math.max(12, footerY - box.y - box.h) }}
            onPointerDown={distanceDrag('footer')}
            onClick={(e) => { e.stopPropagation(); typeset.focus('page.headerFooter'); setPopover({ kind: 'running', which: 'footer', verso: shown.physical % 2 === 0 && Boolean(setup.versoFooter), x: box.x, y: footerY - 170 }) }} />
        </>
      ) : null}

      {headBox && typeset.design ? (
        <>
          {setup.typography ? (
            <div className="to-sink" title="How far down the page the chapter opens — drag" style={{ left: headBox.x, top: headBox.y - 3 + (drag?.kind === 'sink' ? mmToPx(drag.value - drag.start) : 0), width: headBox.w }} onPointerDown={sinkDrag} />
          ) : null}
          <div className="to-headbar" style={{ left: headBox.x + headBox.w / 2, top: headBox.y + headBox.sink - 30 }}>
            {['left', 'center', 'right'].map((align) => (
              <button key={align} type="button" className={typeset.design.alignment === align ? 'is-on' : ''} title={`Set the head ${align}`}
                onClick={() => { typeset.focus('book.headings'); typeset.editDesign({ alignment: align }, 'Head Alignment') }}>
                {align === 'left' ? '⇤' : align === 'center' ? '⇔' : '⇥'}
              </button>
            ))}
            <button type="button" title="The chapter’s number" onClick={(e) => { typeset.focus('book.headings'); setPopover({ kind: 'number', x: headBox.x + headBox.w / 2, y: headBox.y + headBox.sink }) ; e.stopPropagation() }}>№</button>
            <button type="button" title="The ornament" onClick={(e) => { typeset.focus('book.headings'); setPopover({ kind: 'ornament', x: headBox.x + headBox.w / 2, y: headBox.y + headBox.sink }); e.stopPropagation() }}>❦</button>
            <label className="to-file" title="Drop or choose a picture for this chapter’s head">
              ▣
              <input type="file" accept="image/*" onChange={(e) => { const file = e.target.files?.[0]; if (file) typeset.setHeadPicture(file); e.target.value = '' }} />
            </label>
          </div>
          <div className="to-headdrop" style={{ left: headBox.x, top: headBox.y, width: headBox.w, height: headBox.h }}
            onDragOver={(e) => { if ([...(e.dataTransfer?.items || [])].some((i) => i.type.startsWith('image/'))) e.preventDefault() }}
            onDrop={(e) => {
              const file = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith('image/'))
              if (!file) return
              e.preventDefault()
              typeset.setHeadPicture(file)
            }} />
          {pictures.map(({ el, rect }, i) => (
            <div key={i} className="to-picture" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }} onPointerDown={pictureDrag(el, 'slot')} title="Drag above, between or below; drag the corner to size">
              <div className="to-picture-corner" onPointerDown={(e) => pictureDrag(el, 'size')(e)} />
            </div>
          ))}
        </>
      ) : null}

      {imageHover && stage && !drag ? (() => {
        const r = stageRect(imageHover, stage, zoom)
        const setWidth = (pct) => setImage({ width: Math.round((metrics.contentWidth * pct) / 100) })
        return (
          <div className="to-imagebar" style={{ left: r.x + r.w / 2, top: Math.max(0, r.y - 30) }} onPointerEnter={() => setImageHover(imageHover)}>
            {[25, 50, 75, 100].map((pct) => <button key={pct} type="button" onClick={() => setWidth(pct)}>{pct}%</button>)}
            <span className="to-sep" />
            {['left', 'center', 'right'].map((align) => <button key={align} type="button" onClick={() => setImage({ align })}>{align === 'left' ? '⇤' : align === 'center' ? '⇔' : '⇥'}</button>)}
          </div>
        )
      })() : null}

      {drag && drag.kind !== 'pictureSlot' && drag.kind !== 'pictureSize' ? (
        <div className="to-tip" style={{ left: (box?.x || 0) + (box?.w || 0) / 2, top: (drag.kind === 'margin' && (drag.side === 'bottom') ? box?.y + box?.h : box?.y || headBox?.y || 0) - 26 }}>
          {describe(drag.value)}
        </div>
      ) : null}
      {drag?.kind === 'pictureSize' ? <div className="to-tip" style={{ left: headBox?.x + headBox?.w / 2, top: headBox?.y - 26 }}>{drag.value}% of the text width</div> : null}
      {drag?.kind === 'pictureSlot' ? <div className="to-tip" style={{ left: headBox?.x + headBox?.w / 2, top: headBox?.y - 26 }}>{drag.value === 'above' ? 'Above the number' : drag.value === 'between' ? 'Between number and title' : 'Below the title'}</div> : null}

      {popover ? <Popover popover={popover} setup={setup} typeset={typeset} close={() => setPopover(null)} /> : null}
    </div>
  )
}

/** The small editors a click on the page opens: what a head or a folio says, a glyph. */
function Popover({ popover, setup, typeset, close }) {
  const ref = useRef(null)
  useEffect(() => {
    const away = (event) => { if (!ref.current?.contains(event.target)) close() }
    const escape = (event) => { if (event.key === 'Escape') close() }
    window.addEventListener('pointerdown', away, true)
    window.addEventListener('keydown', escape, true)
    return () => {
      window.removeEventListener('pointerdown', away, true)
      window.removeEventListener('keydown', escape, true)
    }
  }, [close])

  const body = (() => {
    if (popover.kind === 'sceneBreak') {
      return (
        <div className="to-glyphs">
          {GLYPHS.map((glyph) => (
            <button key={glyph || 'blank'} type="button" className={setup.typography?.sceneBreak === glyph ? 'is-on' : ''}
              onClick={() => { typeset.editSetup({ ...setup, typography: { ...setup.typography, sceneBreak: glyph } }, 'Scene Break'); close() }}>
              {glyph || 'Blank line'}
            </button>
          ))}
        </div>
      )
    }
    if (popover.kind === 'opening') {
      const options = [['plain', 'Plain'], ['dropCap', 'Drop Cap'], ['smallCaps', 'Small Caps'], ['dropCapAndSmallCaps', 'Drop Cap & Small Caps']]
      return (
        <div className="to-list">
          {options.map(([value, label]) => (
            <button key={value} type="button" className={setup.typography?.chapterOpening === value ? 'is-on' : ''}
              onClick={() => { typeset.editSetup({ ...setup, typography: { ...setup.typography, chapterOpening: value } }, 'Chapter Opening'); close() }}>
              {label}
            </button>
          ))}
        </div>
      )
    }
    if (popover.kind === 'number') {
      const numbering = typeset.numbering || {}
      const styles = [['words', 'One, Two'], ['numerals', '1, 2'], ['roman', 'I, II'], ['none', 'No number']]
      return (
        <div className="to-list">
          {styles.map(([value, label]) => (
            <button key={value} type="button" className={(value === 'none' ? !typeset.design.showNumber : typeset.design.showNumber && numbering.style === value) ? 'is-on' : ''}
              onClick={() => {
                if (value === 'none') typeset.editDesign({ showNumber: false }, 'Chapter Number')
                else typeset.editBook((book) => ({ ...book, chapterNumbering: { ...book.chapterNumbering, style: value }, chapterDesign: { ...book.chapterDesign, showNumber: true } }), 'Chapter Number')
                close()
              }}>
              {label}
            </button>
          ))}
          <label className="to-field">Before it
            <input defaultValue={numbering.prefix ?? 'Chapter'} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
              onBlur={(e) => typeset.editBook((book) => ({ ...book, chapterNumbering: { ...book.chapterNumbering, prefix: e.target.value } }), 'Chapter Number')} />
          </label>
          <div className="to-row">
            First chapter
            {[1, 0].map((n) => (
              <button key={n} type="button" className={(numbering.startAt ?? 1) === n ? 'is-on' : ''}
                onClick={() => typeset.editBook((book) => ({ ...book, chapterNumbering: { ...book.chapterNumbering, startAt: n } }), 'Chapter Number')}>
                {n}
              </button>
            ))}
          </div>
        </div>
      )
    }
    if (popover.kind === 'ornament') {
      const kinds = [['none', 'None'], ['rule', 'A rule'], ['glyph', 'A glyph']]
      return (
        <div className="to-list">
          {kinds.map(([value, label]) => (
            <button key={value} type="button" className={typeset.design.ornament === value ? 'is-on' : ''}
              onClick={() => typeset.editDesign({ ornament: value, ornamentGlyph: value === 'glyph' ? (typeset.design.ornamentGlyph || '❦') : typeset.design.ornamentGlyph }, 'Ornament')}>
              {label}
            </button>
          ))}
          {typeset.design.ornament === 'glyph' ? (
            <div className="to-glyphs">
              {GLYPHS.filter(Boolean).map((glyph) => (
                <button key={glyph} type="button" className={typeset.design.ornamentGlyph === glyph ? 'is-on' : ''}
                  onClick={() => typeset.editDesign({ ornamentGlyph: glyph }, 'Ornament')}>{glyph}</button>
              ))}
            </div>
          ) : null}
        </div>
      )
    }
    // A running head or foot: what its three places say.
    const key = popover.verso ? (popover.which === 'header' ? 'versoHeader' : 'versoFooter') : popover.which
    const text = setup[key] || { left: '', center: '', right: '' }
    const set = (slot, value) => typeset.editSetup({ ...setup, [key]: { ...text, [slot]: value } }, popover.which === 'header' ? 'Running Head' : 'Folio')
    return (
      <div className="to-list to-running-editor">
        <strong>{popover.which === 'header' ? 'Running head' : 'Foot'}{popover.verso ? ', left-hand pages' : ''}</strong>
        {['left', 'center', 'right'].map((slot) => (
          <label key={slot} className="to-field">{slot[0].toUpperCase() + slot.slice(1)}
            <input defaultValue={text[slot]} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} onBlur={(e) => { if (e.target.value !== text[slot]) set(slot, e.target.value) }} />
          </label>
        ))}
        <div className="to-tokens">{RUNNING_TOKENS.map((token) => <code key={token}>{token}</code>)}</div>
        {popover.which === 'footer' ? (
          <div className="to-row">
            Numerals
            {[['arabic', '1'], ['lowerRoman', 'i'], ['upperRoman', 'I']].map(([value, label]) => (
              <button key={value} type="button" className={setup.pageNumberFormat === value ? 'is-on' : ''}
                onClick={() => typeset.editSetup({ ...setup, pageNumberFormat: value }, 'Folio')}>{label}</button>
            ))}
          </div>
        ) : null}
      </div>
    )
  })()

  return (
    <div ref={ref} className="to-popover" style={{ left: popover.x, top: popover.y }} onPointerDown={(e) => e.stopPropagation()}>
      {body}
    </div>
  )
}

/** A note that a change to the book was made, with the way back from it. */
export function TypesetToast({ toast, onUndo, onDone }) {
  useEffect(() => {
    if (!toast) return undefined
    const timer = setTimeout(onDone, 6000)
    return () => clearTimeout(timer)
  }, [onDone, toast])
  if (!toast) return null
  return createPortal(
    <div className="typeset-toast" role="status">
      <span>{toast.label} changed for the whole book.</span>
      <button type="button" onClick={onUndo}>Undo</button>
    </div>,
    document.body
  )
}

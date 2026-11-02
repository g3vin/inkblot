/**
 * ToolWheel.jsx — act on a selection: a ring of tools that blooms where the hand is.
 *
 * Like the ink wheel, every tool always opens in the same place, so a flick toward Bold
 * is Bold wherever the wheel appears and the hand learns the way. Unlike it, nothing is
 * held in the middle: the middle is a rest where nothing is chosen, and the tool the
 * hand points at is the one taken.
 *
 * - `hold`: opened by holding a key. The pointer stays visible and its direction from
 *   where it was when the wheel opened picks a tool; letting go of the key takes it, or
 *   nothing from the rest.
 * - `sticky`: opened by a tap of that key. It stays until a tool is clicked, or Escape
 *   or a click outside.
 * - `keyboard`: the arrows (or 1–9) turn round it and Enter takes.
 * - `touch`: opened by a long press. The finger that opened it drags toward a tool and
 *   lifting takes it; lifted at rest, the wheel stays open to tap, as `sticky`.
 *
 * A tool with a `submenu` (Highlight's inks) re-blooms as its options, centred where the
 * hand rested on it, after a moment there; from the keyboard, Space opens it and
 * Backspace goes back.
 *
 * The wheel is controlled: whoever opened it mounts it and unmounts it on `onClose`.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon.jsx'
import { SPRINGS, springEasing } from './physics.js'
import { TOOL_DEAD_ZONE, TOOL_DISC, TOOL_HIT, hitSlot, pickSlot, placeRing, slotOffset, stepSlot, toolRingRadius } from './inkWheelGeometry.js'
import './ToolWheel.css'

// Resting on a tool with options this long opens them.
const DWELL_MS = 350
// The ring folds away on --spring-exit (ToolWheel.css) before it unmounts: its settle time.
const CLOSE_MS = springEasing(SPRINGS.exit).duration
// Room under the ring for the targeted tool's name.
const NAME_ROOM = 32

const reducedMotion = () => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)

/**
 * @typedef {{
 *   id: string,
 *   label: string,
 *   icon?: string,
 *   color?: string,
 *   active?: boolean,
 *   disabled?: boolean,
 *   submenu?: ToolWheelItem[],
 * }} ToolWheelItem
 *
 * An item shows its `icon`, or a dot of `color` (an ink). `active` draws the icon filled
 * (the selection is already bold); a disabled tool keeps its place, dimmed, so the ring
 * never rearranges.
 */

/**
 * @param {{
 *   anchor: { x: number, y: number },
 *   items: ToolWheelItem[],
 *   label: string,
 *   mode?: 'hold' | 'sticky' | 'keyboard' | 'touch',
 *   holdKey?: string,
 *   fromPointer?: boolean,
 *   onPick: (id: string, optionId?: string) => void,
 *   onClose: () => void,
 * }} props
 *
 * `holdKey` is the `KeyboardEvent.key` whose release takes the tool in `hold` mode.
 * `fromPointer` says the anchor is where the pointer is; otherwise (opened at the caret)
 * the hand's direction is measured from wherever the pointer is first seen.
 */
export default function ToolWheel({ anchor, items, label, mode: openedAs = 'sticky', holdKey = 'Alt', fromPointer = false, onPick, onClose }) {
  const uid = useId()
  // A touch lifted at rest leaves the wheel open to tap: it carries on as `sticky`.
  const [mode, setMode] = useState(openedAs)
  const ringRef = useRef(null)
  const [level, setLevel] = useState(null)
  const list = level ? level.submenu : items
  const count = list.length
  const radius = toolRingRadius(count)
  const [centre, setCentre] = useState(() => placeFor(anchor, toolRingRadius(items.length)))
  const [target, setTarget] = useState(mode === 'keyboard' ? firstEnabled(items) : null)
  const [phase, setPhase] = useState('enter')

  // What the window's handlers read, so they are added once per level.
  const live = useRef({})
  useLayoutEffect(() => { live.current = { list, count, radius, centre, target, phase, level } })
  const originRef = useRef(fromPointer ? anchor : null)
  const pointerRef = useRef(fromPointer ? anchor : null)
  const dwellRef = useRef(0)
  const closeTimerRef = useRef(0)
  const onPickRef = useRef(onPick)
  const onCloseRef = useRef(onClose)
  useLayoutEffect(() => {
    onPickRef.current = onPick
    onCloseRef.current = onClose
  })

  // Draw the discs folded into the middle first, then let them bloom.
  useLayoutEffect(() => {
    if (phase !== 'enter') return
    void ringRef.current?.getBoundingClientRect()
    setPhase('open')
  }, [phase])

  useLayoutEffect(() => { ringRef.current?.focus({ preventScroll: true }) }, [])
  useEffect(() => () => {
    window.clearTimeout(dwellRef.current)
    window.clearTimeout(closeTimerRef.current)
  }, [])

  // Set at once, not on the next render: a key and a press in the same moment take once.
  const closedRef = useRef(false)
  const close = useCallback(() => {
    if (closedRef.current) return
    closedRef.current = true
    window.clearTimeout(dwellRef.current)
    setPhase('closing')
    closeTimerRef.current = window.setTimeout(() => onCloseRef.current?.(), reducedMotion() ? 0 : CLOSE_MS)
  }, [])

  /** Take the item at `index`; a disabled one is passed over. */
  const take = useCallback((index) => {
    const { list: current, level: parent } = live.current
    if (closedRef.current) return
    const item = index === null || index === undefined ? null : current[index]
    if (!item) { close(); return }
    if (item.disabled) return
    if (parent) onPickRef.current?.(parent.id, item.id)
    else onPickRef.current?.(item.id)
    close()
  }, [close])

  /** Re-bloom as a tool's options, centred where the hand is now. */
  const openSubmenu = useCallback((index) => {
    const item = live.current.list[index]
    if (!item?.submenu?.length || item.disabled) return
    const at = pointerRef.current ?? live.current.centre
    setCentre(placeFor(at, toolRingRadius(item.submenu.length)))
    originRef.current = pointerRef.current
    setLevel(item)
    setTarget(mode === 'keyboard' || !pointerRef.current ? firstEnabled(item.submenu) : null)
    setPhase('enter')
  }, [mode])

  const back = useCallback(() => {
    const parent = live.current.level
    if (!parent) { close(); return }
    setCentre(placeFor(anchor, toolRingRadius(items.length)))
    originRef.current = fromPointer ? anchor : pointerRef.current
    setLevel(null)
    setTarget(Math.max(items.indexOf(parent), 0))
    setPhase('enter')
  }, [anchor, close, fromPointer, items])

  const aim = useCallback((next) => {
    if (next === live.current.target) return
    setTarget(next)
    window.clearTimeout(dwellRef.current)
    const item = next === null ? null : live.current.list[next]
    if (item?.submenu?.length && !item.disabled && !live.current.level) {
      dwellRef.current = window.setTimeout(() => openSubmenu(next), DWELL_MS)
    }
  }, [openSubmenu])

  useEffect(() => {
    const local = (point) => ({ x: point.x - live.current.centre.x, y: point.y - live.current.centre.y })

    const onMove = (event) => {
      if (closedRef.current) return
      const point = { x: event.clientX, y: event.clientY }
      pointerRef.current = point
      if (!originRef.current) originRef.current = point
      if (mode === 'keyboard') {
        const hit = hitSlot(local(point), live.current.count, live.current.radius, TOOL_HIT)
        if (hit !== null) aim(hit)
        return
      }
      if (mode === 'sticky') {
        aim(hitSlot(local(point), live.current.count, live.current.radius, TOOL_HIT))
        return
      }
      const origin = originRef.current
      aim(pickSlot({ x: point.x - origin.x, y: point.y - origin.y }, live.current.count, live.current.target, { deadZone: TOOL_DEAD_ZONE }))
    }

    // Nothing behind the wheel hears a press: the editor keeps its selection.
    const onDown = (event) => {
      event.stopPropagation()
      event.preventDefault()
      if (closedRef.current) return
      if (mode === 'hold') { take(live.current.target); return }
      const point = local({ x: event.clientX, y: event.clientY })
      const hit = hitSlot(point, live.current.count, live.current.radius, TOOL_HIT)
      if (hit !== null) take(hit)
      // A press between the discs is a near miss; only one well outside the ring closes.
      else if (Math.hypot(point.x, point.y) > live.current.radius + TOOL_DISC) close()
    }
    const swallow = (event) => {
      event.stopPropagation()
      if (event.cancelable) event.preventDefault()
    }

    // The finger that opened it lets go: of the tool it points at, or into `sticky`.
    const onUp = (event) => {
      swallow(event)
      if (mode !== 'touch' || closedRef.current) return
      if (live.current.target !== null) take(live.current.target)
      else setMode('sticky')
    }
    // The system took the touch (a scroll, its own menu): keep the wheel to tap.
    const onPointerCancel = () => { if (mode === 'touch') setMode('sticky') }

    const onKeyDown = (event) => {
      const { target: current, count: n, list: options } = live.current
      if (closedRef.current) { event.preventDefault(); event.stopPropagation(); return }
      if (mode === 'hold' && event.key === holdKey) { event.preventDefault(); event.stopPropagation(); return }
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key]
      if (step) setTarget(stepSlot(current, step, n))
      else if (event.key === 'Home') setTarget(0)
      else if (event.key === 'End') setTarget(n - 1)
      else if (/^[1-9]$/.test(event.key) && Number(event.key) <= n) setTarget(Number(event.key) - 1)
      else if (event.key === 'Enter') take(current)
      else if (event.key === ' ') {
        if (current !== null && options[current]?.submenu?.length) openSubmenu(current)
        else take(current)
      } else if (event.key === 'Backspace') back()
      else if (event.key === 'Escape') { if (live.current.level) back(); else close() }
      // Anything else (Tab, a letter typed in a hurry) puts the wheel away untouched.
      else close()
      event.preventDefault()
      event.stopPropagation()
    }

    const onKeyUp = (event) => {
      if (mode !== 'hold' || event.key !== holdKey) return
      event.preventDefault()
      event.stopPropagation()
      take(live.current.target)
    }

    const onCancel = () => close()
    const onVisibility = () => { if (document.hidden) close() }

    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onPointerCancel, true)
    // While the finger steers the wheel, it doesn't scroll the page under it.
    window.addEventListener('touchmove', swallow, { capture: true, passive: false })
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', onCancel)
    window.addEventListener('resize', onCancel)
    document.addEventListener('visibilitychange', onVisibility)
    const swallowed = ['mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu']
    swallowed.forEach((type) => window.addEventListener(type, swallow, true))
    return () => {
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onPointerCancel, true)
      window.removeEventListener('touchmove', swallow, { capture: true })
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', onCancel)
      window.removeEventListener('resize', onCancel)
      document.removeEventListener('visibilitychange', onVisibility)
      swallowed.forEach((type) => window.removeEventListener(type, swallow, true))
    }
  }, [aim, back, close, holdKey, mode, openSubmenu, take])

  const named = target !== null ? list[target] : null
  const name = named ? named.label : level ? level.label : label
  const hint = mode === 'keyboard' && named?.submenu?.length && !level ? 'Space for more' : null

  return createPortal(
    <div className="ib-tool-wheel" data-tool-wheel="" data-mode={mode} data-phase={phase}>
      <ToolRing
        ringRef={ringRef}
        uid={uid}
        label={level ? level.label : label}
        list={list}
        radius={radius}
        target={target}
        name={name}
        hint={hint}
        style={{ left: centre.x, top: centre.y }}
      />
    </div>,
    document.body,
  )
}

/**
 * The wheel drawn where it stands, open and still: Settings shows the writer's own ring
 * with it as they choose the tools.
 */
export function ToolWheelPreview({ items, label, target = null }) {
  const uid = useId()
  const radius = toolRingRadius(items.length)
  const size = 2 * (radius + TOOL_DISC / 2) + 4
  return (
    <div className="ib-tool-wheel-preview" data-phase="open" style={{ width: size, height: size + NAME_ROOM }}>
      <ToolRing
        uid={uid}
        label={label}
        list={items}
        radius={radius}
        target={target}
        name={target !== null ? items[target]?.label : label}
        style={{ left: size / 2, top: size / 2 }}
        preview
      />
    </div>
  )
}

function ToolRing({ ringRef, uid, label, list, radius, target, name, hint, style, preview = false }) {
  const count = list.length
  return (
    <div
      ref={ringRef}
      className="ib-tool-wheel-ring"
      role={preview ? 'img' : 'menu'}
      tabIndex={preview ? undefined : -1}
      aria-label={preview ? `${label}: ${list.map((item) => item.label).join(', ')}` : label}
      aria-activedescendant={!preview && target !== null ? `${uid}-${target}` : undefined}
      style={style}
    >
      <span className="ib-tool-wheel-hub" aria-hidden="true" />
      {list.map((item, index) => {
        const at = slotOffset(index, count, radius)
        const checkable = typeof item.active === 'boolean'
        return (
          <span
            key={item.id}
            id={preview ? undefined : `${uid}-${index}`}
            role={preview ? undefined : checkable ? 'menuitemcheckbox' : 'menuitem'}
            aria-checked={!preview && checkable ? item.active : undefined}
            aria-disabled={!preview && item.disabled ? 'true' : undefined}
            aria-haspopup={!preview && item.submenu?.length ? 'menu' : undefined}
            aria-label={preview ? undefined : item.label}
            aria-hidden={preview ? 'true' : undefined}
            className="ib-tool-wheel-slot"
            data-target={index === target ? 'true' : undefined}
            data-active={item.active ? 'true' : undefined}
            data-disabled={item.disabled ? 'true' : undefined}
            style={{ '--tx': `${at.x}px`, '--ty': `${at.y}px`, '--order': index }}
          >
            {item.color
              ? <span className="ib-tool-wheel-swatch" style={{ '--swatch': item.color }} />
              : <Icon name={item.icon} size={20} active={Boolean(item.active)} />}
            {item.submenu?.length ? <span className="ib-tool-wheel-more" aria-hidden="true" /> : null}
          </span>
        )
      })}
      <span className="ib-tool-wheel-name" aria-hidden="true" style={{ '--below': `${radius + TOOL_DISC / 2 + 10}px` }}>
        {name}
        {hint ? <span className="ib-tool-wheel-hint">{hint}</span> : null}
      </span>
    </div>
  )
}

/** Centre the ring on `at`, nudged in so it and the name under it stay in the window. */
function placeFor(at, radius) {
  const extent = radius + TOOL_DISC / 2 + 8
  return placeRing(at, { left: extent, right: extent, top: extent, bottom: extent + NAME_ROOM }, { width: window.innerWidth, height: window.innerHeight })
}

function firstEnabled(list) {
  const index = list.findIndex((item) => !item.disabled)
  return index >= 0 ? index : null
}

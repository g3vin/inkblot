/**
 * InkWheel.jsx — choose an ink for a thing on the page (a note, a cell, a card, a pin).
 *
 * The control is the thing's own colour. Pressing it blooms the palette out of it,
 * every dot at once, into a ring of floating dots.
 * Every ink always opens in the same place, so a hand learns where each one is; the
 * current ink's place is an empty socket while it sits in the middle.
 *
 * The middle dot is what you move. Swipe toward an ink: the held dot gives a little,
 * on a band that stiffens, and the ink leans in to meet it. Far enough, and the two
 * trade places: the ink slides straight in under the held colour, which goes out over
 * it into the ink's place, each stretching as it goes. At rest they never overlap. Let go then and the new colour
 * settles in the middle while the ring folds back into the control. Before letting go,
 * swipe back toward the middle to trade them back, or swing round to another ink.
 * Letting go without a swap keeps the colour as it was.
 *
 * With a mouse the pointer is hidden: the middle dot stands in for it. Pointer Lock keeps
 * the hand's travel unbounded and puts the cursor back where it started; where the
 * webview refuses it, the cursor is only hidden. A click that opens the wheel leaves it
 * open, the swipe then needs no button held, and a second click lets go.
 *
 * Touch and pen drag the same way, or tap an ink. The keyboard opens it with Enter,
 * Space or ↓, turns round it with the arrows (or 1–9) and takes with Enter.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal, flushSync } from 'react-dom'
import { INKS, inkColor, inkVar, legacyInkFor } from '../lib/palette'
import { CENTRE, DEAD_ZONE, DOT, LEAN_GROW, LEAN_MAX, clampToReach, dragState, heldOffset, hitSlot, leanFor, placeRing, ringRadius, slotAngle, slotOffset, stepSlot } from './inkWheelGeometry.js'
import { SPRINGS, springEasing } from './physics.js'
import { springTiming } from './useSpring.js'
import './InkWheel.css'

// The springs InkWheel.css moves on: the bloom on --spring-smooth plus its stagger,
// the taken ink to the middle on --spring-quick, the fold on --spring-exit plus its
// stagger.
const OPEN_MS = springEasing(SPRINGS.smooth).duration
const OPEN_STAGGER_MS = 18
const SETTLE_MS = springEasing(SPRINGS.quick).duration
const FOLD_MS = springEasing(SPRINGS.exit).duration
const CLOSE_STAGGER_MS = 8

// A swap (and its undo) springs (--spring-smooth): the ink ahead slides straight in
// under the held colour, which goes out over it to the ink's place. How far a moving
// dot stretches.
const STRETCH = { long: 1.3, short: 0.8 }

const reducedMotion = () => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
const LIVE = new Set(['open', 'ready'])
// What React draws from; the rest of the gesture is painted without a render.
const DRAWN = ['phase', 'mode', 'target', 'swapped', 'picked']

/**
 * @param {{
 *   value: string | null | undefined,
 *   onChange: (id: string | null) => void,
 *   label: string,
 *   inks?: readonly string[],
 *   none?: { label: string, color?: string },
 *   as?: import('react').ElementType,
 *   triggerProps?: object,
 *   onOpenChange?: (open: boolean) => void,
 *   disabled?: boolean,
 *   className?: string,
 * }} props
 *
 * `value` is an ink id, `null` for `none`, or `undefined` when the colour isn't known
 * (a mixed selection): then no place is the socket. Any other string (a custom hex
 * from before the palette) is shown in the middle as it is.
 *
 * `none` adds a hollow last place that picks `null`: "No fill", or "Default" with the
 * colour the default draws in.
 *
 * `as` draws the control instead of the plain colour dot (an `IconButton`, or a
 * `'button'`), given `triggerProps` and then the wheel's own ref, handlers and ARIA.
 */
export default function InkWheel({ value, onChange, label, inks, none, as: Trigger = ColorDot, triggerProps: extra = null, onOpenChange, disabled = false, className = '' }) {
  const ids = inks ? INKS.filter((ink) => inks.includes(ink.id)).sort((a, b) => inks.indexOf(a.id) - inks.indexOf(b.id)) : INKS
  const options = [
    ...ids.map((ink) => ({ id: ink.id, label: ink.label, color: inkVar(ink.id) })),
    ...(none ? [{ id: null, label: none.label, color: none.color ?? null }] : []),
  ]
  const count = options.length
  const valueInk = value === null ? null : legacyInkFor(value) ?? value
  const currentIndex = value === undefined ? -1 : options.findIndex((option) => option.id === valueInk)
  const currentColor = value === null || value === undefined ? none?.color ?? null : inkColor(value)
  const currentName = currentIndex >= 0 ? options[currentIndex].label : null

  const uid = useId()
  const triggerRef = useRef(null)
  const setTrigger = useCallback((node) => { triggerRef.current = node }, [])
  const overlayRef = useRef(null)
  const ringRef = useRef(null)
  const timersRef = useRef([])
  const onChangeRef = useRef(onChange)
  const optionsRef = useRef(options)
  useLayoutEffect(() => {
    onChangeRef.current = onChange
    optionsRef.current = options
  })
  // The gesture as the handlers read it. `session` is the same state for React, which
  // re-renders only when something discrete changes (a phase, a target, a swap); the
  // dots' positions follow the hand every frame and are painted straight onto them.
  const gestureRef = useRef(null)
  const [session, setSession] = useState(null)
  const slotRefs = useRef([])
  const heldRef = useRef(null)
  const paintedRef = useRef(null)
  const frameRef = useRef(0)

  const paint = useCallback(() => {
    const g = gestureRef.current
    if (!g) { paintedRef.current = null; return }
    const { slots, held } = layout(g, count)
    const lays = [...slots, held]
    const elements = [...slotRefs.current.slice(0, count), heldRef.current]
    const previous = paintedRef.current
    const trading = previous && previous.swapped !== g.swapped && LIVE.has(g.phase) && !reducedMotion()
    elements.forEach((element, index) => {
      if (!element) return
      const to = lays[index]
      const from = previous?.lays[index]
      if (trading && from && Math.hypot(from.x - to.x, from.y - to.y) > 2) trade(element, from, to)
      element.style.setProperty('--tx', `${to.x}px`)
      element.style.setProperty('--ty', `${to.y}px`)
      element.style.setProperty('--scale', String(to.scale))
      element.style.setProperty('--opacity', String(to.opacity))
    })
    paintedRef.current = { swapped: g.swapped, lays }
  }, [count])

  const schedulePaint = useCallback(() => {
    if (frameRef.current) return
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = 0
      paint()
    })
  }, [paint])
  useEffect(() => () => window.cancelAnimationFrame(frameRef.current), [])

  const patch = useCallback((next) => {
    const g = gestureRef.current
    if (!g) return
    gestureRef.current = { ...g, ...next }
    if (DRAWN.some((key) => key in next && next[key] !== g[key])) setSession(gestureRef.current)
    else schedulePaint()
  }, [schedulePaint])

  const later = useCallback((fn, ms) => { timersRef.current.push(window.setTimeout(fn, ms)) }, [])
  useEffect(() => () => timersRef.current.forEach((timer) => window.clearTimeout(timer)), [])

  const releasePointer = useCallback(() => {
    if (document.pointerLockElement && document.pointerLockElement === overlayRef.current) document.exitPointerLock?.()
  }, [])

  const finish = useCallback(() => {
    const hadFocus = overlayRef.current?.contains(document.activeElement)
    gestureRef.current = null
    setSession(null)
    onOpenChange?.(false)
    // Back to the control, unless the pick already put focus somewhere (an editor).
    if (hadFocus || document.activeElement === document.body) triggerRef.current?.focus({ preventScroll: true })
  }, [onOpenChange])

  /** Let go: take the ink at `picked`, or keep the colour as it was (null). */
  const close = useCallback((picked) => {
    const g = gestureRef.current
    if (!g || !LIVE.has(g.phase)) return
    releasePointer()
    const still = reducedMotion()
    const closeMs = still ? 0 : FOLD_MS + (count + 1) * CLOSE_STAGGER_MS
    // Taken: the ink reaches the middle while the rest fold, then sinks into the control.
    if (picked === null) {
      patch({ phase: 'closing', swapped: null, point: { x: 0, y: 0 } })
      later(finish, closeMs)
      return
    }
    if (picked !== g.startIndex) onChangeRef.current?.(optionsRef.current[picked].id)
    patch({ phase: 'settling', picked, swapped: null })
    later(() => patch({ phase: 'closing' }), still ? 0 : SETTLE_MS)
    later(finish, closeMs + (still ? 0 : SETTLE_MS))
  }, [count, finish, later, patch, releasePointer])

  const open = (mode, event) => {
    if (disabled || gestureRef.current) return
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const anchor = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    const extent = ringRadius(count) + DOT / 2 + 8
    const centre = placeRing(anchor, { left: extent, right: extent, top: extent, bottom: extent }, { width: window.innerWidth, height: window.innerHeight })
    const next = {
      mode,
      phase: 'enter',
      centre,
      from: { x: anchor.x - centre.x, y: anchor.y - centre.y },
      startIndex: currentIndex,
      startColor: currentColor,
      // Where the middle dot has been moved to, what it is heading for and swapped with.
      point: { x: 0, y: 0 },
      target: mode === 'keyboard' ? Math.max(currentIndex, 0) : null,
      swapped: null,
      picked: null,
      // The press that opened it: a drag if it travels, a click if it doesn't.
      pressing: Boolean(event),
      opening: Boolean(event),
      travelled: false,
      start: event ? { x: event.clientX, y: event.clientY } : null,
      locked: false,
    }
    gestureRef.current = next
    paintedRef.current = null
    flushSync(() => {
      onOpenChange?.(true)
      setSession(next)
    })
    ringRef.current?.focus({ preventScroll: true })
    if (mode === 'mouse') {
      try {
        const request = overlayRef.current?.requestPointerLock?.()
        if (request && typeof request.catch === 'function') request.catch(() => {})
      } catch {
        // Refused: the cursor stays hidden over the overlay instead.
      }
    }
  }

  // Every render repaints, before the browser does, so React's view and the painted
  // positions never disagree.
  useLayoutEffect(() => { paint() })

  // Draw the dots inside the control first, then let them bloom; once they have, the
  // stagger stops applying to them.
  useLayoutEffect(() => {
    if (session?.phase !== 'enter') return
    void ringRef.current?.getBoundingClientRect()
    patch({ phase: 'open' })
    later(() => { if (gestureRef.current?.phase === 'open') patch({ phase: 'ready' }) }, reducedMotion() ? 0 : OPEN_MS + count * OPEN_STAGGER_MS)
  }, [session?.phase, count, later, patch])

  const isOpen = Boolean(session) && session.phase !== 'closing' && session.phase !== 'settling'

  useEffect(() => {
    if (!isOpen) return undefined
    const overlay = overlayRef.current
    const g = () => gestureRef.current
    const local = (event) => ({ x: event.clientX - g().centre.x, y: event.clientY - g().centre.y })

    const moveTo = (point) => {
      const s = g()
      const next = dragState(point, count, s)
      // Travel is measured on the hand: a locked pointer's position never changes.
      const travelled = s.travelled || (s.pressing && Math.hypot(point.x, point.y) >= DEAD_ZONE)
      patch({ point, target: next.target, swapped: next.swapped, travelled })
    }

    const onMove = (event) => {
      const s = g()
      if (!s || !LIVE.has(s.phase)) return
      if (s.mode === 'keyboard') {
        // Pointing at an ink after opening from the keyboard: that ink is the one Enter takes.
        const hit = hitSlot(local(event), count)
        if (hit !== null && hit !== s.target) patch({ target: hit })
        return
      }
      if (s.mode === 'mouse' && document.pointerLockElement === overlay) {
        moveTo(clampToReach({ x: s.point.x + (event.movementX || 0), y: s.point.y + (event.movementY || 0) }))
        return
      }
      // A finger (or a mouse the webview wouldn't lock) drags only while pressed, from
      // wherever it went down.
      if (s.mode !== 'mouse' && !s.pressing) return
      moveTo(clampToReach(s.mode === 'mouse' ? local(event) : { x: event.clientX - s.start.x, y: event.clientY - s.start.y }))
    }

    const onDown = (event) => {
      const s = g()
      if (!s || !LIVE.has(s.phase)) return
      patch({ pressing: true, travelled: false, start: { x: event.clientX, y: event.clientY } })
    }

    const onUp = (event) => {
      const s = g()
      if (!s || !LIVE.has(s.phase) || !s.pressing) return
      const opening = s.opening
      patch({ pressing: false, opening: false })
      if (s.swapped !== null) { close(s.swapped); return }
      // A tap or click that opened it leaves it open for a swipe or a tap on an ink.
      if (opening && !s.travelled) return
      // Without a swap, a mouse lets go of nothing: the hidden pointer is the middle dot.
      if (s.mode === 'mouse') { close(null); return }
      const hit = s.travelled ? null : hitSlot(local(event), count)
      if (s.mode === 'keyboard' && hit === null && !s.travelled) { close(null); return }
      close(hit)
    }

    const onCancel = () => close(null)
    const onLockChange = () => {
      const s = g()
      if (!s) return
      if (document.pointerLockElement === overlay) patch({ locked: true })
      else if (s.locked) close(null) // the webview took the lock back (Escape)
    }
    const onVisibility = () => { if (document.hidden) close(null) }

    // Nothing behind the wheel hears the gesture: no drag starts, no "outside" click
    // closes the card it came from, no editor loses its caret.
    const swallow = (event) => {
      event.stopPropagation()
      if (event.type === 'mousedown' || event.type === 'contextmenu') event.preventDefault()
    }
    const swallowed = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu']

    const onKey = (event) => {
      const s = g()
      if (!s || !LIVE.has(s.phase)) return
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key]
      let handled = true
      if (step) patch({ target: stepSlot(s.target, step, count) })
      else if (event.key === 'Home') patch({ target: 0 })
      else if (event.key === 'End') patch({ target: count - 1 })
      else if (/^[1-9]$/.test(event.key) && Number(event.key) <= count) patch({ target: Number(event.key) - 1 })
      else if (event.key === 'Enter' || event.key === ' ') close(s.swapped ?? s.target)
      else if (event.key === 'Escape' || event.key === 'Tab') close(null)
      else handled = false
      if (handled) event.preventDefault()
      event.stopPropagation()
    }

    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onCancel, true)
    window.addEventListener('blur', onCancel)
    window.addEventListener('resize', onCancel)
    document.addEventListener('pointerlockchange', onLockChange)
    document.addEventListener('visibilitychange', onVisibility)
    swallowed.forEach((type) => overlay?.addEventListener(type, swallow))
    overlay?.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onCancel, true)
      window.removeEventListener('blur', onCancel)
      window.removeEventListener('resize', onCancel)
      document.removeEventListener('pointerlockchange', onLockChange)
      document.removeEventListener('visibilitychange', onVisibility)
      swallowed.forEach((type) => overlay?.removeEventListener(type, swallow))
      overlay?.removeEventListener('keydown', onKey)
    }
  }, [isOpen, close, count, patch])

  // Leaving mid-gesture (the control unmounts) must not strand a hidden cursor.
  useEffect(() => releasePointer, [releasePointer])

  const triggerProps = {
    ref: setTrigger,
    type: 'button',
    disabled,
    'aria-label': currentName ? `${label}: ${currentName}` : label,
    'aria-haspopup': 'listbox',
    'aria-expanded': Boolean(session),
    style: { ...extra?.style, touchAction: 'none' },
    onPointerDown: (event) => {
      if (event.button !== 0 || disabled) return
      // Stop here: a press on the control is not a drag of what it sits on, nor a
      // focus change (the editor keeps its caret).
      event.stopPropagation()
      event.preventDefault()
      open(event.pointerType === 'mouse' ? 'mouse' : 'touch', event)
    },
    onClick: (event) => {
      event.stopPropagation()
      // A click from the keyboard (Enter, Space) or a label has no pointer press.
      if (event.detail === 0) open('keyboard', null)
    },
    onKeyDown: (event) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      event.preventDefault()
      event.stopPropagation()
      open('keyboard', null)
    },
  }

  const s = session
  const active = s ? s.swapped ?? s.target : null

  return (
    <>
      {Trigger === ColorDot
        ? <ColorDot {...extra} {...triggerProps} className={className} color={currentColor} />
        : <Trigger {...extra} {...triggerProps} />}
      {s ? createPortal(
        <div
          ref={overlayRef}
          className="ib-ink-wheel"
          data-ink-wheel=""
          data-mode={s.mode}
          data-phase={s.phase}
        >
          <div
            ref={ringRef}
            className="ib-ink-wheel-ring"
            role="listbox"
            tabIndex={-1}
            aria-label={label}
            aria-activedescendant={active !== null && active !== undefined ? `${uid}-${active}` : undefined}
            style={{ left: s.centre.x, top: s.centre.y }}
          >
            {options.map((option, index) => (
              <span
                key={option.id ?? 'none'}
                id={`${uid}-${index}`}
                role="option"
                aria-selected={index === s.startIndex}
                aria-label={option.label}
                ref={(element) => { slotRefs.current[index] = element }}
                className="ib-ink-wheel-dot"
                data-socket={index === s.startIndex ? 'true' : undefined}
                data-target={index === s.target && s.swapped === null && s.picked === null ? 'true' : undefined}
                data-in-hand={index === s.swapped ? 'true' : undefined}
                data-centre={index === s.swapped ? 'true' : undefined}
                data-picked={index === s.picked ? 'true' : undefined}
                data-empty={option.color ? undefined : 'true'}
                data-none={option.id === null ? 'true' : undefined}
                style={{
                  '--swatch': option.color ?? 'var(--text-secondary)',
                  '--axis': `${slotAngle(index, count) - 90}deg`,
                  '--close-order': index === s.picked ? 0 : count - 1 - index,
                }}
              >
                <span className="ib-ink-wheel-face" />
              </span>
            ))}
            <span
              ref={heldRef}
              className="ib-ink-wheel-dot ib-ink-wheel-held"
              aria-hidden="true"
              data-empty={s.startColor ? undefined : 'true'}
              data-taken={s.picked !== null ? 'true' : undefined}
              data-centre={s.swapped === null ? 'true' : undefined}
              style={{
                '--swatch': s.startColor ?? 'var(--text-secondary)',
                '--axis': s.picked !== null ? `${slotAngle(s.picked, count) - 90}deg` : '0deg',
                // The old colour folds from the place it was swapped into, or last of all
                // if nothing was taken.
                '--close-order': s.picked !== null ? count - 1 - s.picked : count,
              }}
            >
              <span className="ib-ink-wheel-face" />
            </span>
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  )
}

/** The plain control: the thing's colour as a dot. */
function ColorDot({ color, className = '', ...rest }) {
  return (
    <button {...rest} className={`ib-ink-wheel-trigger ${className}`.trim()} title={rest['aria-label']}>
      <span className="ib-ink-wheel-trigger-dot" data-empty={color ? undefined : 'true'} style={{ '--swatch': color ?? 'transparent' }} />
    </button>
  )
}

/**
 * Where every dot is drawn for a moment of the gesture, as an offset from the ring's
 * centre, a scale and an opacity: the ring's inks, then the old colour that starts in
 * the middle (`held`).
 *
 * Settling, the taken ink moves to the middle while everything else folds away at once;
 * closing, it sinks into the control too.
 */
function layout(s, count) {
  const radius = ringRadius(count)
  const grow = CENTRE / DOT
  const at = (point, scale, opacity = 1) => ({ x: point.x, y: point.y, scale, opacity })
  const hidden = (scale) => at(s.from, scale, 0)
  const folded = s.phase === 'enter' || s.phase === 'closing' || s.phase === 'settling'
  const hand = heldOffset(s.point)
  // An ink in its place, leaning in and growing as the hand heads for it.
  const placed = (index) => {
    const home = slotOffset(index, count, radius)
    const lean = LIVE.has(s.phase) ? leanFor(index, count, s.point) : 0
    const pull = 1 - (LEAN_MAX * lean) / radius
    return at({ x: home.x * pull, y: home.y * pull }, 1 + LEAN_GROW * lean)
  }
  const slots = Array.from({ length: count }, (_, index) => {
    if (index === s.picked && s.phase === 'settling') return at({ x: 0, y: 0 }, grow)
    if (folded) return hidden(0.4)
    if (index === s.swapped) return at(hand, grow)
    return placed(index)
  })
  let held
  if (folded) held = hidden(0.6)
  else if (s.swapped !== null) held = placed(s.swapped)
  else held = at(hand, grow)
  return { slots, held }
}

/**
 * Animate a dot from where it was drawn to where it now is, in a straight line: the jump
 * is made at once and an offset (the `translate` property, which sits on top of the
 * painted transform) eases back to nothing, so the dot lands on its new place wherever
 * the hand has taken it meanwhile. Its face starts at its old size and stretches along
 * the way it travels.
 */
function trade(element, from, to) {
  const face = element.firstElementChild
  const style = getComputedStyle(element)
  const [nowX = 0, nowY = 0] = style.translate && style.translate !== 'none' ? style.translate.split(' ').map(parseFloat) : []
  ;[element, face].forEach((node) => node?.getAnimations?.().forEach((animation) => { if (animation.id === 'ink-trade') animation.cancel() }))
  const start = { x: from.x + nowX - to.x, y: from.y + nowY - to.y }
  const timing = { ...springTiming(SPRINGS.smooth), id: 'ink-trade' }
  element.animate?.([{ translate: `${start.x}px ${start.y}px` }, { translate: '0px 0px' }], timing)
  // The face, not the placed element, takes the size change and the stretch: a scale on
  // the element would scale its painted offset too and throw it off its path.
  const axis = `${(Math.atan2(-start.y, -start.x) * 180) / Math.PI}deg`
  const size = from.scale / to.scale
  const shape = (long, short) => `rotate(${axis}) scale(${long}, ${short}) rotate(calc(${axis} * -1))`
  const middle = (size + 1) / 2
  face?.animate?.([
    { transform: shape(size, size) },
    { transform: shape(middle * STRETCH.long, middle * STRETCH.short), offset: 0.4 },
    { transform: shape(1, 1) },
  ], timing)
}

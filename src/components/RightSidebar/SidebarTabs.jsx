/**
 * SidebarTabs.jsx — the sidebars' tab strip (the inspector's panels, the left sidebar's
 * Files and Book). The active-tab indicator tracks fractional swipe progress so it
 * slides with the gesture, and can itself be grabbed and dragged to another tab: the
 * panels follow it (`onIndicatorDrag`) and letting go chooses the tab it is over
 * (`onIndicatorDrop`). While it is held or swiped it lifts and grows, as macOS's
 * segmented controls do, and settles back as it lands. Whenever it travels (a click
 * that sends it to another tab, a quick drag or swipe) it squashes vertically and
 * stretches along its path, as Liquid Glass's selector does: full size where it sets
 * off, flattest halfway, and back to full size as it reaches the tab it is bound for.
 *
 * Where it is comes from the panels' progress (useSpaceSwipe), and it goes there on
 * the panels' own transition (`snap`): a click's quick spring, or a swipe's spring
 * with the fingers' speed kept, so the pill and the panels land as one.
 *
 * It is placed from the buttons' measured boxes, rounded to whole device pixels,
 * rather than from a percentage of the strip: a fractional position is drawn one way
 * while the snap animates (on its own layer) and another once it stops, so the pill
 * would nudge sideways after it had landed, more the further along the tab.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Icon from '../../ui/Icon.jsx'
import { RIGHT_SIDEBAR_TABS } from './sidebarTabsConfig'

const TAB_GAP_PX = 4
// The strip's side padding, both sides: a kerf each in the sidebars (FileTree.css).
const TAB_BAR_PADDING_PX = 6
/** The furthest the indicator runs past the first or last tab: over the strip's and
 *  the panel's padding, never out past the panel's edge. */
const INDICATOR_OVERSHOOT_PX = 8
/** Travel before a press on the indicator becomes a drag. */
const INDICATOR_DRAG_SLOP_PX = 3
/** The squash, px off the indicator's top and bottom, follows an arch along its
 *  path: none at either end, the most halfway. How deep the arch goes: for a snap
 *  (a click, or landing after a drag), SNAP_SQUASH_PX for a tab or more, less for a
 *  shorter hop; dragged or swiped (when it is lifted and has height to spare), so
 *  many px per px/ms of travel, never more than SQUASH_MAX_PX. It stretches along
 *  its path by STRETCH of the squash. */
const INDICATOR_SNAP_SQUASH_PX = 3
const INDICATOR_SQUASH_PER_SPEED = 6
const INDICATOR_SQUASH_MAX_PX = 7
const INDICATOR_STRETCH = 0.6
/** How much of the gap to the drag's depth is closed each frame: quick to deepen,
 *  slower to ease off. */
const INDICATOR_SQUASH_ATTACK = 0.5
const INDICATOR_SQUASH_RELEASE = 0.18
/** How much of the gap to the squash drawn is closed each frame, so moving from a
 *  drag to its snap doesn't jump. */
const INDICATOR_SQUASH_FOLLOW = 0.5
/** Frames at rest before the speed watch stops. */
const INDICATOR_STILL_FRAMES = 6

/** Where the indicator is drawn right now, mid-transition included, in strip px. */
const readIndicatorX = (element) => {
  const { transform } = window.getComputedStyle(element)
  if (!transform || transform === 'none' || typeof DOMMatrixReadOnly === 'undefined') return 0
  return new DOMMatrixReadOnly(transform).m41
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

/** 0 at either end of a path, 1 halfway. */
const arch = (along) => Math.sin(Math.PI * clamp(along, 0, 1))

/** How far x is from one tab to the next, 0–1. */
const alongTabs = (x, slots) => {
  if (!slots || slots.length < 2) return 0
  for (let i = 0; i < slots.length - 1; i += 1) {
    const a = slots[i].left
    const b = slots[i + 1].left
    if (x <= b) return b === a ? 0 : (x - a) / (b - a)
  }
  return 1
}

const snapToDevicePixel = (value) => {
  const ratio = (typeof window !== 'undefined' && window.devicePixelRatio) || 1
  return Math.round(value * ratio) / ratio
}

/** Each button's left edge, width and height inside the strip, in its own (untransformed) px. */
const measureSlots = (strip) => {
  const box = strip.getBoundingClientRect()
  // The sidebars slide and scale in: undo any transform above the strip.
  const scale = box.width > 0 && strip.offsetWidth > 0 ? strip.offsetWidth / box.width : 1
  return [...strip.querySelectorAll(':scope > button')].map((button) => {
    const rect = button.getBoundingClientRect()
    return {
      left: (rect.left - box.left) * scale - strip.clientLeft,
      width: rect.width * scale,
      height: rect.height * scale,
    }
  })
}

export default function SidebarTabs({
  // Which tabs exist depends on the open document (a canvas has no History), and
  // the indicator's width and travel are computed from that count — so the strip
  // and the panel track must be handed the same list.
  tabs = RIGHT_SIDEBAR_TABS,
  tab,
  setTab,
  visualProgress = 0,
  gestureActive = false,
  following = false,
  snap = 'var(--spring-quick-dur) var(--spring-quick)',
  reducedMotion = false,
  onIndicatorDrag,
  onIndicatorDrop,
}) {
  const committedActiveIndex = Math.max(0, tabs.findIndex(({ id }) => id === tab))
  const stripRef = useRef(null)
  const dragRef = useRef(null)
  const indicatorRef = useRef(null)
  const motionRef = useRef({
    frame: 0, lastX: null, lastT: 0, depth: 0, squash: 0, still: 0,
    dragging: false, lifted: false, slots: null, from: 0, to: null,
  })
  const [grabbing, setGrabbing] = useState(false)
  const [pressed, setPressed] = useState(false)
  const [slots, setSlots] = useState(null)

  useLayoutEffect(() => {
    const strip = stripRef.current
    if (!strip) return undefined
    const update = () => {
      const next = measureSlots(strip)
      setSlots((previous) => (
        previous && previous.length === next.length
          && previous.every((slot, i) => slot.left === next[i].left
            && slot.width === next[i].width && slot.height === next[i].height)
          ? previous
          : next
      ))
    }
    update()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(update)
    observer.observe(strip)
    return () => observer.disconnect()
  }, [tabs.length])

  const visualActiveIndex = gestureActive
    ? clamp(Math.round(visualProgress), 0, tabs.length - 1)
    : committedActiveIndex
  // Between the tabs it moves from one button to the next; past either end the
  // panels' rubber band is drawn as a few pixels of give.
  const restingProgress = clamp(visualProgress, 0, tabs.length - 1)
  const overshoot = visualProgress - restingProgress
  const measured = slots && slots.length === tabs.length
  let indicatorPlacement
  let targetX = null
  if (measured) {
    const from = slots[Math.floor(restingProgress)]
    const to = slots[Math.ceil(restingProgress)]
    const along = restingProgress - Math.floor(restingProgress)
    const tabWidth = from.width + (to.width - from.width) * along
    // Never narrower than it is tall: with many tabs it rounds to a circle centred
    // on its tab, spilling into the gaps, rather than standing as a tall rectangle.
    const width = Math.max(tabWidth, from.height)
    const give = clamp(overshoot * width, -INDICATOR_OVERSHOOT_PX, INDICATOR_OVERSHOOT_PX)
    const x = from.left + (to.left - from.left) * along + (tabWidth - width) / 2 + give
    targetX = snapToDevicePixel(x)
    indicatorPlacement = {
      left: 0,
      width: `${snapToDevicePixel(width)}px`,
      transform: `translateX(${snapToDevicePixel(x)}px)`,
      // For the lifted pill's spread (FileTree.css), which keeps it at least round.
      '--sidebar-tabs-indicator-width': `${snapToDevicePixel(width)}px`,
      '--sidebar-tabs-indicator-height': `${from.height}px`,
    }
  } else {
    // Before the first measure: the same place, worked out from the strip's padding.
    indicatorPlacement = {
      width: `calc((100% - ${((tabs.length - 1) * TAB_GAP_PX) + TAB_BAR_PADDING_PX}px) / ${tabs.length})`,
      transform: `translateX(calc(${restingProgress * 100}% + ${restingProgress * TAB_GAP_PX}px`
        + ` + clamp(-${INDICATOR_OVERSHOOT_PX}px, ${overshoot * 100}%, ${INDICATOR_OVERSHOOT_PX}px)))`,
    }
  }
  // Grabbed or swiped, the pill lifts at once.
  const lifted = !reducedMotion && (pressed || gestureActive)

  // Watch where the indicator is drawn on its path — whether the snap's transition
  // or the fingers carry it — and squash it to match, frame by frame, until it
  // settles. A snap's path runs from where it was to the tab it is bound for; a
  // drag's, from one tab to the next, as deep as the drag is quick. Written
  // straight to its style: it changes every frame and React needn't know.
  const placementKey = `${indicatorPlacement.transform}|${indicatorPlacement.width}`
  const dragging = gestureActive || grabbing || following
  useEffect(() => {
    const element = indicatorRef.current
    const motion = motionRef.current
    if (!element || reducedMotion || typeof requestAnimationFrame === 'undefined') return
    motion.dragging = dragging
    motion.lifted = lifted
    motion.slots = measured ? slots : null
    if (dragging || targetX === null) {
      motion.to = null
    } else if (targetX !== motion.to) {
      motion.from = readIndicatorX(element)
      motion.to = targetX
    }
    if (motion.frame) {
      motion.still = 0
      return
    }
    const apply = () => {
      const squash = motion.squash < 0.05 ? 0 : motion.squash
      element.style.setProperty('--sidebar-tabs-squash', `${squash.toFixed(2)}px`)
      element.style.setProperty('--sidebar-tabs-stretch', `${(squash * INDICATOR_STRETCH).toFixed(2)}px`)
    }
    const tick = (now) => {
      const x = readIndicatorX(element)
      const speed = motion.lastX === null ? 0 : Math.abs(x - motion.lastX) / Math.max(now - motion.lastT, 1)
      motion.lastX = x
      motion.lastT = now
      let target = 0
      if (motion.dragging) {
        const most = motion.lifted ? INDICATOR_SQUASH_MAX_PX : INDICATOR_SNAP_SQUASH_PX
        const depth = Math.min(most, speed * INDICATOR_SQUASH_PER_SPEED)
        const rate = depth > motion.depth ? INDICATOR_SQUASH_ATTACK : INDICATOR_SQUASH_RELEASE
        motion.depth += (depth - motion.depth) * rate
        target = motion.depth * arch(alongTabs(x, motion.slots))
      } else if (motion.to !== null) {
        motion.depth = 0
        const span = motion.to - motion.from
        if (Math.abs(span) >= 0.5) {
          const tabWidth = motion.slots?.[0]?.width || Math.abs(span)
          const depth = INDICATOR_SNAP_SQUASH_PX * Math.min(1, Math.abs(span) / tabWidth)
          target = depth * arch((x - motion.from) / span)
        }
      }
      motion.squash += (target - motion.squash) * INDICATOR_SQUASH_FOLLOW
      apply()
      motion.still = speed < 0.005 && motion.squash < 0.05 ? motion.still + 1 : 0
      if (motion.still >= INDICATOR_STILL_FRAMES) {
        motion.squash = 0
        motion.still = 0
        motion.frame = 0
        apply()
        return
      }
      motion.frame = requestAnimationFrame(tick)
    }
    motion.still = 0
    motion.frame = requestAnimationFrame(tick)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- targetX is in placementKey
  }, [placementKey, reducedMotion, dragging, lifted, measured, slots])
  useEffect(() => () => {
    const motion = motionRef.current
    if (motion.frame) cancelAnimationFrame(motion.frame)
    motion.frame = 0
  }, [])

  // The indicator moves one tab per (its width + the gap) of pointer travel.
  const onIndicatorPointerDown = (event) => {
    if (event.button !== 0 || tabs.length < 2) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setPressed(true)
    dragRef.current = {
      startX: event.clientX,
      origin: committedActiveIndex,
      step: event.currentTarget.getBoundingClientRect().width + TAB_GAP_PX,
      moved: false,
      position: committedActiveIndex,
    }
  }
  const onIndicatorPointerMove = (event) => {
    const drag = dragRef.current
    if (!drag) return
    const dx = event.clientX - drag.startX
    if (!drag.moved && Math.abs(dx) < INDICATOR_DRAG_SLOP_PX) return
    if (!drag.moved) setGrabbing(true)
    drag.moved = true
    drag.position = drag.origin + dx / Math.max(drag.step, 1)
    onIndicatorDrag?.(drag.position)
  }
  const onIndicatorPointerUp = () => {
    const drag = dragRef.current
    dragRef.current = null
    setGrabbing(false)
    setPressed(false)
    if (!drag?.moved) return
    const target = clamp(Math.round(drag.position), 0, tabs.length - 1)
    if (onIndicatorDrop) onIndicatorDrop(target)
    else if (tabs[target].id !== tab) setTab(tabs[target].id)
  }

  return (
    <div
      ref={stripRef}
      className={`sidebar-tabs${gestureActive ? ' is-gesture-active' : ''}${grabbing ? ' is-grabbing' : ''}`}
      style={{ '--sidebar-tab-count': tabs.length }}
    >
      <span
        ref={indicatorRef}
        className={`sidebar-tabs-indicator${lifted ? ' is-lifted' : ''}`}
        aria-hidden="true"
        onPointerDown={onIndicatorPointerDown}
        onPointerMove={onIndicatorPointerMove}
        onPointerUp={onIndicatorPointerUp}
        onPointerCancel={onIndicatorPointerUp}
        style={{
          ...indicatorPlacement,
          transition: dragging || reducedMotion
            ? 'none'
            : `transform ${snap}`,
          // The pill's grow (its insets, in the stylesheet) springs on its own, even
          // while the position follows the fingers.
          '--sidebar-tabs-grow-duration': reducedMotion ? '0ms' : 'var(--spring-smooth-dur)',
          '--sidebar-tabs-grow-easing': 'var(--spring-smooth)',
        }}
      >
        <span className="sidebar-tabs-indicator-pill" />
      </span>

      {tabs.map(({ id, icon, label }, index) => {
        const active = index === visualActiveIndex
        const selected = tab === id
        return (
          <button
            key={id}
            className={active ? 'active' : ''}
            onClick={() => setTab(id)}
            aria-label={label}
            title={label}
            aria-pressed={selected}
          >
            <Icon name={icon} active={active} />
          </button>
        )
      })}
    </div>
  )
}

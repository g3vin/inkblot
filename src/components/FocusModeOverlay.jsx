/**
 * FocusModeOverlay.jsx — distraction-free "focus mode".
 *
 * Covers the card with the active editor's text, one sentence at a time (with optional
 * sentences around it, or the paragraph view). All edits still happen in the TipTap
 * editor underneath, which keeps the keyboard focus; this overlay only draws a view of
 * it and moves its selection.
 *
 * The text column is positioned by script: at rest the sentence the caret is in sits
 * centred; a wheel or trackpad moves the column under the fingers and, once it stops,
 * the sentence nearest the centre becomes the one written in. Every move between
 * sentences is measured before and after, then played between: the sentences changing
 * size grow and shrink in place while the column carries the new one to the centre.
 * Entering and leaving zoom the sentence between its place on the page and the centre
 * of the card.
 */
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { isEditorReady } from '../lib/editorUtils'
import { useCommands } from '../lib/commands'
import { SPRINGS, prefersReducedMotion, rubberClamp, settleTime, spring, springAt } from '../ui/physics.js'
import { springTiming } from '../ui/useSpring.js'
import {
  buildFocusTextMap,
  describePosition,
  getFocusSelection,
  getSentenceSpans,
  getSentenceWindow,
  locateCaret,
} from '../lib/focusText'
import FocusModeBar from './FocusModeBar'
import { loadFocusModeSettings, normalizeFocusModeSetting, saveFocusModeSettings } from './focusModeSettings'

/** Where focus mode's own chrome is: its keys and wheel are the chrome's, not the text's. */
const FOCUS_MODE_CHROME = '.focus-mode-bar-zone, .focus-mode-popover'
/** Sentences drawn beyond the before/after setting: hidden at rest, seen while scrolling. */
const SCROLL_BUFFER = 4
/** The paragraph view draws this many sentences each side of the current one. */
const PARAGRAPH_WINDOW = 60
/** How long the wheel must be still before the text settles on a sentence. */
const SETTLE_MS = 140
/** Past the first or last sentence a scroll gives as a rubber band (physics.js), never
 *  more than this far. */
const OVERSCROLL_LIMIT = 120
/**
 * A trackpad's momentum after the fingers lift arrives as deltas that shrink one after
 * another; deltas from the fingers rise and fall. This many shrinking in a row reads as
 * the glide, and one this many times bigger than the last as the fingers back down.
 */
const GLIDE_RUN = 5
const GLIDE_RESUME = 1.5
/** The caret stays solid this long after an edit, as a native caret does. */
const TYPING_MS = 520
const FADE_MS = 150
const slotPluginKey = new PluginKey('focusModeSlot')
/** What a fade touches: every drawn line but the buffer, which stays hidden at rest. */
const SHOWN_LINES = '[data-index]:not(.is-outside), .focus-mode-slot, .focus-mode-prefix'

const clampNumber = (value, min, max) => Math.min(max, Math.max(min, value))

/** Convert wheel deltas to pixels regardless of the event's delta mode. */
const normalizeWheelDeltaY = (event) => {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * 16
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * window.innerHeight
  return event.deltaY
}

/** Moving between sentences, solved frame by frame because the size changes too. */
const FLIP_SPRING = spring(SPRINGS.smooth)
const FLIP_SETTLE = settleTime(FLIP_SPRING)

/** Cancel the script animations on an element and, optionally, everything inside it. */
const cancelAnimations = (element, subtree = false) => {
  element?.getAnimations?.({ subtree }).forEach((animation) => animation.cancel())
}

/** Character offset of (targetNode, targetOffset) within `element`'s flattened text content. */
const getTextOffsetInElement = (element, targetNode, targetOffset) => {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  let offset = 0
  while (walker.nextNode()) {
    const node = walker.currentNode
    const textLength = node.nodeValue?.length || 0
    if (node === targetNode) return offset + clampNumber(targetOffset, 0, textLength)
    offset += textLength
  }
  return null
}

/** Best-effort caret offset for a click inside a rendered sentence (falls back to start/end by half). */
const getOffsetFromClick = (event, length) => {
  const element = event.currentTarget
  const caretPosition = document.caretPositionFromPoint?.(event.clientX, event.clientY)
  if (caretPosition?.offsetNode && element.contains(caretPosition.offsetNode)) {
    const offset = getTextOffsetInElement(element, caretPosition.offsetNode, caretPosition.offset)
    if (offset !== null) return clampNumber(offset, 0, length)
  }
  const caretRange = document.caretRangeFromPoint?.(event.clientX, event.clientY)
  if (caretRange?.startContainer && element.contains(caretRange.startContainer)) {
    const offset = getTextOffsetInElement(element, caretRange.startContainer, caretRange.startOffset)
    if (offset !== null) return clampNumber(offset, 0, length)
  }
  const rect = element.getBoundingClientRect()
  return event.clientX < rect.left + rect.width / 2 ? 0 : length
}

/** The nearest ancestor that scrolls vertically. */
const scrollParentOf = (element) => {
  for (let node = element?.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node)
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) return node
  }
  return null
}

/**
 * Where a stretch of the document is drawn in the editor: the top-left of its first
 * line and the font size there, or null when it can't be found.
 */
const editorTextRect = (editor, from, to) => {
  try {
    const { view } = editor
    if (to <= from) {
      const coords = view.coordsAtPos(from)
      const host = view.domAtPos(from).node
      const element = host.nodeType === Node.TEXT_NODE ? host.parentElement : host
      return { left: coords.left, top: coords.top, fontSize: parseFloat(getComputedStyle(element).fontSize) }
    }
    const start = view.domAtPos(from)
    const end = view.domAtPos(to)
    const range = document.createRange()
    range.setStart(start.node, start.offset)
    range.setEnd(end.node, end.offset)
    const rect = [...range.getClientRects()].find((box) => box.width > 0) ?? range.getBoundingClientRect()
    const host = start.node.nodeType === Node.TEXT_NODE ? start.node.parentElement : start.node
    return { left: rect.left, top: rect.top, fontSize: parseFloat(getComputedStyle(host).fontSize) }
  } catch {
    return null
  }
}

/** The view of the editor focus mode draws: its text, sentences, selection and caret. */
const readEditor = (editor, previous) => {
  if (!isEditorReady(editor)) return null
  const { doc, selection } = editor.state
  const reuse = previous && previous.doc === doc
  const map = reuse ? previous.map : buildFocusTextMap(doc)
  const spans = reuse ? previous.spans : getSentenceSpans(map.text)
  const focusSelection = getFocusSelection(map, selection)
  const located = locateCaret(spans, map.text, focusSelection.from)
  const caret = { ...located, offset: focusSelection.from, fresh: located.slot === 'next' ? 'sentence' : null }
  // An empty paragraph has no text of its own, so the caret in one resolves to the end
  // of the sentence before it; it is a new paragraph waiting to be written.
  const { $from } = selection
  if (selection.empty && $from.parent.isTextblock && $from.parent.content.size === 0 && spans.length) {
    const beforeAll = selection.from < map.positions[spans[0].start]
    caret.index = beforeAll ? -1 : located.index
    caret.slot = 'next'
    caret.fresh = 'paragraph'
  }
  return { doc, map, spans, selection: focusSelection, caret }
}

export default function FocusModeOverlay({ editor, onExit, leaving = false, onExited, sidebars }) {
  const [settings, setSettings] = useState(loadFocusModeSettings)
  const [model, setModel] = useState(() => readEditor(editor, null))
  // The writer pressed ↓ on the last sentence: an empty line waits after it.
  const [endSlot, setEndSlot] = useState(false)
  // While scrolling: the sentence nearest the centre (it lights up; the caret waits).
  const [centred, setCentred] = useState(null)
  const [scrolling, setScrolling] = useState(false)
  // The fingers have lifted and the text glides on: the sentences beyond the
  // before/after setting fade, and the glide lands on one sentence alone.
  const [gliding, setGliding] = useState(false)
  const [typing, setTyping] = useState(false)
  const [phase, setPhase] = useState('entering')
  const [announcement, setAnnouncement] = useState('')

  const overlayRef = useRef(null)
  // The stage carries the zooms and FLIPs of the whole column; the column inside it
  // carries only the offset that centres the sentence. Apart, an animation never
  // fights the centring, which can change while one plays (the card resizing).
  const stageRef = useRef(null)
  const columnRef = useRef(null)
  const backdropRef = useRef(null)
  const modelRef = useRef(model)
  const endSlotRef = useRef(false)
  const restRef = useRef({ index: 0, slot: null })
  const centredRef = useRef(null)
  const scrollingRef = useRef(false)
  const phaseRef = useRef('entering')
  const yRef = useRef(0)
  // Where the fingers have taken the column, before the rubber band past either end.
  const pulledRef = useRef(null)
  const flipRef = useRef(null)
  const anchorRef = useRef(null)
  const pendingDeltaRef = useRef(0)
  const wheelRunRef = useRef({ last: 0, shrinking: 0, gliding: false })
  const frameRef = useRef(0)
  const settleTimerRef = useRef(0)
  const typingTimerRef = useRef(0)
  const onExitedRef = useRef(onExited)
  useEffect(() => { onExitedRef.current = onExited })

  const spans = model?.spans ?? []
  const text = model?.map.text ?? ''
  const caret = model?.caret ?? { index: -1, slot: 'next', offset: 0, fresh: 'sentence' }
  const atEnd = endSlot && spans.length > 0 && caret.offset === text.length
  // The sentence written in: its own size, and the caret, unless the caret waits on an
  // empty line after it (`slot: 'next'`).
  const rest = atEnd
    ? { index: spans.length - 1, slot: 'next', fresh: 'sentence' }
    : { index: caret.index, slot: caret.slot, fresh: caret.fresh }
  const windowIndex = centred ?? Math.max(0, rest.index)
  const paragraph = settings.paragraphContext
  const before = paragraph ? PARAGRAPH_WINDOW : settings.before
  const after = paragraph ? PARAGRAPH_WINDOW : settings.after
  const sentences = getSentenceWindow(spans, text, windowIndex, before, after, paragraph ? 0 : SCROLL_BUFFER)

  // The handlers read what this render drew. First of the layout effects, so the ones
  // below that place and animate the column see it too.
  useLayoutEffect(() => {
    restRef.current = rest
    modelRef.current = model
    endSlotRef.current = atEnd
  })

  // Update one setting, clamping to its allowed range, and persist the result.
  const updateSetting = useCallback((key, value) => {
    setSettings((current) => {
      const next = { ...current, [key]: normalizeFocusModeSetting(key, value) }
      saveFocusModeSettings(next)
      return next
    })
  }, [])

  useCommands(() => [{
    id: 'view.focus-mode-position',
    section: 'View',
    title: settings.showPosition ? 'Hide position in focus mode' : 'Show position in focus mode',
    icon: 'number',
    keywords: ['paragraph number', 'sentence number', 'where am i', 'counter'],
    run: () => updateSetting('showPosition', !settings.showPosition),
  }], [settings.showPosition, updateSetting])

  // Follow the editor: every transaction refreshes the view. Text is re-read only when
  // the document changed.
  useEffect(() => {
    if (!isEditorReady(editor)) return undefined
    const handler = () => {
      const next = readEditor(editor, modelRef.current)
      if (!next) return
      const docChanged = next.doc !== modelRef.current?.doc
      if (endSlotRef.current && (docChanged || next.caret.offset !== next.map.text.length)) setEndSlot(false)
      if (docChanged) {
        setTyping(true)
        window.clearTimeout(typingTimerRef.current)
        typingTimerRef.current = window.setTimeout(() => setTyping(false), TYPING_MS)
      }
      modelRef.current = next
      setModel(next)
    }
    handler()
    editor.on('transaction', handler)
    // Focus without scrolling: the page underneath stays where the writer left it.
    editor.view.focus()
    return () => {
      window.clearTimeout(typingTimerRef.current)
      if (!editor.isDestroyed) editor.off('transaction', handler)
    }
  }, [editor])

  // In the empty line after the last sentence, the first word typed is spaced from it.
  useEffect(() => {
    if (!isEditorReady(editor)) return undefined
    const plugin = new Plugin({
      key: slotPluginKey,
      props: {
        handleTextInput: (view, from, to, input) => {
          if (!endSlotRef.current || from !== to || /^\s/.test(input)) return false
          const previous = view.state.doc.textBetween(Math.max(0, from - 1), from, '\n', '\n')
          if (!previous || /\s/.test(previous)) return false
          view.dispatch(view.state.tr.insertText(` ${input}`, from, to))
          return true
        },
      },
    })
    editor.registerPlugin(plugin)
    return () => {
      if (!editor.isDestroyed) editor.unregisterPlugin(slotPluginKey)
    }
  }, [editor])

  const elementFor = useCallback((index) => (
    columnRef.current?.querySelector(`[data-index="${index}"]`) ?? null
  ), [])

  // The element the column centres: the empty line when the caret waits there, else
  // the sentence (the one nearest the centre while scrolling).
  const targetElement = useCallback(() => {
    const column = columnRef.current
    if (!column) return null
    if (centredRef.current !== null) return elementFor(centredRef.current)
    if (restRef.current.slot === 'next') return column.querySelector('.focus-mode-slot')
    return elementFor(restRef.current.index) ?? column.querySelector('.focus-mode-slot')
  }, [elementFor])

  /** The column offset that centres `element`, from layout alone (transforms don't move it). */
  const centreFor = useCallback((element) => {
    const overlay = overlayRef.current
    if (!overlay || !element) return yRef.current
    return overlay.clientHeight / 2 - (element.offsetTop + element.offsetHeight / 2)
  }, [])

  const applyY = useCallback((y, glide) => {
    yRef.current = y
    const column = columnRef.current
    if (!column) return
    column.dataset.glide = glide ? 'true' : 'false'
    column.style.transform = `translateY(${y}px)`
  }, [])

  /** Where every drawn sentence is on screen, for a FLIP after the next render. */
  const snapshot = useCallback(() => {
    const column = columnRef.current
    if (!column) return null
    const rects = new Map()
    column.querySelectorAll('[data-index], .focus-mode-slot').forEach((element) => {
      const key = element.dataset.index ?? 'slot'
      rects.set(key, { rect: element.getBoundingClientRect(), fontSize: parseFloat(getComputedStyle(element).fontSize) })
    })
    return rects
  }, [])

  // The paragraph view's move between sentences, while it plays (see playFlip).
  const tweenRef = useRef(null)
  const stopTween = useCallback(() => {
    const tween = tweenRef.current
    if (!tween) return
    tweenRef.current = null
    cancelAnimationFrame(tween.frame)
    tween.resized.forEach(({ element }) => { element.style.fontSize = '' })
  }, [])
  useEffect(() => stopTween, [stopTween])

  /**
   * Animate from what `snap` saw to now. The sentences whose size changed grow and
   * shrink in place, the text rewrapping round them as it would (a transform would
   * rewrap at the new size first and then scale, and an inline sentence in the
   * paragraph view can't be transformed at all), and every frame the column is placed
   * to carry the sentence from where it was to the centre.
   */
  const playFlip = useCallback((snap) => {
    stopTween()
    const overlay = overlayRef.current
    const column = columnRef.current
    if (!overlay || !column || !snap || prefersReducedMotion()) return
    const target = targetElement()
    const was = target && snap.get(target.dataset.index ?? 'slot')
    if (!target || !was) return
    const resized = []
    column.querySelectorAll('[data-index]').forEach((element) => {
      const before = snap.get(element.dataset.index)
      const to = parseFloat(getComputedStyle(element).fontSize)
      if (before && Math.abs(before.fontSize - to) > 0.1) resized.push({ element, from: before.fontSize, to })
    })
    const box = overlay.getBoundingClientRect()
    const offset = was.rect.top + was.rect.height / 2 - (box.top + overlay.clientHeight / 2)
    if (!resized.length && Math.abs(offset) < 0.5) return
    const started = performance.now()
    const tween = { resized, frame: 0 }
    const step = (now) => {
      if (tweenRef.current !== tween) return
      const elapsed = Math.max(0, now - started)
      // A spring, solved here rather than in CSS: the size has to be set frame by frame.
      const eased = elapsed >= FLIP_SETTLE ? 1 : springAt(FLIP_SPRING, 0, 1, 0, elapsed).value
      resized.forEach(({ element, from, to }) => { element.style.fontSize = `${from + (to - from) * eased}px` })
      applyY(centreFor(target) + offset * (1 - eased), false)
      if (eased < 1) {
        tween.frame = requestAnimationFrame(step)
        return
      }
      stopTween()
      applyY(centreFor(target), false)
    }
    tweenRef.current = tween
    step(started)
  }, [applyY, centreFor, stopTween, targetElement])

  // Keep the column placed after every render: centred at rest (gliding for small
  // shifts such as a line wrapping as the writer types, or FLIPping after a move
  // between sentences), and held still under the fingers while scrolling.
  useLayoutEffect(() => {
    if (phaseRef.current === 'leaving' || (tweenRef.current && !flipRef.current)) return
    if (scrollingRef.current) {
      const anchor = anchorRef.current
      const element = anchor ? elementFor(anchor.index) : null
      if (element && element.offsetTop !== anchor.offsetTop) {
        applyY(yRef.current + anchor.offsetTop - element.offsetTop, false)
        anchor.offsetTop = element.offsetTop
      }
      return
    }
    const y = centreFor(targetElement())
    if (flipRef.current) {
      const snap = flipRef.current
      flipRef.current = null
      applyY(y, false)
      playFlip(snap)
      return
    }
    if (Math.abs(y - yRef.current) >= 0.5) applyY(y, phaseRef.current === 'open')
  })

  // Recentre when the card changes size (a sidebar docked or hovering, the window
  // resized) or the typeface arrives.
  useEffect(() => {
    const overlay = overlayRef.current
    if (!overlay) return undefined
    const recentre = () => {
      if (scrollingRef.current || tweenRef.current || phaseRef.current === 'leaving') return
      applyY(centreFor(targetElement()), false)
    }
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(recentre) : null
    observer?.observe(overlay)
    let live = true
    document.fonts?.ready.then(() => { if (live) recentre() })
    return () => {
      live = false
      observer?.disconnect()
    }
  }, [applyY, centreFor, targetElement])

  // Move the real editor caret to a focus-text offset (via the text→doc position map).
  const placeCaret = useCallback((textOffset) => {
    const current = modelRef.current
    if (!isEditorReady(editor) || !current) return
    const { positions } = current.map
    const docPosition = positions[clampNumber(textOffset, 0, positions.length - 1)]
    if (!Number.isFinite(docPosition)) return
    try {
      const position = clampNumber(docPosition, 1, editor.state.doc.content.size)
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, position)))
    } catch (error) {
      console.warn('Failed to place focus mode cursor:', error)
    }
    if (!editor.view.hasFocus()) editor.view.focus()
  }, [editor])

  const announce = useCallback((span) => setAnnouncement(span?.text ?? ''), [])

  // ↑/↓: to the start of the sentence before or after; ↓ from the last sentence opens
  // an empty line after it, ready for the next one.
  const moveBySentence = useCallback((direction) => {
    const current = modelRef.current
    if (!current?.spans.length) return
    const { spans: all, map } = current
    const from = restRef.current
    flipRef.current = snapshot()
    if (direction < 0) {
      const target = Math.max(0, from.slot === 'next' ? from.index : from.index - 1)
      placeCaret(all[target].start)
      announce(all[target])
      return
    }
    const target = from.index + 1
    if (target >= all.length) {
      // Already on a fresh line after the last sentence.
      if (from.slot === 'next') {
        flipRef.current = null
        return
      }
      placeCaret(map.text.length)
      endSlotRef.current = true
      setEndSlot(true)
      setAnnouncement('New sentence')
      return
    }
    placeCaret(all[target].start)
    announce(all[target])
  }, [announce, placeCaret, snapshot])

  // The wheel stopped: settle on the sentence nearest the centre. The caret stays put
  // if that is the sentence it is already in.
  const settle = useCallback(() => {
    if (!scrollingRef.current) return
    const index = centredRef.current
    scrollingRef.current = false
    centredRef.current = null
    anchorRef.current = null
    flipRef.current = snapshot()
    wheelRunRef.current = { last: 0, shrinking: 0, gliding: false }
    setScrolling(false)
    setGliding(false)
    setCentred(null)
    const current = modelRef.current
    const from = restRef.current
    if (index === null || !current?.spans[index]) return
    if (index === from.index && from.slot !== 'next') return
    if (index === from.index && endSlotRef.current) return
    placeCaret(current.spans[index].start)
    announce(current.spans[index])
  }, [announce, placeCaret, snapshot])

  // One frame of scrolling: move the column by what the wheel gave since the last
  // frame, giving as a rubber band past either end, and light the sentence nearest
  // the centre.
  const applyScroll = useCallback(() => {
    frameRef.current = 0
    const column = columnRef.current
    const overlay = overlayRef.current
    const current = modelRef.current
    if (!column || !overlay || !current) return
    let delta = -pendingDeltaRef.current
    pendingDeltaRef.current = 0

    const first = elementFor(0)
    const lastIndex = current.spans.length - 1
    const last = (endSlotRef.current && column.querySelector('.focus-mode-slot')) || elementFor(lastIndex)
    const maxY = first ? centreFor(first) : Infinity
    const minY = last ? centreFor(last) : -Infinity
    const pulled = (pulledRef.current ?? yRef.current) + delta
    pulledRef.current = pulled
    const y = rubberClamp(pulled, minY, maxY, OVERSCROLL_LIMIT)
    applyY(y, false)

    const middle = overlay.clientHeight / 2
    let nearest = null
    let nearestDistance = Infinity
    column.querySelectorAll('[data-index]').forEach((element) => {
      const distance = Math.abs(element.offsetTop + element.offsetHeight / 2 + y - middle)
      if (distance < nearestDistance) {
        nearestDistance = distance
        nearest = element
      }
    })
    if (!nearest) return
    const index = Number(nearest.dataset.index)
    if (index !== centredRef.current) {
      centredRef.current = index
      anchorRef.current = { index, offsetTop: nearest.offsetTop }
      setCentred(index)
    }
  }, [applyY, centreFor, elementFor])

  // The wheel and trackpad scroll the text continuously. A native listener, because
  // React's is passive and couldn't keep the page underneath from scrolling.
  useEffect(() => {
    const overlay = overlayRef.current
    if (!overlay) return undefined
    const onWheel = (event) => {
      if (event.target instanceof Element && event.target.closest(FOCUS_MODE_CHROME)) return
      event.preventDefault()
      if (phaseRef.current !== 'open') return
      const delta = normalizeWheelDeltaY(event)
      if (!Number.isFinite(delta) || delta === 0) return
      if (!scrollingRef.current) {
        scrollingRef.current = true
        pulledRef.current = null
        stopTween()
        cancelAnimations(stageRef.current, true)
        centredRef.current = restRef.current.slot === 'next' ? null : Math.max(0, restRef.current.index)
        setScrolling(true)
      }
      const run = wheelRunRef.current
      const size = Math.abs(delta)
      if (run.gliding && size > run.last * GLIDE_RESUME) {
        run.gliding = false
        run.shrinking = 0
        setGliding(false)
      } else if (!run.gliding) {
        run.shrinking = run.last && size < run.last ? run.shrinking + 1 : 0
        if (run.shrinking >= GLIDE_RUN) {
          run.gliding = true
          setGliding(true)
        }
      }
      run.last = size
      pendingDeltaRef.current += delta
      if (!frameRef.current) frameRef.current = requestAnimationFrame(applyScroll)
      window.clearTimeout(settleTimerRef.current)
      settleTimerRef.current = window.setTimeout(settle, SETTLE_MS)
    }
    overlay.addEventListener('wheel', onWheel, { passive: false })
    return () => overlay.removeEventListener('wheel', onWheel)
  }, [applyScroll, settle, stopTween])

  useEffect(() => () => {
    window.clearTimeout(settleTimerRef.current)
    cancelAnimationFrame(frameRef.current)
  }, [])

  // Escape leaves; ↑/↓ step between sentences. Only while the writer is in the text (or
  // the bar, for Escape): a palette, menu or dialog over focus mode keeps its own keys.
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.defaultPrevented || event.isComposing) return
      const target = event.target instanceof Element ? event.target : null
      const inText = !target || target === document.body || overlayRef.current?.contains(target) ||
        (isEditorReady(editor) && editor.view.dom.contains(target))
      if (!inText || target?.closest('.focus-mode-popover')) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onExit?.()
        return
      }
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
      if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return
      if (target?.closest(FOCUS_MODE_CHROME)) return
      // Home and End keep to the sentence: the editor's own would go to the ends of a
      // line of the page hidden underneath.
      if (event.key === 'Home' || event.key === 'End') {
        const span = modelRef.current?.spans[restRef.current.index]
        if (!span || restRef.current.slot === 'next') return
        event.preventDefault()
        event.stopPropagation()
        placeCaret(event.key === 'Home' ? span.start : span.end)
        return
      }
      event.preventDefault()
      event.stopPropagation()
      if (scrollingRef.current) settle()
      moveBySentence(event.key === 'ArrowUp' ? -1 : 1)
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [editor, moveBySentence, onExit, placeCaret, settle])

  // The page's sentence (or the caret, on an empty line): where a zoom starts or ends.
  const pageSource = useCallback(() => {
    const current = modelRef.current
    if (!current || !isEditorReady(editor)) return null
    const { index, slot } = restRef.current
    const span = current.spans[index]
    const { positions } = current.map
    const from = span && slot !== 'next' ? positions[span.start] : editor.state.selection.from
    const to = span && slot !== 'next' ? positions[span.end - 1] + 1 : from
    return Number.isFinite(from) ? { from, to } : null
  }, [editor])

  // Entering: zoom the sentence from its place on the page to the centre of the card.
  // Scheduled before the first paint, so focus mode is never seen unanimated; run in the
  // frame, after the sidebars have gone and the page underneath has settled.
  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (phaseRef.current !== 'entering') return
      const overlay = overlayRef.current
      const stage = stageRef.current
      const column = columnRef.current
      const backdrop = backdropRef.current
      const finish = () => {
        if (phaseRef.current !== 'entering') return
        phaseRef.current = 'open'
        if (overlay) overlay.dataset.phase = 'open'
        setPhase('open')
      }
      if (!overlay || !stage || !column || !backdrop || typeof stage.animate !== 'function') {
        finish()
        return
      }
      applyY(centreFor(targetElement()), false)
      if (prefersReducedMotion()) {
        overlay.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS }).onfinish = finish
        return
      }
      // The sentence carried from the page to the card: the long carry.
      const { duration: zoomMs, easing } = springTiming(SPRINGS.gentle)
      const target = targetElement()
      const range = pageSource()
      const source = range ? editorTextRect(editor, range.from, range.to) : null
      const overlayRect = overlay.getBoundingClientRect()
      const sourceOnCard = source && source.top >= overlayRect.top - 4 && source.top <= overlayRect.bottom
      backdrop.animate([{ opacity: 0 }, { opacity: 1, offset: 0.5 }, { opacity: 1 }], { duration: zoomMs, easing })
      column.querySelectorAll(SHOWN_LINES).forEach((element) => {
        if (element === target) return
        element.animate([{ opacity: 0 }, { opacity: 0, offset: 0.5 }, { opacity: 1 }], { duration: zoomMs + 120, easing })
      })
      if (!target) {
        finish()
        return
      }
      const zoom = sourceOnCard ? zoomBetween(stage, target, source) : null
      if (zoom) stage.animate([zoom.away, zoom.home], { duration: zoomMs, easing })
      const appear = target.animate(
        zoom
          ? [{ opacity: 0 }, { opacity: 1, offset: 0.35 }, { opacity: 1 }]
          : [{ opacity: 0, transform: 'scale(0.96)', transformOrigin: '0 50%' }, { opacity: 1, transform: 'none', transformOrigin: '0 50%' }],
        { duration: zoomMs, easing },
      )
      appear.onfinish = finish
    })
    return () => cancelAnimationFrame(frame)
    // Once, as focus mode opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs only on mount; the refs carry the live values
  }, [])

  // Leaving: put the page's sentence where it will land, then zoom back onto it.
  useLayoutEffect(() => {
    const overlay = overlayRef.current
    const stage = stageRef.current
    const column = columnRef.current
    const backdrop = backdropRef.current
    if (!leaving) {
      if (phaseRef.current === 'leaving') {
        cancelAnimations(overlay, true)
        phaseRef.current = 'open'
        setPhase('open')
      }
      return undefined
    }
    const wasEntering = phaseRef.current === 'entering'
    phaseRef.current = 'leaving'
    setPhase('leaving')
    stopTween()
    window.clearTimeout(settleTimerRef.current)
    scrollingRef.current = false
    centredRef.current = null
    const done = () => onExitedRef.current?.()
    // Left before it had finished arriving: the zoom turns round where it is and goes
    // back the way it came, rather than jumping to the middle to start from there.
    const arriving = wasEntering && !prefersReducedMotion() && overlay?.getAnimations
      ? overlay.getAnimations({ subtree: true }).filter((animation) => animation.playState === 'running')
      : []
    if (arriving.length) {
      arriving.forEach((animation) => {
        animation.effect?.updateTiming?.({ fill: 'both' })
        animation.reverse()
      })
      let live = true
      Promise.all(arriving.map((animation) => animation.finished)).then(() => { if (live) done() }, () => {})
      return () => { live = false }
    }
    cancelAnimations(overlay, true)
    if (!overlay || !stage || !column || !backdrop || typeof stage.animate !== 'function' || !isEditorReady(editor)) {
      done()
      return undefined
    }
    if (prefersReducedMotion()) {
      const fade = overlay.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, fill: 'forwards' })
      fade.onfinish = done
      return () => { fade.onfinish = null }
    }

    const range = pageSource()
    const scroller = scrollParentOf(editor.view.dom)
    if (scroller && range) {
      try {
        const coords = editor.view.coordsAtPos(range.from)
        const box = scroller.getBoundingClientRect()
        scroller.scrollTop += coords.top - (box.top + box.height / 2)
      } catch {
        // The page stays where it was; the zoom still lands on the sentence.
      }
    }

    // Back the way it came, on the same spring.
    const { duration: zoomMs, easing } = springTiming(SPRINGS.gentle)
    const target = targetElement()
    const source = range ? editorTextRect(editor, range.from, range.to) : null
    const zoom = target && source ? zoomBetween(stage, target, source) : null
    column.querySelectorAll(SHOWN_LINES).forEach((element) => {
      if (element === target) return
      element.animate([{ opacity: 1 }, { opacity: 0, offset: 0.4 }, { opacity: 0 }], { duration: zoomMs, easing, fill: 'forwards' })
    })
    if (zoom) stage.animate([zoom.home, zoom.away], { duration: zoomMs, easing, fill: 'forwards' })
    target?.animate([{ opacity: 1 }, { opacity: 1, offset: 0.65 }, { opacity: 0 }], { duration: zoomMs, easing, fill: 'forwards' })
    const fade = backdrop.animate([{ opacity: 1 }, { opacity: 1, offset: 0.4 }, { opacity: 0 }], { duration: zoomMs, easing, fill: 'forwards' })
    fade.onfinish = done
    return () => { fade.onfinish = null }
  }, [editor, leaving, pageSource, stopTween, targetElement])

  const moveCaretToClick = (event, sentence, length) => {
    event.preventDefault()
    event.stopPropagation()
    if (phaseRef.current !== 'open') return
    if (sentence.index !== restRef.current.index || restRef.current.slot === 'next') flipRef.current = snapshot()
    placeCaret(sentence.start + getOffsetFromClick(event, length))
  }

  const focusEditor = () => {
    if (isEditorReady(editor) && !editor.view.hasFocus()) editor.view.focus()
  }

  // A sentence's words, with the caret or the selection drawn in it.
  const renderSentenceText = (sentence) => {
    const { selection } = model
    if (!selection.empty) {
      const from = clampNumber(selection.from - sentence.start, 0, sentence.text.length)
      const to = clampNumber(selection.to - sentence.start, 0, sentence.text.length)
      if (to <= from) return sentence.text
      return (
        <>
          {sentence.text.slice(0, from)}
          <mark className="focus-mode-selection">{sentence.text.slice(from, to)}</mark>
          {sentence.text.slice(to)}
        </>
      )
    }
    if (sentence.index !== rest.index || rest.slot === 'next') return sentence.text
    // In the spaces after its sentence the caret draws them, so a space typed shows.
    const shown = rest.slot === 'trailing' ? text.slice(sentence.start, caret.offset) : sentence.text
    const at = clampNumber(caret.offset - sentence.start, 0, shown.length)
    return (
      <>
        {shown.slice(0, at)}
        <span className="focus-mode-caret" aria-hidden="true" />
        {shown.slice(at)}
      </>
    )
  }

  const outside = (index) => !paragraph && (index < windowIndex - settings.before || index > windowIndex + settings.after)
  const slotLine = rest.slot === 'next' ? (
    <span className="focus-mode-sentence focus-mode-slot current" key="slot">
      {model?.selection.empty !== false ? <span className="focus-mode-caret" aria-hidden="true" /> : null}
    </span>
  ) : null
  const positionSpan = centred !== null ? spans[centred] : spans[Math.max(0, rest.index)]
  const position = !settings.showPosition || !positionSpan ? '' : centred === null && rest.slot === 'next'
    ? describePosition(positionSpan, rest.fresh)
    : describePosition(positionSpan)

  return (
    <div
      ref={overlayRef}
      className={[
        'focus-mode-overlay',
        scrolling ? 'is-scrolling' : '',
        gliding ? 'is-gliding' : '',
        typing ? 'is-typing' : '',
      ].filter(Boolean).join(' ')}
      data-phase={phase}
      style={{
        '--focus-mode-font-size': `${settings.fontSize}px`,
        '--focus-mode-context-font-size': `${settings.contextFontSize}px`,
      }}
      onMouseDown={focusEditor}
    >
      <div ref={backdropRef} className="focus-mode-backdrop" aria-hidden="true" />
      {position ? <div className="focus-mode-position ib-meta" aria-hidden="true">{position}</div> : null}
      <div className="focus-mode-stage" ref={stageRef}>
        <div
          className={`focus-mode-text${paragraph ? ' is-paragraph-context' : ''}`}
          ref={columnRef}
          data-glide="false"
        >
          {rest.index < 0 && spans.length ? slotLine : null}
          {sentences.map((sentence) => (
            <Fragment key={sentence.index}>
              {paragraph && sentence.prefix && sentence.index > sentences[0].index ? (
                <span className="focus-mode-prefix" aria-hidden="true">{sentence.prefix}</span>
              ) : null}
              <span
                data-index={sentence.index}
                className={[
                  'focus-mode-sentence',
                  sentence.index === rest.index && rest.slot !== 'next' ? 'current' : '',
                  sentence.index === centred ? 'is-centred' : '',
                  outside(sentence.index) ? 'is-outside' : '',
                  sentence.breakBefore ? `has-${sentence.breakBefore}-break-before` : '',
                ].filter(Boolean).join(' ')}
                onMouseDown={(event) => moveCaretToClick(
                  event,
                  sentence,
                  sentence.index === rest.index && rest.slot === 'trailing' ? caret.offset - sentence.start : sentence.text.length,
                )}
              >
                {renderSentenceText(sentence)}
              </span>
              {sentence.index === rest.index ? slotLine : null}
            </Fragment>
          ))}
          {!spans.length ? slotLine : null}
        </div>
      </div>
      <div className="ib-visually-hidden" aria-live="polite">{announcement}</div>

      <FocusModeBar
        settings={settings}
        onSetting={updateSetting}
        onExit={onExit}
        sidebars={sidebars}
        hidden={phase !== 'open'}
      />
    </div>
  )
}

/**
 * The stage's two transforms for a zoom between the page and focus mode: `away` puts
 * `target`'s first line over `source` (at the page's size), `home` is where it rests.
 */
function zoomBetween(stage, target, source) {
  // An inline sentence (the paragraph view) starts partway along its first line.
  const targetRect = target.getClientRects()[0] ?? target.getBoundingClientRect()
  const stageRect = stage.getBoundingClientRect()
  const fontSize = parseFloat(getComputedStyle(target).fontSize)
  if (!fontSize || !source.fontSize) return null
  const scale = source.fontSize / fontSize
  const origin = `${targetRect.left - stageRect.left}px ${targetRect.top - stageRect.top}px`
  const dx = source.left - targetRect.left
  const dy = source.top - targetRect.top
  return {
    away: { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, transformOrigin: origin },
    home: { transform: 'none', transformOrigin: origin },
  }
}

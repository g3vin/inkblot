/**
 * BubbleEditor.jsx — a sentence taken apart into bubbles, to be put back together.
 *
 * The page's own editor, for the Tauri app; under the Swift shell the same session is
 * drawn natively as Liquid Glass (`native/…/Bubble/`) and this does not mount.
 *
 *   - drag a bubble between two others to move it there
 *   - touch it against another bubble to join the two (with a space), on the side it
 *     touched
 *   - drop it at, or throw it toward, any edge of the window to set it aside; set-aside
 *     bubbles stay where they were put and come back with the session
 *   - drop it on the bin to delete it
 *   - type anywhere to make a new word; double-click a bubble to edit it
 *   - Sentences / Clauses / Words regroup the whole text — Sentences to reorder a
 *     paragraph — and a selected bubble of several words can be split into its words
 *
 * Punctuation is its own round bubble. The word that begins a sentence is shown with a
 * capital wherever it is moved to; the bubbles store words without one.
 *
 * Pinching on a trackpad merges the two bubbles either side of the gap under the pointer;
 * spreading two fingers over a bubble splits it one level finer.
 *
 * Forms: the arrangement can be saved as a form (⌘S), any number of them, and the bar at
 * the bottom moves between them — its dots, ⌘[ and ⌘], or a two-finger swipe sideways
 * that has to travel well past a scroll's worth before it turns the page
 * (`lib/bubbleForms.ts`). A form showing can be deleted (⌘⌫).
 *
 * Every change is one undo step (⌘Z, ⇧⌘Z). Nothing is written to the document until the
 * editor closes: Done writes the sentence and keeps the session, Archive writes it and
 * puts the session away in the document's archive (History ▸ Archive).
 */
import { useEffect, useReducer, useRef, useState } from 'react'
import { LayoutGroup, MotionConfig, motion } from 'framer-motion'
import {
  applyDrop,
  asidePoint,
  clamp,
  findBubble,
  touchTarget,
  bubbleAt,
  gapAt,
  inside,
  insertion,
  nearEdge,
  velocityOf,
  without,
} from '../lib/bubbleDrop'
import {
  clampAside,
  composeSentence,
  displayTexts,
  moveTo,
  newBubbleId,
  regroup as regroupBubbles,
  splitBubble,
  isPunctuation,
  mergeAdjacent,
  splitBubbleOnce,
  splitOnce,
  tokenize,
} from '../lib/bubbleText'
import {
  currentForm,
  deleteForm,
  formPage,
  formPages,
  formsStateOf,
  saveForm,
  settleForms,
  showFormPage,
  withFormsState,
} from '../lib/bubbleForms'
import { BubbleMode } from '../types'
import { ArchiveIcon } from './RightSidebar/ArchivePanel'
import './BubbleEditor.css'

/** Sentences first: the widest grouping, for reordering a paragraph. */
const MODES = [
  [BubbleMode.Sentences, 'Sentences'],
  [BubbleMode.Clauses, 'Clauses'],
  [BubbleMode.Words, 'Words'],
]

const DRAG_THRESHOLD = 4
/** px/ms. A release faster than this is a throw, and lands where it was heading. */
const THROW_SPEED = 0.9
const THROW_PROJECTION_MS = 240
const HISTORY_LIMIT = 100
/** How far two fingers must travel sideways to turn to the next form. */
const SWIPE_DISTANCE = 150
/** Movement before a two-finger gesture is judged sideways or not. */
const SWIPE_LOCK = 12
/** A pause this long ends a wheel gesture. */
const SWIPE_IDLE_MS = 200

/** How far the bubbles follow the fingers: less and less, the further they go. */
const rubberBand = (travel, reach = 220) => Math.sign(travel) * reach * (1 - Math.exp(-Math.abs(travel) / reach))

/* ---------------- state ---------------- */

const initHistory = (session) => ({
  present: formsStateOf(session ?? {}),
  past: [],
  future: [],
})

function historyReducer(state, action) {
  switch (action.type) {
    case 'update': {
      const next = action.fn(state.present)
      if (!next || next === state.present) return state
      return {
        present: settleForms({ ...state.present, ...next }),
        past: [...state.past.slice(-HISTORY_LIMIT + 1), state.present],
        future: [],
      }
    }
    case 'undo':
      if (!state.past.length) return state
      return {
        present: state.past[state.past.length - 1],
        past: state.past.slice(0, -1),
        future: [state.present, ...state.future],
      }
    case 'redo':
      if (!state.future.length) return state
      return {
        present: state.future[0],
        past: [...state.past, state.present],
        future: state.future.slice(1),
      }
    default:
      return state
  }
}

/* ---------------- the editor ---------------- */

export default function BubbleEditor({ session, onClose }) {
  const [history, dispatch] = useReducer(historyReducer, session, initHistory)
  const { words, aside, mode } = history.present
  const [selectedId, setSelectedId] = useState(null)
  // { id, text, draft, index } — a bubble being typed into. A draft is a new word.
  const [editing, setEditing] = useState(null)
  // { id, text, left, top, width, height, target } — the bubble under the pointer.
  const [drag, setDrag] = useState(null)
  const [droppedId, setDroppedId] = useState(null)
  // How far the bubbles are following a sideways swipe, in px.
  const [swipe, setSwipe] = useState(0)
  const overlayRef = useRef(null)
  const rowRef = useRef(null)
  const asideRef = useRef(null)
  const trashRef = useRef(null)
  const gestureRef = useRef(null)

  const update = (fn) => dispatch({ type: 'update', fn })

  useEffect(() => {
    // The document's editor still has focus; typing must come here instead.
    overlayRef.current?.focus({ preventScroll: true })
  }, [])

  // A gesture in flight when the editor closes must not leave its listeners behind.
  useEffect(() => () => gestureRef.current?.stop?.(), [])

  // Pinching on a trackpad: in, over the gap between two bubbles of the sentence, merges
  // them; out, over a bubble of several words, splits it one level finer (`splitOnce`).
  // One pinch makes one change. WebKit reports a pinch as gesture events, Chromium as a
  // wheel with ctrlKey; both are taken, and neither is left to zoom the page.
  useEffect(() => {
    const overlay = overlayRef.current
    if (!overlay) return undefined
    const bubblesIn = (container) => [...(container?.querySelectorAll('.bubble[data-bubble-id]') ?? [])]
      .map((element) => ({ id: element.dataset.bubbleId, rect: element.getBoundingClientRect() }))

    const pinch = (spreading, x, y) => {
      if (spreading) {
        const hit = bubbleAt([...bubblesIn(rowRef.current), ...bubblesIn(asideRef.current)], x, y)
        if (!hit) return false
        dispatch({ type: 'update', fn: (present) => {
          const word = present.words.find((w) => w.id === hit.id) ?? present.aside.find((w) => w.id === hit.id)
          if (!word || splitOnce(word.text).length < 2) return null
          return {
            words: splitBubbleOnce(present.words, hit.id),
            aside: splitAside(present.aside, hit.id, splitOnce),
          }
        } })
        return true
      }
      const row = bubblesIn(rowRef.current)
      const gap = gapAt(row, x, y)
      if (gap === -1) return false
      const first = row[gap].id
      const second = row[gap + 1].id
      dispatch({ type: 'update', fn: (present) => {
        const index = present.words.findIndex((word) => word.id === first)
        if (index === -1 || present.words[index + 1]?.id !== second) return null
        return { words: mergeAdjacent(present.words, index) }
      } })
      return true
    }

    // Chromium: a stream of ctrl-wheel events, in and out; a pause ends the pinch.
    let travel = 0
    let spent = false
    let idle = 0
    // A sideways two-finger swipe turns to the next or previous form. Judged sideways
    // only if it starts that way, and it must travel `SWIPE_DISTANCE` — much further than
    // a stray scroll — with the bubbles following the fingers, resisting, until it does.
    // One swipe turns one page, however long its momentum carries on.
    let swipeX = 0
    let swipeY = 0
    let swipeAxis = null
    let swipeSpent = false
    let swipeIdle = 0
    const onSwipe = (event) => {
      window.clearTimeout(swipeIdle)
      swipeIdle = window.setTimeout(() => {
        swipeX = 0
        swipeY = 0
        swipeAxis = null
        swipeSpent = false
        setSwipe(0)
      }, SWIPE_IDLE_MS)
      if (swipeAxis === 'y' || swipeSpent) {
        if (swipeSpent) event.preventDefault()
        return
      }
      // Where the fingers went. Under natural scrolling (WebKit says whether it is on)
      // a positive deltaX is the fingers moving left, toward the next form.
      const sign = event.webkitDirectionInvertedFromDevice === false ? 1 : -1
      swipeX += sign * event.deltaX
      swipeY += sign * event.deltaY
      if (!swipeAxis) {
        if (Math.hypot(swipeX, swipeY) < SWIPE_LOCK) return
        swipeAxis = Math.abs(swipeX) > 2 * Math.abs(swipeY) ? 'x' : 'y'
        if (swipeAxis === 'y') return
      }
      event.preventDefault()
      if (Math.abs(swipeX) < SWIPE_DISTANCE) {
        setSwipe(rubberBand(swipeX))
        return
      }
      swipeSpent = true
      setSwipe(0)
      const step = swipeX < 0 ? 1 : -1
      dispatch({ type: 'update', fn: (present) => showFormPage(present, formPage(present) + step) })
    }

    const onWheel = (event) => {
      if (!event.ctrlKey) {
        onSwipe(event)
        return
      }
      event.preventDefault()
      window.clearTimeout(idle)
      idle = window.setTimeout(() => { travel = 0; spent = false }, 220)
      if (spent) return
      travel -= event.deltaY
      if (Math.abs(travel) < 24) return
      spent = pinch(travel > 0, event.clientX, event.clientY)
      travel = 0
    }
    // WebKit: one gesture, its scale relative to where it began.
    let gestureSpent = false
    const onGestureStart = (event) => {
      event.preventDefault()
      gestureSpent = false
    }
    const onGestureChange = (event) => {
      event.preventDefault()
      if (gestureSpent || (event.scale < 1.2 && event.scale > 0.83)) return
      gestureSpent = pinch(event.scale > 1, event.clientX, event.clientY)
    }
    overlay.addEventListener('wheel', onWheel, { passive: false })
    overlay.addEventListener('gesturestart', onGestureStart)
    overlay.addEventListener('gesturechange', onGestureChange)
    return () => {
      window.clearTimeout(idle)
      window.clearTimeout(swipeIdle)
      overlay.removeEventListener('wheel', onWheel)
      overlay.removeEventListener('gesturestart', onGestureStart)
      overlay.removeEventListener('gesturechange', onGestureChange)
    }
  }, [])

  const close = (archive) => {
    onClose?.(withFormsState(session, history.present), archive)
  }

  /* ---------------- dragging ---------------- */

  const measure = (id) => {
    const bubbles = (container) => [...(container?.querySelectorAll('.bubble[data-bubble-id]') ?? [])]
      .filter((element) => element.dataset.bubbleId !== id)
      .map((element) => ({ id: element.dataset.bubbleId, rect: element.getBoundingClientRect() }))
    return {
      stage: overlayRef.current.getBoundingClientRect(),
      rowRect: rowRef.current.getBoundingClientRect(),
      row: bubbles(rowRef.current),
      aside: bubbles(asideRef.current),
    }
  }

  const hitTest = (gesture, x, y) => {
    const { geometry } = gesture
    const trash = trashRef.current?.getBoundingClientRect()
    if (trash && inside(trash, x, y, 18)) return { kind: 'trash' }
    // Where the dragged bubble is, from where the pointer holds it.
    const left = x - gesture.offsetX
    const top = y - gesture.offsetY
    const rect = { left, top, right: left + gesture.width, bottom: top + gesture.height }
    const touched = touchTarget(rect, [...geometry.row, ...geometry.aside])
    if (touched) return { kind: 'join', ...touched }
    if (nearEdge(geometry.stage, x, y)) {
      return { kind: 'aside', ...asidePoint(geometry.stage, x, y, gesture) }
    }
    const slot = insertion(geometry, x, y)
    // Back into the slot it came from: nothing would change, so nothing is shown.
    if (slot.index === gesture.rowIndex) return { kind: 'stay' }
    return { kind: 'insert', ...slot }
  }

  const onBubblePointerDown = (event, word) => {
    if (event.button !== 0 || editing) return
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    const gesture = {
      id: word.id,
      text: word.text,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
      // Where it sits in the sentence, or -1 for a set-aside bubble.
      rowIndex: words.findIndex((candidate) => candidate.id === word.id),
      started: false,
      samples: [{ x: event.clientX, y: event.clientY, t: event.timeStamp }],
      geometry: null,
    }

    const onMove = (moveEvent) => {
      const x = moveEvent.clientX
      const y = moveEvent.clientY
      if (!gesture.started) {
        if (Math.hypot(x - gesture.startX, y - gesture.startY) < DRAG_THRESHOLD) return
        gesture.started = true
        gesture.geometry = measure(gesture.id)
        setSelectedId(null)
        setDroppedId(null)
      }
      gesture.samples.push({ x, y, t: moveEvent.timeStamp })
      if (gesture.samples.length > 8) gesture.samples.shift()
      setDrag({
        id: gesture.id,
        text: gesture.text,
        left: x - gesture.offsetX - gesture.geometry.stage.left,
        top: y - gesture.offsetY - gesture.geometry.stage.top,
        width: gesture.width,
        height: gesture.height,
        target: hitTest(gesture, x, y),
      })
    }

    const stop = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      if (gestureRef.current === gesture) gestureRef.current = null
    }

    const onUp = (upEvent) => {
      stop()
      if (!gesture.started) {
        setSelectedId(gesture.id)
        return
      }
      const x = upEvent.clientX
      const y = upEvent.clientY
      let target = hitTest(gesture, x, y)
      const velocity = velocityOf(gesture.samples)
      if (target.kind !== 'trash' && target.kind !== 'join'
        && Math.hypot(velocity.x, velocity.y) > THROW_SPEED) {
        const { stage } = gesture.geometry
        const landX = clamp(x + velocity.x * THROW_PROJECTION_MS, stage.left, stage.right)
        const landY = clamp(y + velocity.y * THROW_PROJECTION_MS, stage.top, stage.bottom)
        if (nearEdge(stage, landX, landY)) {
          target = { kind: 'aside', ...asidePoint(stage, landX, landY, gesture) }
        }
      }
      setDrag(null)
      if (target.kind === 'stay') return
      update((present) => applyDrop(present, gesture.id, target))
      setDroppedId(target.kind === 'trash' ? null : (target.kind === 'join' ? target.id : gesture.id))
    }

    const onCancel = () => {
      stop()
      setDrag(null)
    }

    gesture.stop = stop
    gestureRef.current = gesture
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  /* ---------------- typing ---------------- */

  const startDraft = (text) => {
    const selectedIndex = words.findIndex((word) => word.id === selectedId)
    setEditing({
      id: newBubbleId(),
      text,
      draft: true,
      index: selectedIndex === -1 ? words.length : selectedIndex + 1,
    })
    setSelectedId(null)
  }

  /** Commit the bubble being typed; returns the index after it, for the next draft. */
  const commitEditing = (current = editing) => {
    if (!current) return null
    const text = current.text.trim()
    setEditing(null)
    if (current.draft) {
      if (!text) return current.index
      // Several words typed into a draft make several bubbles.
      const parts = tokenize(text)
      update((present) => {
        // A draft's input can blur as it unmounts, after Space or Enter already
        // committed it; the second commit must not add it again.
        if (findBubble(present, current.id)) return null
        const next = present.words.slice()
        next.splice(Math.min(current.index, next.length), 0,
          ...parts.map((part, index) => ({ id: index === 0 ? current.id : newBubbleId(), text: part })))
        return { words: next }
      })
      return current.index + parts.length
    }
    update((present) => {
      const rename = (word) => (word.id === current.id ? { ...word, text } : word)
      if (!text) return without(present, current.id)
      const original = findBubble(present, current.id)
      if (!original || original.text === text) return null
      return { words: present.words.map(rename), aside: present.aside.map(rename) }
    })
    return null
  }

  const onEditKeyDown = (event) => {
    event.stopPropagation()
    if (event.key === 'Escape') {
      event.preventDefault()
      setEditing(null)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      commitEditing()
      overlayRef.current?.focus({ preventScroll: true })
      return
    }
    // A space ends a new word and starts the next one; in an existing bubble it is a
    // space, because a bubble may hold several words.
    if (event.key === ' ' && editing?.draft) {
      event.preventDefault()
      if (!editing.text.trim()) return
      const nextIndex = commitEditing()
      setEditing({ id: newBubbleId(), text: '', draft: true, index: nextIndex ?? words.length })
    }
  }

  /* ---------------- bubble actions ---------------- */

  const removeBubble = (id) => {
    update((present) => without(present, id))
    setSelectedId(null)
  }

  const setAside = (id) => {
    const element = overlayRef.current?.querySelector(`.bubble[data-bubble-id="${CSS.escape(id)}"]`)
    const stage = overlayRef.current?.getBoundingClientRect()
    if (!element || !stage) return
    const rect = element.getBoundingClientRect()
    const slot = aside.length % 6
    const point = asidePoint(stage, stage.left, stage.top + stage.height * (0.22 + slot * 0.11), rect)
    update((present) => applyDrop(present, id, { kind: 'aside', ...point }))
    setDroppedId(id)
    setSelectedId(null)
  }

  const returnToSentence = (id) => {
    update((present) => applyDrop(present, id, { kind: 'insert', index: present.words.length }))
    setDroppedId(id)
    setSelectedId(null)
  }

  const splitSelected = (id) => {
    update((present) => ({ words: splitBubble(present.words, id), aside: splitAside(present.aside, id) }))
    setSelectedId(null)
  }

  const moveSelected = (delta) => {
    const index = words.findIndex((word) => word.id === selectedId)
    if (index === -1) return
    const target = clamp(index + delta, 0, words.length - 1)
    if (target === index) return
    update((present) => ({ words: moveTo(present.words, index, target) }))
  }

  const regroup = (nextMode) => {
    setSelectedId(null)
    setEditing(null)
    update((present) => ({
      words: regroupBubbles(present.words, nextMode),
      mode: nextMode,
    }))
  }

  /* ---------------- forms ---------------- */

  const showForm = (page) => {
    setSelectedId(null)
    setEditing(null)
    update((present) => showFormPage(present, page))
  }

  const saveAsForm = () => update((present) => saveForm(present))

  const deleteShownForm = () => {
    const index = currentForm(history.present)
    if (index !== -1) update((present) => deleteForm(present, index))
  }

  /* ---------------- keyboard ---------------- */

  const onKeyDown = (event) => {
    if (editing) return
    const command = event.metaKey || event.ctrlKey
    if (command && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      dispatch({ type: event.shiftKey ? 'redo' : 'undo' })
      setSelectedId(null)
      return
    }
    if (command && event.key === 'Enter') {
      event.preventDefault()
      close(false)
      return
    }
    if (command && event.key.toLowerCase() === 's') {
      event.preventDefault()
      saveAsForm()
      return
    }
    if (command && (event.key === '[' || event.key === ']')) {
      event.preventDefault()
      showForm(formPage(history.present) + (event.key === '[' ? -1 : 1))
      return
    }
    if (command && event.key === 'Backspace') {
      event.preventDefault()
      deleteShownForm()
      return
    }
    if (command || (event.altKey && event.key.length === 1)) return
    if (event.key === 'Escape') {
      event.preventDefault()
      if (selectedId) setSelectedId(null)
      else close(false)
      return
    }
    if (selectedId && (event.key === 'Backspace' || event.key === 'Delete')) {
      event.preventDefault()
      removeBubble(selectedId)
      return
    }
    if (selectedId && event.key === 'Enter') {
      event.preventDefault()
      const bubble = findBubble(history.present, selectedId)
      if (bubble) setEditing({ id: bubble.id, text: bubble.text, draft: false })
      return
    }
    if (selectedId && event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault()
      moveSelected(event.key === 'ArrowLeft' ? -1 : 1)
      return
    }
    if (event.key.length === 1 && event.key.trim()) {
      event.preventDefault()
      startDraft(event.key)
    }
  }

  /* ---------------- rendering ---------------- */

  const target = drag?.target
  const sentence = composeSentence(words, session?.original)

  const renderEditor = (current) => (
    <input
      ref={focusAtEnd}
      className="bubble-input"
      value={current.text}
      size={Math.max(2, current.text.length + 1)}
      placeholder={current.draft ? 'word' : ''}
      onChange={(event) => setEditing({ ...current, text: event.target.value })}
      onKeyDown={onEditKeyDown}
      onBlur={() => commitEditing()}
      onPointerDown={(event) => event.stopPropagation()}
      aria-label={current.draft ? 'New word' : 'Edit bubble'}
    />
  )

  /** `shown` is what the bubble says: its text, capitalized if it now begins a sentence. */
  const renderBubble = (word, where, shown = word.text) => {
    const isEditing = editing && !editing.draft && editing.id === word.id
    const selected = selectedId === word.id
    const multiword = tokenize(word.text).length > 1
    const className = [
      'bubble',
      isPunctuation(word.text) ? 'is-punctuation' : '',
      where === 'aside' ? 'is-aside' : '',
      selected ? 'is-selected' : '',
      drag?.id === word.id ? 'is-lifted' : '',
      target?.kind === 'join' && target.id === word.id ? `is-join-target ${target.before ? 'joins-before' : 'joins-after'}` : '',
      droppedId === word.id ? 'is-dropped' : '',
      isEditing ? 'is-editing' : '',
    ].filter(Boolean).join(' ')
    const style = where === 'aside' ? { left: `${word.x * 100}%`, top: `${word.y * 100}%` } : undefined

    return (
      <motion.div
        key={word.id}
        layout={droppedId === word.id ? false : 'position'}
        transition={{ type: 'spring', stiffness: 520, damping: 38 }}
        className={className}
        style={style}
        data-bubble-id={word.id}
        onPointerDown={(event) => onBubblePointerDown(event, word)}
        onDoubleClick={() => setEditing({ id: word.id, text: word.text, draft: false })}
        role="button"
        tabIndex={-1}
        aria-pressed={selected}
      >
        {isEditing ? renderEditor(editing) : <span className="bubble-text">{shown}</span>}
        {selected && !isEditing ? (
          <div className="bubble-actions" onPointerDown={(event) => event.stopPropagation()}>
            {multiword ? (
              <button type="button" onClick={() => splitSelected(word.id)}>Split</button>
            ) : null}
            {where === 'aside'
              ? <button type="button" onClick={() => returnToSentence(word.id)}>Return</button>
              : <button type="button" onClick={() => setAside(word.id)}>Set aside</button>}
            <button type="button" onClick={() => setEditing({ id: word.id, text: word.text, draft: false })}>Edit</button>
            <button type="button" className="is-destructive" onClick={() => removeBubble(word.id)}>Delete</button>
          </div>
        ) : null}
      </motion.div>
    )
  }

  // Following the fingers while a swipe is under way; easing back if it stops short.
  const slide = swipe
    ? { transform: `translateX(${swipe}px)`, transition: 'none' }
    : { transition: 'transform 220ms ease-out' }
  const shown = displayTexts(words, session?.original)
  const rowItems = words.map((word, index) => renderBubble(word, 'row', shown[index]))
  if (editing?.draft) {
    rowItems.splice(Math.min(editing.index, rowItems.length), 0, (
      <div key={`draft-${editing.id}`} className="bubble is-editing is-draft">{renderEditor(editing)}</div>
    ))
  }

  return (
    <MotionConfig reducedMotion="user">
      <div
        ref={overlayRef}
        className={[
          'bubble-editor',
          drag ? 'is-dragging' : '',
          target?.kind === 'aside' ? 'is-aside-armed' : '',
        ].filter(Boolean).join(' ')}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Bubble"
        onKeyDown={onKeyDown}
        onPointerDown={() => setSelectedId(null)}
      >
        <div className="bubble-editor-edges" aria-hidden="true" />

        <div className="bubble-editor-top" onPointerDown={(event) => event.stopPropagation()}>
          <header className="bubble-editor-bar">
            <div className="bubble-segmented" role="group" aria-label="Split into">
              {MODES.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={mode === value ? 'is-active' : ''}
                  onClick={() => regroup(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="bubble-editor-button is-icon"
              onClick={() => close(true)}
              title="Write the sentence into the document and archive this session — it can be restored from History ▸ Archive"
              aria-label="Archive"
            >
              <ArchiveIcon size={15} />
            </button>
          </header>
          <button
            type="button"
            className="bubble-editor-done"
            onClick={() => close(false)}
            title="Done — write the sentence into the document and keep this session (⌘↩)"
            aria-label="Done"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.6"
                strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        <LayoutGroup>
          <main className="bubble-stage" style={slide}>
            <div ref={rowRef} className="bubble-row">
              {rowItems}
              {!rowItems.length ? <div className="bubble-row-empty">Type, or drag a bubble back here</div> : null}
            </div>
            <p className={`bubble-preview${sentence ? '' : ' is-empty'}`}>
              {sentence || 'Leaving with no words removes the sentence.'}
            </p>
            {session?.original && session.original !== sentence ? (
              <p className="bubble-original">Was: {session.original}</p>
            ) : null}
          </main>

          <div
            ref={asideRef}
            className="bubble-aside-layer"
            style={slide}
          >
            {aside.map((word) => renderBubble(word, 'aside'))}
          </div>
        </LayoutGroup>

        {target?.kind === 'insert' && target.caret ? (
          <div
            className="bubble-caret"
            style={{ left: target.caret.left, top: target.caret.top, height: target.caret.height }}
          />
        ) : null}

        {drag ? (
          <div
            className={`bubble is-floating${isPunctuation(drag.text) ? ' is-punctuation' : ''}${target?.kind === 'trash' ? ' is-trashing' : ''}${target?.kind === 'join' ? ' is-joining' : ''}`}
            style={{ left: drag.left, top: drag.top, minWidth: drag.width, height: drag.height }}
            aria-hidden="true"
          >
            <span className="bubble-text">{drag.text}</span>
          </div>
        ) : null}

        {drag ? null : (
          <FormsBar
            state={history.present}
            onShow={showForm}
            onSave={saveAsForm}
            onDelete={deleteShownForm}
          />
        )}

        <div
          ref={trashRef}
          className={`bubble-trash${drag ? ' is-visible' : ''}${target?.kind === 'trash' ? ' is-armed' : ''}`}
          aria-hidden={!drag}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path
              d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>
    </MotionConfig>
  )
}

/**
 * The forms, at the bottom: a dot for each page — every saved form, and a ring for the
 * unsaved arrangement — which one is showing, and saving or deleting it.
 */
function FormsBar({ state, onShow, onSave, onDelete }) {
  const pages = formPages(state)
  const page = formPage(state)
  const current = currentForm(state)
  const saved = current !== -1
  const label = saved ? `Form ${current + 1} of ${state.forms.length}` : 'Unsaved'

  return (
    <div className="bubble-forms" onPointerDown={(event) => event.stopPropagation()}>
      {state.forms.length ? (
        <>
          <div className="bubble-forms-dots" role="tablist" aria-label="Forms">
            {Array.from({ length: pages }, (_, index) => {
              const unsaved = index === state.forms.length
              const name = unsaved ? 'Unsaved' : `Form ${index + 1}`
              return (
                <button
                  key={unsaved ? 'unsaved' : state.forms[index].id}
                  type="button"
                  role="tab"
                  aria-selected={index === page}
                  aria-label={name}
                  title={`${name} — swipe sideways with two fingers, or ⌘[ ⌘], to move between forms`}
                  className={`bubble-forms-dot${index === page ? ' is-current' : ''}${unsaved ? ' is-unsaved' : ''}`}
                  onClick={() => onShow(index)}
                />
              )
            })}
          </div>
          <span className="bubble-forms-label">{label}</span>
        </>
      ) : null}
      {saved ? (
        <button
          type="button"
          className="bubble-forms-icon is-destructive"
          onClick={onDelete}
          title="Delete this form (⌘⌫). The bubbles stay as they are."
          aria-label="Delete Form"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path
              d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"
              fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
            />
          </svg>
        </button>
      ) : (
        <button
          type="button"
          className="bubble-forms-icon"
          onClick={onSave}
          title="Save this arrangement as a new form to come back to (⌘S)"
          aria-label="Save as New Form"
        >
          {/* A stack of versions, with one more being added. */}
          <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
            <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="9.5" width="13" height="11" rx="2.5" />
              <path d="M6 6.5h7.5M18.5 11.5v5" />
              <path d="M19.5 3v6M16.5 6h6" />
            </g>
          </svg>
        </button>
      )}
    </div>
  )
}

/** Focus a bubble's text field once, with the caret after what is already typed. */
function focusAtEnd(input) {
  if (!input || input.ownerDocument.activeElement === input) return
  input.focus({ preventScroll: true })
  input.setSelectionRange(input.value.length, input.value.length)
}

/** A set-aside bubble split up stays aside, its parts stacked where it was. */
function splitAside(aside, id, split = tokenize) {
  return aside.flatMap((word) => {
    if (word.id !== id) return [word]
    const parts = split(word.text)
    if (parts.length <= 1) return [word]
    return parts.map((text, index) => clampAside({
      id: newBubbleId(),
      text,
      x: word.x,
      y: word.y + (index - (parts.length - 1) / 2) * 0.07,
    }))
  })
}

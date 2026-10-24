/**
 * BubbleEditor.jsx — a sentence taken apart into bubbles, to be put back together.
 *
 *   - drag a bubble between two others to move it there
 *   - touch it against another bubble to join the two (with a space), on the side it
 *     touched
 *   - drop it on, or throw it up to, the shelf along the top to set it aside (the shelf
 *     glows); set-aside bubbles stay where they were put along it and come back with
 *     the session
 *   - drop it on the bin to delete it
 *   - type anywhere to make a new word; double-click a bubble to edit it
 *   - Sentences / Clauses / Words regroup the whole text — Sentences to reorder a
 *     paragraph — and a selected bubble of several words can be split into its words
 *   - pinch in over a gap to merge, out over a bubble to split (useBubbleGestures)
 *
 * Punctuation is its own round bubble. The word that begins a sentence is shown with a
 * capital wherever it is moved to; the bubbles store words without one.
 *
 * Forms: the arrangement can be saved as a form (⌘S), any number of them, and the bar at
 * the bottom moves between them — its dots, ⌘[ and ⌘], or a two-finger swipe sideways
 * (`lib/bubbleForms.ts`). A form showing can be deleted (⌘⌫).
 *
 * Every change is one undo step (⌘Z, ⇧⌘Z). Nothing is written to the document until the
 * editor closes: Done writes the sentence and keeps the session, Archive writes it and
 * puts the session away in the document's archive (History ▸ Archive). Escape steps back
 * one thing at a time: out of typing, then off the selection, then out of the editor.
 *
 * It takes the place of the pane it was opened from, its bubbles straight on the tray,
 * and the rest of the window stays: the sidebars, and in a split the other document. Its
 * bar is the card's toolbar, which it takes over while it is up (`toolbarSlot`). If the
 * pane is given another document while it is open (`detached`), the session can't be
 * written back, so it is put in its own document's archive instead.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LayoutGroup, MotionConfig } from 'framer-motion'
import {
  applyDrop,
  clamp,
  findBubble,
  touchTarget,
  bubbleAt,
  gapAt,
  inside,
  insertion,
  nearShelf,
  shelfPoint,
  throwLanding,
  velocityOf,
  without,
} from '../../lib/bubbleDrop'
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
} from '../../lib/bubbleText'
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
} from '../../lib/bubbleForms'
import BubbleChip from './BubbleChip'
import BubbleFormsBar, { TrashGlyph } from './BubbleFormsBar'
import BubbleTopControls from './BubbleTopControls'
import useBubbleGestures from './useBubbleGestures'
import './BubbleEditor.css'

const DRAG_THRESHOLD = 4
const HISTORY_LIMIT = 100

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

export default function BubbleEditor({ session, onClose, toolbarSlot = null, detached = false }) {
  const [history, dispatch] = useReducer(historyReducer, session, initHistory)
  const { words, aside, mode } = history.present
  const [selectedId, setSelectedId] = useState(null)
  // { id, text, draft, index } — a bubble being typed into. A draft is a new word.
  const [editing, setEditing] = useState(null)
  // { id, text, left, top, width, height, target } — the bubble under the pointer.
  const [drag, setDrag] = useState(null)
  const [droppedId, setDroppedId] = useState(null)
  // How far the bubbles are following a sideways swipe, in px, and which way it would
  // turn were the fingers lifted now (0: it would not).
  const [swipe, setSwipe] = useState({ offset: 0, armed: 0 })
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


  /* ---------------- pinching and swiping ---------------- */

  const bubblesIn = (container) => [...(container?.querySelectorAll('.bubble[data-bubble-id]') ?? [])]
    .map((element) => ({ id: element.dataset.bubbleId, rect: element.getBoundingClientRect() }))

  const pinch = useCallback((spreading, x, y) => {
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
  }, [])

  const presentRef = useRef(history.present)
  useEffect(() => { presentRef.current = history.present }, [history.present])
  const canTurn = useCallback((step) => {
    const present = presentRef.current
    if (!present.forms?.length) return false
    const next = formPage(present) + step
    return next >= 0 && next < formPages(present)
  }, [])
  const turn = useCallback((step) => {
    dispatch({ type: 'update', fn: (present) => showFormPage(present, formPage(present) + step) })
  }, [])
  const follow = useCallback((offset, armed) => setSwipe({ offset, armed }), [])

  useBubbleGestures(overlayRef, { onPinch: pinch, onSwipe: follow, onTurn: turn, canTurn, enabled: !drag && !editing })

  const close = (archive) => {
    onClose?.(withFormsState(session, history.present), archive)
  }

  // The pane has another document now: keep the work in this one's archive.
  const presentForDetach = useRef(null)
  useEffect(() => {
    presentForDetach.current = () => onClose?.(withFormsState(session, history.present), true, { detached: true })
  })
  useEffect(() => {
    if (detached) presentForDetach.current()
  }, [detached])

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
    if (nearShelf(geometry.stage, y)) return { kind: 'aside', ...shelfPoint(geometry.stage, x, gesture) }
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
      // A throw: released moving, and heading for the shelf. It lands where it was going.
      if (target.kind !== 'trash' && target.kind !== 'join') {
        const { stage } = gesture.geometry
        const landing = throwLanding(stage, { x, y }, velocityOf(gesture.samples))
        if (landing) target = { kind: 'aside', ...shelfPoint(stage, landing.x, gesture) }
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
    const point = shelfPoint(stage, stage.left + stage.width * (0.1 + slot * 0.16), rect)
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
    const edit = () => setEditing({ id: word.id, text: word.text, draft: false })
    return (
      <BubbleChip
        key={word.id}
        word={word}
        where={where}
        shown={shown}
        selected={selectedId === word.id}
        lifted={drag?.id === word.id}
        joinTarget={target?.kind === 'join' && target.id === word.id ? target : null}
        dropped={droppedId === word.id}
        editor={isEditing ? renderEditor(editing) : null}
        onPointerDown={(event) => onBubblePointerDown(event, word)}
        onEdit={edit}
        actions={{
          split: () => splitSelected(word.id),
          setAside: () => setAside(word.id),
          returnToSentence: () => returnToSentence(word.id),
          remove: () => removeBubble(word.id),
        }}
      />
    )
  }

  // Following the fingers while a swipe is under way; easing back if it stops short.
  const slide = swipe.offset
    ? { transform: `translateX(${swipe.offset}px)`, transition: 'none' }
    : { transition: 'transform 220ms var(--ease-standard)' }
  const shown = displayTexts(words, session?.original)
  const rowItems = words.map((word, index) => renderBubble(word, 'row', shown[index]))
  if (editing?.draft) {
    rowItems.splice(Math.min(editing.index, rowItems.length), 0, (
      <div key={`draft-${editing.id}`} className="bubble is-editing is-draft">{renderEditor(editing)}</div>
    ))
  }

  const topControls = <BubbleTopControls mode={mode} onMode={regroup} onArchive={() => close(true)} onDone={() => close(false)} />

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
        role="region"
        aria-label="Bubble"
        onKeyDown={onKeyDown}
        onPointerDown={() => setSelectedId(null)}
        // The pane under it hands focus to its (hidden) editor on these; typing is ours.
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="bubble-editor-shelf" aria-hidden="true" />

        {toolbarSlot ? createPortal(topControls, toolbarSlot) : topControls}

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
          <BubbleFormsBar
            state={history.present}
            armed={swipe.armed}
            onShow={showForm}
            onSave={saveAsForm}
            onDelete={deleteShownForm}
          />
        )}

        <div
          ref={trashRef}
          className={`bubble-trash floating-capsule${drag ? ' is-visible' : ''}${target?.kind === 'trash' ? ' is-armed' : ''}`}
          aria-hidden={!drag}
        >
          <TrashGlyph size={22} />
        </div>
      </div>
    </MotionConfig>
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

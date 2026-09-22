/**
 * FocusModeOverlay.jsx — distraction-free "focus mode".
 *
 * Fullscreen overlay that mirrors the active editor's text one sentence at a
 * time (with optional surrounding context or full-paragraph view). The user
 * can scroll/arrow between sentences, click to reposition the caret, and tune
 * font sizes and context window via the control bar. All edits still happen
 * in the underlying TipTap editor; this overlay only renders a view of it and
 * moves its selection.
 */
import { Fragment as ReactFragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { TextSelection } from '@tiptap/pm/state'
import { isEditorReady } from '../lib/editorUtils'
import { getPreference, setPreference } from '../lib/preferences'

const FOCUS_MODE_SETTINGS_KEY = 'inkblot-focus-mode-settings'
const FOCUS_MODE_WHEEL_SENTENCE_PX = 92
const FOCUS_MODE_WHEEL_RESET_MS = 180
const FOCUS_MODE_WHEEL_MAX_SENTENCES = 8
const FOCUS_MODE_OPENING_MS = 1200
const DEFAULT_FOCUS_MODE_SETTINGS = {
  before: 0,
  after: 0,
  fontSize: 42,
  contextFontSize: 28,
  paragraphContext: false,
}

const clampNumber = (value, min, max) => Math.min(max, Math.max(min, value))

/** Convert wheel deltas to pixels regardless of the event's delta mode. */
const normalizeWheelDeltaY = (event) => {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * 16
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * window.innerHeight
  return event.deltaY
}

/** Load persisted focus-mode settings, clamping each value to its valid range. */
const loadFocusModeSettings = () => {
  try {
    const parsed = JSON.parse(getPreference(FOCUS_MODE_SETTINGS_KEY) || '{}')
    return {
      before: clampNumber(Number(parsed.before) || DEFAULT_FOCUS_MODE_SETTINGS.before, 0, 6),
      after: clampNumber(Number(parsed.after) || DEFAULT_FOCUS_MODE_SETTINGS.after, 0, 6),
      fontSize: clampNumber(Number(parsed.fontSize) || DEFAULT_FOCUS_MODE_SETTINGS.fontSize, 28, 72),
      contextFontSize: clampNumber(
        Number(parsed.contextFontSize) || DEFAULT_FOCUS_MODE_SETTINGS.contextFontSize,
        18,
        56
      ),
      paragraphContext: Boolean(parsed.paragraphContext),
    }
  } catch {
    return DEFAULT_FOCUS_MODE_SETTINGS
  }
}

const saveFocusModeSettings = (settings) => {
  try {
    setPreference(FOCUS_MODE_SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // Ignore storage failures; focus mode can still use the in-memory settings.
  }
}

/** Split text into sentence spans ({ start, end, text }), keeping punctuation with the sentence. */
const getSentenceSpans = (text = '') => {
  const spans = []
  const regex = /[^.!?\n]+(?:[.!?]+["')\]]*)?/g
  let match

  while ((match = regex.exec(text)) !== null) {
    const raw = match[0]
    const leading = raw.match(/^\s*/)?.[0]?.length || 0
    const trailing = raw.match(/\s*$/)?.[0]?.length || 0
    const start = match.index + leading
    const end = match.index + raw.length - trailing

    if (end > start) {
      spans.push({
        start,
        end,
        text: text.slice(start, end),
      })
    }
  }

  return spans
}

/**
 * Compute the window of sentences to display around the active one
 * (or all of them in paragraph-context mode), annotating each with the
 * whitespace prefix that separates it from the previous sentence so
 * line/paragraph breaks can be rendered.
 */
const getVisibleFocusSentences = (spans, fullText, activeIndex, before, after, paragraphContext = false) => {
  const start = paragraphContext ? 0 : Math.max(0, activeIndex - before)
  const end = paragraphContext ? spans.length : Math.min(spans.length, activeIndex + after + 1)
  const slicedSpans = spans.slice(start, end)

  return {
    visibleSentences: slicedSpans.map((span, index) => {
      const previousSpan = index > 0 ? slicedSpans[index - 1] : null
      const prefix = previousSpan ? fullText.slice(previousSpan.end, span.start) : ''
      return {
        ...span,
        prefix,
        breakBefore: /\n{2,}/.test(prefix) ? 'paragraph' : /\n/.test(prefix) ? 'line' : '',
      }
    }),
    currentIndex: activeIndex - start,
  }
}

/** Map the editor selection to an offset in the focus-mode text (first non-space char of a selection). */
const getFocusOffsetFromSelection = (textMap, selection) => {
  const startOffset = getTextOffsetForDocPosition(textMap.positions, selection.from)
  if (selection.empty) return startOffset

  const endOffset = getTextOffsetForDocPosition(textMap.positions, selection.to)
  const selectedText = textMap.text.slice(startOffset, endOffset)
  const firstSelectedCharacter = selectedText.search(/\S/)

  if (firstSelectedCharacter !== -1) {
    return startOffset + firstSelectedCharacter
  }

  return startOffset
}

/**
 * Flatten the ProseMirror doc into plain text plus a parallel array mapping
 * each text offset back to its document position. Block boundaries become
 * "\n\n" and hard breaks become "\n" so sentence detection sees structure.
 */
const buildFocusTextMap = (doc) => {
  const chunks = []
  const positions = []
  let previousBlock = null

  const appendBreak = (breakText, pos) => {
    for (let index = 0; index < breakText.length; index += 1) {
      chunks.push(breakText[index])
      positions.push(pos)
    }
  }

  doc.descendants((node, pos, parent) => {
    const block = parent?.isBlock ? parent : null

    if (node.type.name === 'hardBreak') {
      appendBreak('\n', pos)
      previousBlock = block
      return
    }

    if (!node.isText || !node.text) return

    if (chunks.length && block && block !== previousBlock) {
      appendBreak('\n\n', pos)
    }

    for (let index = 0; index < node.text.length; index += 1) {
      chunks.push(node.text[index])
      positions.push(pos + index)
    }

    previousBlock = block
  })

  const fallbackPos = Math.max(1, doc.content.size - 1)
  positions.push(positions.length ? positions[positions.length - 1] + 1 : fallbackPos)

  return {
    text: chunks.join(''),
    positions,
  }
}

/** Inverse of buildFocusTextMap: find the text offset whose doc position matches (or first past) `docPosition`. */
const getTextOffsetForDocPosition = (positions, docPosition) => {
  if (!positions.length) return 0

  for (let index = 0; index < positions.length; index += 1) {
    if (positions[index] === docPosition) {
      let exactIndex = index
      while (exactIndex + 1 < positions.length && positions[exactIndex + 1] === docPosition) {
        exactIndex += 1
      }
      return exactIndex
    }
    if (positions[index] > docPosition) return index
  }

  return Math.max(0, positions.length - 1)
}

/** Character offset of (targetNode, targetOffset) within `element`'s flattened text content. */
const getTextOffsetInElement = (element, targetNode, targetOffset) => {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  let offset = 0

  while (walker.nextNode()) {
    const node = walker.currentNode
    const textLength = node.nodeValue?.length || 0
    if (node === targetNode) {
      return offset + clampNumber(targetOffset, 0, textLength)
    }
    offset += textLength
  }

  return null
}

/** Best-effort caret offset for a click inside a rendered sentence (falls back to start/end by half). */
const getOffsetFromClick = (event, text) => {
  const element = event.currentTarget
  const caretPosition = document.caretPositionFromPoint?.(event.clientX, event.clientY)
  if (caretPosition?.offsetNode && element.contains(caretPosition.offsetNode)) {
    const offset = getTextOffsetInElement(element, caretPosition.offsetNode, caretPosition.offset)
    if (offset !== null) return clampNumber(offset, 0, text.length)
  }

  const caretRange = document.caretRangeFromPoint?.(event.clientX, event.clientY)
  if (caretRange?.startContainer && element.contains(caretRange.startContainer)) {
    const offset = getTextOffsetInElement(element, caretRange.startContainer, caretRange.startOffset)
    if (offset !== null) return clampNumber(offset, 0, text.length)
  }

  const rect = element.getBoundingClientRect()
  return event.clientX < rect.left + rect.width / 2 ? 0 : text.length
}

export default function FocusModeOverlay({ editor, onExit }) {
  const [settings, setSettings] = useState(loadFocusModeSettings)
  const [visibleSentences, setVisibleSentences] = useState([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [cursorOffset, setCursorOffset] = useState(0)
  const [focusTextOffset, setFocusTextOffset] = useState(0)
  const [opening, setOpening] = useState(true)
  const overlayRef = useRef(null)
  const focusTextRef = useRef(null)
  const sentenceRefs = useRef(new Map())
  const textMapRef = useRef({ text: '', positions: [] })
  const sentenceSpansRef = useRef([])
  const activeSentenceIndexRef = useRef(0)
  const wheelRemainderRef = useRef(0)
  const wheelDirectionRef = useRef(0)
  const wheelResetTimerRef = useRef(null)

  // Rebuild the sentence window from the editor's current doc + selection.
  const updateVisibleSentences = useCallback(() => {
    if (!isEditorReady(editor)) {
      setVisibleSentences([])
      setCurrentIndex(0)
      textMapRef.current = { text: '', positions: [] }
      sentenceSpansRef.current = []
      activeSentenceIndexRef.current = 0
      return
    }

    const { doc, selection } = editor.state
    const textMap = buildFocusTextMap(doc)
    textMapRef.current = textMap
    const fullText = textMap.text
    const cursorOffset = getFocusOffsetFromSelection(textMap, selection)
    const spans = getSentenceSpans(fullText)
    sentenceSpansRef.current = spans
    setCursorOffset(cursorOffset)

    if (!spans.length) {
      setVisibleSentences([])
      setCurrentIndex(0)
      activeSentenceIndexRef.current = 0
      return
    }

    let activeIndex = spans.findIndex((span, index) => (
      cursorOffset >= span.start &&
      (cursorOffset < span.end || (index === spans.length - 1 && cursorOffset <= span.end))
    ))
    if (activeIndex === -1) {
      const nextIndex = spans.findIndex(span => cursorOffset < span.start)
      activeIndex = nextIndex === -1 ? spans.length - 1 : Math.max(0, nextIndex - 1)
    }
    const nextFocusWindow = getVisibleFocusSentences(
      spans,
      fullText,
      activeIndex,
      settings.before,
      settings.after,
      settings.paragraphContext
    )

    activeSentenceIndexRef.current = activeIndex
    setVisibleSentences(nextFocusWindow.visibleSentences)
    setCurrentIndex(nextFocusWindow.currentIndex)
  }, [editor, settings.after, settings.before, settings.paragraphContext])

  // Update one setting, clamping to its allowed range, and persist the result.
  const updateSetting = useCallback((key, value) => {
    setSettings((current) => {
      const next = {
        ...current,
        [key]: key === 'fontSize'
          ? clampNumber(Number(value), 28, 72)
          : key === 'contextFontSize'
            ? clampNumber(Number(value), 18, 56)
            : key === 'paragraphContext'
              ? Boolean(value)
              : clampNumber(Number(value), 0, 6),
      }
      saveFocusModeSettings(next)
      return next
    })
  }, [])

  // Follow the editor: any transaction or selection change refreshes the view.
  useEffect(() => {
    updateVisibleSentences()
    if (!isEditorReady(editor)) return undefined

    const handler = () => updateVisibleSentences()
    editor.on('transaction', handler)
    editor.on('selectionUpdate', handler)
    editor.commands.focus()

    return () => {
      if (!editor.isDestroyed) {
        editor.off('transaction', handler)
        editor.off('selectionUpdate', handler)
      }
    }
  }, [editor, updateVisibleSentences])

  const focusEditor = useCallback(() => {
    if (isEditorReady(editor)) {
      editor.commands.focus()
    }
  }, [editor])

  // Move the real editor caret to a focus-text offset (via the text→doc position map).
  const placeCursorAtTextOffset = useCallback((textOffset) => {
    if (!isEditorReady(editor)) return

    const normalizedTextOffset = clampNumber(textOffset, 0, textMapRef.current.positions.length - 1)
    const docPosition = textMapRef.current.positions[normalizedTextOffset]
    if (!Number.isFinite(docPosition)) return

    const selectionPosition = clampNumber(docPosition, 1, editor.state.doc.content.size)
    try {
      const tr = editor.state.tr.setSelection(TextSelection.create(editor.state.doc, selectionPosition))
      editor.view.dispatch(tr.scrollIntoView())
      editor.commands.focus()
      setCursorOffset(normalizedTextOffset)
    } catch (error) {
      console.warn('Failed to place focus mode cursor:', error)
      editor.commands.focus()
    }
  }, [editor])

  const moveCursorToSentenceClick = useCallback((event, sentence) => {
    event.preventDefault()
    event.stopPropagation()

    const localOffset = getOffsetFromClick(event, sentence.text)
    placeCursorAtTextOffset(sentence.start + localOffset)
  }, [placeCursorAtTextOffset])

  // Step the active sentence up/down by `direction` sentences and move the caret there.
  const moveToAdjacentSentence = useCallback((direction) => {
    const spans = sentenceSpansRef.current
    if (!spans.length) return

    const targetIndex = clampNumber(activeSentenceIndexRef.current + direction, 0, spans.length - 1)
    const targetSentence = spans[targetIndex]
    if (!targetSentence) return

    const nextFocusWindow = getVisibleFocusSentences(
      spans,
      textMapRef.current.text || '',
      targetIndex,
      settings.before,
      settings.after,
      settings.paragraphContext
    )

    activeSentenceIndexRef.current = targetIndex
    setVisibleSentences(nextFocusWindow.visibleSentences)
    setCurrentIndex(nextFocusWindow.currentIndex)
    setCursorOffset(targetSentence.start)
    placeCursorAtTextOffset(targetSentence.start)
  }, [placeCursorAtTextOffset, settings.after, settings.before, settings.paragraphContext])

  // Wheel scrolling steps between sentences: accumulate deltas into whole
  // sentence steps, resetting the remainder after a pause or direction change.
  const handleFocusWheel = useCallback((event) => {
    if (event.target instanceof Element && event.target.closest('.focus-mode-control-zone')) return

    const deltaY = normalizeWheelDeltaY(event)
    if (!Number.isFinite(deltaY) || Math.abs(deltaY) < 1) return

    const direction = deltaY > 0 ? 1 : -1
    if (wheelDirectionRef.current && wheelDirectionRef.current !== direction) {
      wheelRemainderRef.current = 0
    }

    event.preventDefault()
    event.stopPropagation()
    wheelDirectionRef.current = direction
    wheelRemainderRef.current += deltaY

    if (wheelResetTimerRef.current) {
      window.clearTimeout(wheelResetTimerRef.current)
    }
    wheelResetTimerRef.current = window.setTimeout(() => {
      wheelRemainderRef.current = 0
      wheelDirectionRef.current = 0
      wheelResetTimerRef.current = null
    }, FOCUS_MODE_WHEEL_RESET_MS)

    const sentenceSteps = Math.min(
      FOCUS_MODE_WHEEL_MAX_SENTENCES,
      Math.floor(Math.abs(wheelRemainderRef.current) / FOCUS_MODE_WHEEL_SENTENCE_PX)
    )
    if (!sentenceSteps) return

    const spans = sentenceSpansRef.current
    const currentSentenceIndex = activeSentenceIndexRef.current
    const targetIndex = clampNumber(
      currentSentenceIndex + direction * sentenceSteps,
      0,
      Math.max(0, spans.length - 1)
    )
    const movedSteps = Math.abs(targetIndex - currentSentenceIndex)

    if (!movedSteps) {
      wheelRemainderRef.current = 0
      return
    }

    wheelRemainderRef.current -= direction * movedSteps * FOCUS_MODE_WHEEL_SENTENCE_PX
    moveToAdjacentSentence(direction * movedSteps)
  }, [moveToAdjacentSentence])

  // The active sentence renders with an inline caret marker at the cursor offset.
  const renderFocusSentenceText = (sentence, index) => {
    if (index !== currentIndex) return sentence.text

    const caretOffset = clampNumber(cursorOffset - sentence.start, 0, sentence.text.length)
    const before = sentence.text.slice(0, caretOffset)
    const after = sentence.text.slice(caretOffset)

    return (
      <>
        {before}
        <span className="focus-mode-caret" aria-hidden="true" />
        {after}
      </>
    )
  }

  // Escape exits focus mode; arrow keys step between sentences.
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation?.()
        onExit?.()
        return
      }

      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
      if (event.target instanceof Element && event.target.closest('.focus-mode-control-zone')) return

      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation?.()
      moveToAdjacentSentence(event.key === 'ArrowUp' ? -1 : 1)
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [moveToAdjacentSentence, onExit])

  // Vertically translate the text column so the active sentence stays centered.
  const updateFocusTextPosition = useCallback(() => {
    const overlayElement = overlayRef.current
    const focusTextElement = focusTextRef.current
    const sentence = visibleSentences[currentIndex]
    const sentenceElement = sentence ? sentenceRefs.current.get(`${sentence.start}-${sentence.end}`) : null

    if (!overlayElement || !focusTextElement || !sentenceElement) {
      setFocusTextOffset(0)
      return
    }

    const overlayRect = overlayElement.getBoundingClientRect()
    const sentenceRect = sentenceElement.getBoundingClientRect()
    setFocusTextOffset((current) => {
      const sentenceCenterWithoutTransform =
        sentenceRect.top - current + sentenceRect.height / 2
      const desiredOffset =
        overlayRect.top + overlayRect.height / 2 - sentenceCenterWithoutTransform

      return Math.abs(current - desiredOffset) < 0.5 ? current : desiredOffset
    })
  }, [currentIndex, visibleSentences])

  useLayoutEffect(() => {
    updateFocusTextPosition()
  }, [
    settings.contextFontSize,
    settings.fontSize,
    settings.paragraphContext,
    updateFocusTextPosition,
  ])

  useEffect(() => {
    const handleResize = () => {
      updateFocusTextPosition()
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [updateFocusTextPosition])

  useEffect(() => () => {
    if (wheelResetTimerRef.current) {
      window.clearTimeout(wheelResetTimerRef.current)
    }
  }, [])

  // Play the opening animation once, then settle into the normal view.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setOpening(false)
    }, FOCUS_MODE_OPENING_MS)

    return () => window.clearTimeout(timer)
  }, [])

  // Stagger the opening animation by distance from the active sentence.
  const getOpeningSentenceStyle = (index) => {
    const distance = Math.min(Math.abs(index - currentIndex), 6)
    const direction = index === currentIndex ? 0 : index < currentIndex ? -1 : 1

    return {
      '--focus-mode-sentence-delay': `${360 + distance * 78}ms`,
      '--focus-mode-sentence-direction': direction,
    }
  }

  return (
    <div
      ref={overlayRef}
      className={`focus-mode-overlay${opening ? ' is-opening' : ''}`}
      style={{
        '--focus-mode-font-size': `${settings.fontSize}px`,
        '--focus-mode-context-font-size': `${settings.contextFontSize}px`,
      }}
      onMouseDown={focusEditor}
      onWheel={handleFocusWheel}
    >
      <div
        className={`focus-mode-text${settings.paragraphContext ? ' is-paragraph-context' : ''}`}
        ref={focusTextRef}
        style={{ '--focus-mode-text-offset': `${focusTextOffset}px` }}
        aria-live="polite"
      >
        {visibleSentences.length ? (
          visibleSentences.map((sentence, index) => (
            <ReactFragment key={`${sentence.start}-${sentence.end}`}>
              {settings.paragraphContext && sentence.prefix ? (
                <span
                  className="focus-mode-prefix"
                  style={getOpeningSentenceStyle(index)}
                  aria-hidden="true"
                >
                  {sentence.prefix}
                </span>
              ) : null}
              <span
                ref={(element) => {
                  const key = `${sentence.start}-${sentence.end}`
                  if (element) {
                    sentenceRefs.current.set(key, element)
                  } else {
                    sentenceRefs.current.delete(key)
                  }
                }}
                className={[
                  'focus-mode-sentence',
                  index === currentIndex ? 'current' : '',
                  sentence.breakBefore ? `has-${sentence.breakBefore}-break-before` : '',
                ].filter(Boolean).join(' ')}
                style={getOpeningSentenceStyle(index)}
                onMouseDown={(event) => moveCursorToSentenceClick(event, sentence)}
              >
                {renderFocusSentenceText(sentence, index)}
              </span>
            </ReactFragment>
          ))
        ) : (
          <span className="focus-mode-sentence current">
            <span className="focus-mode-caret" aria-hidden="true" />
          </span>
        )}
      </div>

      <div className="focus-mode-control-zone" onMouseDown={(event) => event.stopPropagation()}>
        <div className={`focus-mode-controls${settings.paragraphContext ? ' is-paragraph-mode' : ''}`}>
          <div className="focus-mode-display-toggle" role="group" aria-label="Focus mode display">
            <button
              type="button"
              className={!settings.paragraphContext ? 'active' : ''}
              onClick={() => updateSetting('paragraphContext', false)}
            >
              Sentence
            </button>
            <button
              type="button"
              className={settings.paragraphContext ? 'active' : ''}
              onClick={() => updateSetting('paragraphContext', true)}
            >
              Paragraph
            </button>
          </div>
          {!settings.paragraphContext ? (
            <>
              <label className="focus-mode-slider">
                <span>Before</span>
                <input
                  type="range"
                  min="0"
                  max="6"
                  value={settings.before}
                  onChange={(event) => updateSetting('before', event.target.value)}
                />
                <strong>{settings.before}</strong>
              </label>
              <label className="focus-mode-slider">
                <span>After</span>
                <input
                  type="range"
                  min="0"
                  max="6"
                  value={settings.after}
                  onChange={(event) => updateSetting('after', event.target.value)}
                />
                <strong>{settings.after}</strong>
              </label>
            </>
          ) : null}
          <label className="focus-mode-slider focus-mode-slider-wide">
            <span>Focus</span>
            <input
              type="range"
              min="28"
              max="72"
              value={settings.fontSize}
              onChange={(event) => updateSetting('fontSize', event.target.value)}
            />
            <strong>{settings.fontSize}</strong>
          </label>
          <label className="focus-mode-slider focus-mode-slider-wide">
            <span>Context</span>
            <input
              type="range"
              min="18"
              max="56"
              value={settings.contextFontSize}
              onChange={(event) => updateSetting('contextFontSize', event.target.value)}
            />
            <strong>{settings.contextFontSize}</strong>
          </label>
          <button className="focus-mode-exit" type="button" onClick={onExit}>
            Exit
          </button>
        </div>
      </div>
    </div>
  )
}

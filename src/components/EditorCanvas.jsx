import { Fragment as ReactFragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { StarterKit } from '@tiptap/starter-kit'
import { Color } from '@tiptap/extension-color'
import { Dropcursor } from '@tiptap/extension-dropcursor'
import { FontFamily } from '@tiptap/extension-font-family'
import { TextAlign } from '@tiptap/extension-text-align'
import { Highlight } from '@tiptap/extension-highlight'
import { Table } from '@tiptap/extension-table'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { TableRow } from '@tiptap/extension-table-row'
import { Underline } from '@tiptap/extension-underline'
import { createDocument } from '@tiptap/core'
import { Fragment } from '@tiptap/pm/model'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import ResizableImage from './extensions/ResizableImage'
import { debounce } from 'lodash'

import { CustomTextStyle } from './extensions/CustomTextStyle'
import { DictationInline } from './extensions/DictationInline'
import { NoteAnnotation, syncEditorNotes } from './extensions/NoteAnnotation'
import PinterestBoard, { normalizePinterestBoardUrl } from './extensions/PinterestBoard'
import { ReadAloudHighlight } from './extensions/ReadAloudHighlight'
import TabIndent from './extensions/TabIndent'
import { saveDocument, loadDocument, getVersions } from './FileSystem'
import SFIcon from './SFIcon'

const EMPTY_NOTES = []
const EMPTY_DOC_CONTENT = '<p></p>'
const FOCUS_MODE_SETTINGS_KEY = 'inkblot-focus-mode-settings'
const DEFAULT_FOCUS_MODE_SETTINGS = {
  before: 0,
  after: 0,
  fontSize: 42,
  contextFontSize: 28,
  paragraphContext: false,
}

const countWords = (text = '') => {
  const trimmed = text.trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).length
}

const emptyWordStats = {
  total: 0,
  selected: null,
}

const clampNumber = (value, min, max) => Math.min(max, Math.max(min, value))

const loadFocusModeSettings = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(FOCUS_MODE_SETTINGS_KEY) || '{}')
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
    localStorage.setItem(FOCUS_MODE_SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // Ignore storage failures; focus mode can still use the in-memory settings.
  }
}

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

const getVisibleFocusSentences = (spans, fullText, activeIndex, before, after, paragraphContext = false) => {
  const start = paragraphContext ? 0 : Math.max(0, activeIndex - before)
  const end = paragraphContext ? spans.length : Math.min(spans.length, activeIndex + after + 1)
  const slicedSpans = spans.slice(start, end)

  return {
    visibleSentences: slicedSpans.map((span, index) => {
      const previousSpan = index > 0 ? slicedSpans[index - 1] : null
      return {
        ...span,
        prefix: previousSpan ? fullText.slice(previousSpan.end, span.start) : '',
      }
    }),
    currentIndex: activeIndex - start,
  }
}

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

const buildFocusTextMap = (doc) => {
  const chunks = []
  const positions = []
  let previousBlock = null

  doc.descendants((node, pos, parent) => {
    if (!node.isText || !node.text) return

    const block = parent?.isBlock ? parent : null
    if (chunks.length && block && block !== previousBlock) {
      chunks.push('\n')
      positions.push(pos)
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

const getTextOffsetForDocPosition = (positions, docPosition) => {
  if (!positions.length) return 0

  for (let index = 0; index < positions.length; index += 1) {
    if (positions[index] >= docPosition) return index
  }

  return Math.max(0, positions.length - 1)
}

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

const isEditorReady = (instance) => Boolean(
  instance &&
  !instance.isDestroyed &&
  instance.state?.schema?.nodes &&
  instance.view &&
  !instance.view.isDestroyed &&
  instance.commandManager &&
  instance.commands &&
  typeof instance.chain === 'function'
)

const areNoteArraysEqual = (left = [], right = []) => {
  if (left === right) return true
  if (!Array.isArray(left) || !Array.isArray(right)) return false
  if (left.length !== right.length) return false

  for (let index = 0; index < left.length; index += 1) {
    const leftNote = left[index]
    const rightNote = right[index]

    if (leftNote === rightNote) continue
    if (!leftNote || !rightNote) return false

    const leftKeys = Object.keys(leftNote)
    const rightKeys = Object.keys(rightNote)
    if (leftKeys.length !== rightKeys.length) return false

    for (const key of leftKeys) {
      if (leftNote[key] !== rightNote[key]) {
        return false
      }
    }
  }

  return true
}

function FocusModeOverlay({ editor, onExit }) {
  const [settings, setSettings] = useState(loadFocusModeSettings)
  const [visibleSentences, setVisibleSentences] = useState([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [cursorOffset, setCursorOffset] = useState(0)
  const [focusTextOffset, setFocusTextOffset] = useState(0)
  const overlayRef = useRef(null)
  const focusTextRef = useRef(null)
  const sentenceRefs = useRef(new Map())
  const textMapRef = useRef({ text: '', positions: [] })
  const sentenceSpansRef = useRef([])
  const activeSentenceIndexRef = useRef(0)

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

  return (
    <div
      ref={overlayRef}
      className="focus-mode-overlay"
      style={{
        '--focus-mode-font-size': `${settings.fontSize}px`,
        '--focus-mode-context-font-size': `${settings.contextFontSize}px`,
      }}
      onMouseDown={focusEditor}
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
                <span className="focus-mode-prefix" aria-hidden="true">
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
                className={`focus-mode-sentence${index === currentIndex ? ' current' : ''}`}
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

export default function EditorCanvas({
  setEditor,
  setSecondaryEditor,
  setActiveEditor,
  projectName,
  currentDoc,
  setCurrentDoc,
  splitView,
  setSplitView,
  secondaryDoc,
  setSecondaryDoc,
  notesByDoc,
  setNotesForDoc,
  activeDoc,
  setActiveDoc,
  setVersions,
  showWordCountBadge = true,
  onMoveClipboardEntryToEditor,
  activeEditor,
  focusModeOpen = false,
  onExitFocusMode,
}) {
  const hasActiveDoc = Boolean(projectName && currentDoc)
  const primaryPaneRef = useRef(null)
  const secondaryPaneRef = useRef(null)
  const [dragCaret, setDragCaret] = useState(null)
  const notesByDocRef = useRef(notesByDoc)
  const loadedDocsRef = useRef(new Set())
  const docStateCacheRef = useRef(new Map())
  const primaryAutosaveRef = useRef(null)
  const secondaryAutosaveRef = useRef(null)
  const isLoadingPrimaryRef = useRef(false)
  const isLoadingSecondaryRef = useRef(false)

  const getDocCacheKey = useCallback((docProjectName, docName, paneId) => (
    docProjectName && docName && paneId ? `${docProjectName}::${paneId}::${docName}` : ''
  ), [])

  const hasNotesForDoc = useCallback((docName) => (
    Object.prototype.hasOwnProperty.call(notesByDocRef.current || {}, docName)
  ), [])

  const createEditorStateFromContent = useCallback((targetEditor, content) => {
    const doc = createDocument(
      content || EMPTY_DOC_CONTENT,
      targetEditor.schema,
      {},
      { errorOnInvalidContent: targetEditor.options.enableContentCheck }
    )

    return EditorState.create({
      doc,
      schema: targetEditor.schema,
      plugins: targetEditor.state.plugins,
    })
  }, [])

  const installEditorState = useCallback((targetEditor, nextState) => {
    targetEditor.view.updateState(nextState)
    targetEditor.createNodeViews?.()
  }, [])

  const stashEditorState = useCallback((targetEditor, docName, paneId) => {
    if (!isEditorReady(targetEditor)) return
    const cacheKey = getDocCacheKey(projectName, docName, paneId)
    if (!cacheKey || !loadedDocsRef.current.has(cacheKey)) return
    docStateCacheRef.current.set(cacheKey, targetEditor.state)
  }, [getDocCacheKey, projectName])

  const flushAutosave = useCallback((handlerRef) => {
    const handler = handlerRef.current
    if (handler && typeof handler.flush === 'function') {
      handler.flush()
    }
  }, [])

  const restoreEditorStateForDoc = useCallback((targetEditor, docName, paneId, loadedDoc) => {
    const cacheKey = getDocCacheKey(projectName, docName, paneId)
    const cachedState = cacheKey ? docStateCacheRef.current.get(cacheKey) : null
    const nextState = cachedState || createEditorStateFromContent(targetEditor, loadedDoc?.content)

    installEditorState(targetEditor, nextState)
    if (cacheKey) {
      loadedDocsRef.current.add(cacheKey)
    }

    if (!hasNotesForDoc(docName)) {
      setNotesForDoc(docName, loadedDoc?.notes || [])
    }

    return Boolean(cachedState)
  }, [
    createEditorStateFromContent,
    getDocCacheKey,
    hasNotesForDoc,
    installEditorState,
    projectName,
    setNotesForDoc,
  ])

  const getMountedEditorView = (instance) => {
    if (!isEditorReady(instance)) return null
    const view = instance.editorView || instance.view
    if (!view || view.isDestroyed) return null
    return view
  }

  const createPasteHandler = () => {
    return (view, event) => {
      const items = event.clipboardData?.items

      const imageItem = items
        ? Array.from(items).find(item => item.type.startsWith('image/'))
        : null

      if (imageItem) {
        const file = imageItem.getAsFile()
        if (!file) return false

        const reader = new FileReader()
        reader.onload = () => {
          const src = reader.result
          if (typeof src !== 'string') return

          const { schema, tr } = view.state
          const imageNode = schema.nodes.image?.create({ src })
          if (!imageNode) return
          view.dispatch(tr.replaceSelectionWith(imageNode))
        }
        reader.readAsDataURL(file)
        return true
      }

      // Pinterest board auto-embed when pasting a board URL.
      const pastedText = event.clipboardData?.getData('text/plain')
      const boardUrl = normalizePinterestBoardUrl(pastedText)
      if (boardUrl) {
        const { schema, tr, selection } = view.state
        const boardNode = schema.nodes.pinterestBoard?.create({ url: boardUrl })
        if (!boardNode) return false

        const paragraph = schema.nodes.paragraph?.create()
        const fragment = paragraph
          ? Fragment.fromArray([boardNode, paragraph])
          : Fragment.fromArray([boardNode])

        view.dispatch(
          tr
            .replaceRange(selection.from, selection.to, fragment)
            .scrollIntoView()
        )
        return true
      }

      // If a plain-paste was explicitly requested elsewhere (e.g. Cmd+Shift+V handler),
      // handle it here by inserting plain text only. Otherwise, let default paste proceed
      // so normal Cmd+V preserves formatting.
      if (window.__inkblot_forcePlainPaste) {
        try { event.preventDefault(); } catch (e) {}

        const plainTextFromClipboard = event.clipboardData?.getData('text/plain') || ''
        const { tr, selection } = view.state
        tr.insertText(plainTextFromClipboard, selection.from, selection.to)
        view.dispatch(tr.scrollIntoView())
        // reset the flag so subsequent pastes behave normally
        try { window.__inkblot_forcePlainPaste = false } catch (e) {}
        return true
      }

      // Not a forced plain paste — return false to allow TipTap's default paste handling
      return false
    }
  }

  const getDraggedClipboardPayload = (event) => {
    const transfer = event?.dataTransfer
    const globalDragged = window.__inkblot_draggedClipboardEntry
    const globalDraggedEditorSelection = window.__inkblot_draggedEditorSelection
    const raw = transfer?.getData('application/x-inkblot-clipboard-entry')
    const plainText = transfer?.getData('text/plain') || ''
    if (!raw && !globalDragged?.text && !plainText) return null
    if (!raw && !globalDragged?.text && globalDraggedEditorSelection) return null

    let parsed = null
    if (raw) {
      try { parsed = JSON.parse(raw) } catch (e) {}
    }

    const text = parsed?.text || globalDragged?.text || plainText
    const id = parsed?.id || globalDragged?.id || ''
    if (!String(text).trim()) return null
    return { id, text: String(text) }
  }

  const emitDnDDebug = (phase, status = {}, info = '', transient = false) => {
    try {
      window.dispatchEvent(new CustomEvent('inkblot:dnd-debug', {
        detail: { phase, status, info, transient },
      }))
    } catch (e) {}
  }

  const clearDragGlobals = () => {
    try { window.__inkblot_draggedClipboardEntry = null } catch (e) {}
    try { window.__inkblot_draggedEditorSelection = null } catch (e) {}
    try { window.__inkblot_dragPoint = null } catch (e) {}
    try { window.__inkblot_dropHandled = false } catch (e) {}
    emitDnDDebug('drag-globals-cleared', {
      source: 'none',
      over: 'none',
      dropHandled: false,
      editorSelection: false,
      clipboardPayload: false,
    }, '', true)
  }

  const isPointInRect = (x, y, rect) => {
    if (!rect) return false
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
  }

  const getTargetEditorAtPoint = (x, y) => {
    if (x == null || y == null) return null

    const primaryRect = primaryPaneRef.current?.getBoundingClientRect?.()
    if (isEditorReady(editor) && isPointInRect(x, y, primaryRect)) return editor

    const secondaryRect = secondaryPaneRef.current?.getBoundingClientRect?.()
    if (splitView === 'editor' && isEditorReady(secondaryEditor) && isPointInRect(x, y, secondaryRect)) {
      return secondaryEditor
    }

    return null
  }

  const updateDropCaret = (targetEditor, event) => {
    const view = getMountedEditorView(targetEditor)
    if (!view) return
    const coords = view.posAtCoords({ left: event.clientX, top: event.clientY })
    if (!coords?.pos) return

    const nextSelection = TextSelection.create(view.state.doc, coords.pos)
    const samePos =
      view.state.selection.from === nextSelection.from &&
      view.state.selection.to === nextSelection.to

    if (!samePos) {
      view.dispatch(view.state.tr.setSelection(nextSelection))
    }

    const caretCoords = view.coordsAtPos(coords.pos)
    const paneEl =
      targetEditor === secondaryEditor ? secondaryPaneRef.current : primaryPaneRef.current
    const paneRect = paneEl?.getBoundingClientRect?.()
    if (!paneRect || !caretCoords) return

    setDragCaret({
      pane: targetEditor === secondaryEditor ? 'secondary' : 'primary',
      left: Math.max(0, caretCoords.left - paneRect.left),
      top: Math.max(0, caretCoords.top - paneRect.top),
      height: Math.max(18, caretCoords.bottom - caretCoords.top),
    })
  }

  const handlePaneDragStart = (event, targetEditor, source, docName) => {
    if (!isEditorReady(targetEditor)) return
    const { selection, doc } = targetEditor?.state || {}
    if (!selection || selection.empty) return

    const text = doc.textBetween(selection.from, selection.to, '\n')
    if (!text.trim()) return

    const payload = {
      from: selection.from,
      to: selection.to,
      text,
      source,
      docName: docName || '',
    }

    try { window.__inkblot_draggedEditorSelection = payload } catch (e) {}
    try { window.__inkblot_dropHandled = false } catch (e) {}
    emitDnDDebug('editor-dragstart', {
      source: 'editor',
      over: 'none',
      dropHandled: false,
      editorSelection: true,
      clipboardPayload: false,
    }, `${source}:${docName || ''} len=${text.length}`)
    try {
      event.dataTransfer?.setData('application/x-inkblot-editor-selection', JSON.stringify(payload))
      if (!event.dataTransfer?.getData('text/plain')) {
        event.dataTransfer?.setData('text/plain', text)
      }
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move'
      }
    } catch (e) {}
  }

  const handlePaneDragOver = (event, targetEditor) => {
    const payload = getDraggedClipboardPayload(event)
    if (!payload || !isEditorReady(targetEditor)) return
    event.preventDefault()
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move'
    }
    updateDropCaret(targetEditor, event)
    emitDnDDebug('editor-dragover', {
      over: 'editor',
      clipboardPayload: true,
    }, '', true)
  }

  const handlePaneDrop = (event, targetEditor) => {
    const payload = getDraggedClipboardPayload(event)
    const view = getMountedEditorView(targetEditor)
    if (!payload || !view) return

    event.preventDefault()
    event.stopPropagation()

    const coords = view.posAtCoords({ left: event.clientX, top: event.clientY })
    const insertPos = coords?.pos ?? view.state.selection.from
    const tr = view.state.tr.insertText(payload.text, insertPos, insertPos)
    view.dispatch(tr.scrollIntoView())
    view.focus()

    onMoveClipboardEntryToEditor?.(payload.id)
    try { window.__inkblot_dropHandled = true } catch (e) {}
    setDragCaret(null)
    emitDnDDebug('editor-drop', {
      source: 'clipboard',
      over: 'editor',
      dropHandled: true,
      clipboardPayload: true,
    }, `id=${payload.id || 'none'} len=${payload.text.length}`)
  }

  const insertClipboardPayloadAtPoint = (payload, targetEditor, x, y) => {
    const view = getMountedEditorView(targetEditor)
    if (!payload || !view) return false
    const coords = view.posAtCoords({ left: x, top: y })
    const insertPos = coords?.pos ?? view.state.selection.from
    const tr = view.state.tr.insertText(payload.text, insertPos, insertPos)
    view.dispatch(tr.scrollIntoView())
    view.focus()
    onMoveClipboardEntryToEditor?.(payload.id)
    try { window.__inkblot_dropHandled = true } catch (e) {}
    setDragCaret(null)
    emitDnDDebug('editor-fallback-insert-on-dragend', {
      source: 'clipboard',
      over: 'editor',
      dropHandled: true,
      clipboardPayload: true,
    }, `id=${payload.id || 'none'} len=${payload.text.length}`)
    return true
  }

  const [primaryWordStats, setPrimaryWordStats] = useState(emptyWordStats)
  const [secondaryWordStats, setSecondaryWordStats] = useState(emptyWordStats)
  const currentDocNotes = notesByDoc?.[currentDoc] ?? EMPTY_NOTES
  const secondaryDocNotes = notesByDoc?.[secondaryDoc] ?? EMPTY_NOTES
  const activeDocNotes = notesByDoc?.[activeDoc] ?? EMPTY_NOTES

  const getWordStats = useCallback((targetEditor) => {
    if (!isEditorReady(targetEditor)) return emptyWordStats

    const { selection, doc } = targetEditor.state
    const selectedText = selection?.empty
      ? ''
      : doc.textBetween(selection.from, selection.to, '\n')

    return {
      total: countWords(targetEditor.getText()),
      selected: selection?.empty ? null : countWords(selectedText),
    }
  }, [])

  const formatWordStats = ({ total, selected }) => {
    const count = selected == null ? total : selected
    const wordLabel = count === 1 ? 'word' : 'words'
    return selected == null ? `${count} ${wordLabel}` : `${count} ${wordLabel} selected`
  }

  useEffect(() => {
    notesByDocRef.current = notesByDoc
  }, [notesByDoc])

  /* ---------------- Primary Editor ---------------- */

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        bulletList: { keepMarks: true },
        orderedList: { keepMarks: true },
      }),
      Dropcursor.configure({
        color: 'rgba(84, 165, 255, 0.95)',
        width: 2,
      }),
      CustomTextStyle,
      Color,
      FontFamily,
      NoteAnnotation,
      ReadAloudHighlight,
      DictationInline,
      PinterestBoard,
      TabIndent,
      Underline,
      TextAlign.configure({
        types: ['heading', 'paragraph', 'tableCell', 'tableHeader'],
      }),
      Highlight.configure({
        multicolor: true,
      }),
      Table.configure({
        resizable: true,
      }),
      TableRow,
      TableHeader,
      TableCell,
      ResizableImage.configure({
        inline: true,
        allowBase64: true,
      }),
    ],
    content: '',
    editorProps: {
      handlePaste: createPasteHandler(),
    },
  })

  /* ---------------- Secondary Editor ---------------- */

  const secondaryEditor = useEditor({
    extensions: [
      StarterKit,
      Dropcursor.configure({
        color: 'rgba(84, 165, 255, 0.95)',
        width: 2,
      }),
      CustomTextStyle,
      Color,
      FontFamily,
      NoteAnnotation,
      ReadAloudHighlight,
      DictationInline,
      PinterestBoard,
      TabIndent,
      Underline,
      TextAlign.configure({
        types: ['heading', 'paragraph', 'tableCell', 'tableHeader'],
      }),
      Highlight.configure({ multicolor: true }),
      Table.configure({
        resizable: true,
      }),
      TableRow,
      TableHeader,
      TableCell,
      ResizableImage.configure({
        inline: true,
        allowBase64: true,
      }),
    ],
    content: '',
    editorProps: {
      handlePaste: createPasteHandler(),
    },
  })

  useEffect(() => {
    const attachDragMeta = (instance, source, docName) => {
      const dom = getMountedEditorView(instance)?.dom
      if (!dom || !instance?.state) return () => {}

      const onDragStart = (event) => {
        const { selection, doc } = instance.state
        if (!selection || selection.empty) return

        const text = doc.textBetween(selection.from, selection.to, '\n')
        if (!text.trim()) return

        const payload = {
          from: selection.from,
          to: selection.to,
          text,
          source,
          docName: docName || '',
        }

        try { window.__inkblot_draggedEditorSelection = payload } catch (e) {}
        emitDnDDebug('editor-dom-dragstart', {
          source: 'editor',
          editorSelection: true,
          dropHandled: false,
        }, `${source}:${docName || ''} len=${text.length}`)
        try {
          event.dataTransfer?.setData('application/x-inkblot-editor-selection', JSON.stringify(payload))
          event.dataTransfer?.setData('text/plain', text)
          if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move'
          }
        } catch (e) {}
      }

      const onDragEnd = () => {
        emitDnDDebug('editor-dom-dragend', {
          source: 'editor',
          editorSelection: Boolean(window.__inkblot_draggedEditorSelection),
        })
      }

      dom.addEventListener('dragstart', onDragStart, true)
      dom.addEventListener('dragend', onDragEnd, true)
      return () => {
        dom.removeEventListener('dragstart', onDragStart, true)
        dom.removeEventListener('dragend', onDragEnd, true)
      }
    }

    const offPrimary = attachDragMeta(editor, 'primary', currentDoc)
    const offSecondary = attachDragMeta(secondaryEditor, 'secondary', secondaryDoc)
    return () => {
      offPrimary()
      offSecondary()
    }
  }, [editor, secondaryEditor, currentDoc, secondaryDoc])

  useEffect(() => {
    const pane = primaryPaneRef.current
    if (!pane || !isEditorReady(editor)) return

    const onDragStart = (event) => handlePaneDragStart(event, editor, 'primary', currentDoc)
    const onDragEnd = () => {
      emitDnDDebug('primary-pane-dragend', {
        source: 'editor',
        editorSelection: Boolean(window.__inkblot_draggedEditorSelection),
        clipboardPayload: Boolean(window.__inkblot_draggedClipboardEntry),
      }, '', true)
    }
    const onDragOver = (event) => handlePaneDragOver(event, editor)
    const onDrop = (event) => handlePaneDrop(event, editor)

    pane.addEventListener('dragstart', onDragStart, true)
    pane.addEventListener('dragend', onDragEnd, true)
    pane.addEventListener('dragover', onDragOver, true)
    pane.addEventListener('drop', onDrop, true)

    return () => {
      pane.removeEventListener('dragstart', onDragStart, true)
      pane.removeEventListener('dragend', onDragEnd, true)
      pane.removeEventListener('dragover', onDragOver, true)
      pane.removeEventListener('drop', onDrop, true)
    }
  // DnD helpers intentionally read the current editor globals at event time.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, currentDoc])

  useEffect(() => {
    const pane = secondaryPaneRef.current
    if (!pane || !isEditorReady(secondaryEditor) || splitView !== 'editor') return

    const onDragStart = (event) => handlePaneDragStart(event, secondaryEditor, 'secondary', secondaryDoc)
    const onDragEnd = () => {
      emitDnDDebug('secondary-pane-dragend', {
        source: 'editor',
        editorSelection: Boolean(window.__inkblot_draggedEditorSelection),
        clipboardPayload: Boolean(window.__inkblot_draggedClipboardEntry),
      }, '', true)
    }
    const onDragOver = (event) => handlePaneDragOver(event, secondaryEditor)
    const onDrop = (event) => handlePaneDrop(event, secondaryEditor)

    pane.addEventListener('dragstart', onDragStart, true)
    pane.addEventListener('dragend', onDragEnd, true)
    pane.addEventListener('dragover', onDragOver, true)
    pane.addEventListener('drop', onDrop, true)

    return () => {
      pane.removeEventListener('dragstart', onDragStart, true)
      pane.removeEventListener('dragend', onDragEnd, true)
      pane.removeEventListener('dragover', onDragOver, true)
      pane.removeEventListener('drop', onDrop, true)
    }
  // DnD helpers intentionally read the current editor globals at event time.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondaryEditor, secondaryDoc, splitView])

  useEffect(() => {
    const onWindowDragOver = (event) => {
      try { window.__inkblot_dragPoint = { x: event.clientX, y: event.clientY } } catch (e) {}
      const payload = getDraggedClipboardPayload(event)
      if (!payload) {
        setDragCaret(null)
        return
      }

      const targetEditor = getTargetEditorAtPoint(event.clientX, event.clientY)
      if (!targetEditor) {
        setDragCaret(null)
        return
      }

      event.preventDefault()
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move'
      }
      updateDropCaret(targetEditor, event)
      emitDnDDebug('window-dragover-editor-target', {
        over: 'editor',
        clipboardPayload: true,
      }, '', true)
    }

    const onWindowDrag = (event) => {
      try { window.__inkblot_dragPoint = { x: event.clientX, y: event.clientY } } catch (e) {}
      const payload = window.__inkblot_draggedClipboardEntry || null
      if (!payload?.text) {
        setDragCaret(null)
        return
      }

      const targetEditor = getTargetEditorAtPoint(event.clientX, event.clientY)
      if (!targetEditor) {
        setDragCaret(null)
        return
      }

      updateDropCaret(targetEditor, event)
      emitDnDDebug('window-drag-editor-target', {
        over: 'editor',
        clipboardPayload: true,
      }, '', true)
    }

    const onWindowDrop = (event) => {
      const payload = getDraggedClipboardPayload(event)
      if (!payload) return

      const targetEditor = getTargetEditorAtPoint(event.clientX, event.clientY)
      if (!targetEditor) return

      handlePaneDrop(event, targetEditor)
      emitDnDDebug('window-drop-editor-target', {
        over: 'editor',
        dropHandled: true,
      })
    }

    const onWindowDragEnd = (event) => {
      if (!window.__inkblot_dragPoint && (event?.clientX || event?.clientY)) {
        try { window.__inkblot_dragPoint = { x: event.clientX, y: event.clientY } } catch (e) {}
      }
      setDragCaret(null)
      emitDnDDebug('window-dragend', {
        dropHandled: Boolean(window.__inkblot_dropHandled),
        clipboardPayload: Boolean(window.__inkblot_draggedClipboardEntry),
        editorSelection: Boolean(window.__inkblot_draggedEditorSelection),
      }, `x=${String(event?.clientX ?? window.__inkblot_dragPoint?.x ?? null)} y=${String(event?.clientY ?? window.__inkblot_dragPoint?.y ?? null)}`)
    }

    window.addEventListener('drag', onWindowDrag, true)
    window.addEventListener('dragover', onWindowDragOver, true)
    window.addEventListener('drop', onWindowDrop, true)
    window.addEventListener('dragend', onWindowDragEnd, true)

    return () => {
      window.removeEventListener('drag', onWindowDrag, true)
      window.removeEventListener('dragover', onWindowDragOver, true)
      window.removeEventListener('drop', onWindowDrop, true)
      window.removeEventListener('dragend', onWindowDragEnd, true)
    }
  // Window DnD listeners depend on stable DOM globals and active editor refs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, secondaryEditor, splitView])

  useEffect(() => {
    const onClipboardDragEndDrop = (event) => {
      const detail = event?.detail || {}
      const point = {
        x: detail.x ?? window.__inkblot_dragPoint?.x ?? null,
        y: detail.y ?? window.__inkblot_dragPoint?.y ?? null,
      }
      const payload = {
        id: detail.id || '',
        text: detail.text || '',
      }

      if (window.__inkblot_dropHandled) {
        emitDnDDebug('clipboard-dragend-drop-skipped', {
          source: 'clipboard',
          dropHandled: true,
        }, `id=${payload.id || 'none'}`)
        setDragCaret(null)
        clearDragGlobals()
        return
      }

      const targetEditor = getTargetEditorAtPoint(point.x, point.y)
      if (targetEditor && payload.text) {
        insertClipboardPayloadAtPoint(payload, targetEditor, point.x, point.y)
      } else {
        emitDnDDebug('clipboard-dragend-drop-miss', {
          source: 'clipboard',
          over: 'none',
          clipboardPayload: Boolean(payload.text),
        }, `x=${String(point.x)} y=${String(point.y)}`)
      }

      setDragCaret(null)
      clearDragGlobals()
    }

    window.addEventListener('inkblot:clipboard-dragend-drop', onClipboardDragEndDrop)
    return () => {
      window.removeEventListener('inkblot:clipboard-dragend-drop', onClipboardDragEndDrop)
    }
  // Clipboard drag completion reads the current drop globals at event time.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, secondaryEditor, splitView])

  /* ---------------- Expose Editor ---------------- */

  useEffect(() => {
    if (isEditorReady(editor)) setEditor(editor)
    return () => {
      setEditor(current => (current === editor ? null : current))
      setActiveEditor?.(current => (current === editor ? null : current))
    }
  }, [editor, setActiveEditor, setEditor])

  useEffect(() => {
    if (isEditorReady(secondaryEditor)) setSecondaryEditor?.(secondaryEditor)
    return () => {
      setSecondaryEditor?.(current => (current === secondaryEditor ? null : current))
      setActiveEditor?.(current => (current === secondaryEditor ? null : current))
    }
  }, [secondaryEditor, setActiveEditor, setSecondaryEditor])

  /* ---------------- Load Primary Doc ---------------- */

  useEffect(() => {
    if (!isEditorReady(editor) || !currentDoc) return
    let cancelled = false
    const cacheKey = getDocCacheKey(projectName, currentDoc, 'primary')

    const load = async () => {
      isLoadingPrimaryRef.current = true
      loadedDocsRef.current.delete(cacheKey)

      try {
        const doc = await loadDocument(projectName, currentDoc)
        if (cancelled || !isEditorReady(editor)) return

        restoreEditorStateForDoc(editor, currentDoc, 'primary', doc)
        if (!doc?.content || doc.content?.content?.length === 0) {
          editor.commands.focus('start')
        }
        setPrimaryWordStats(getWordStats(editor))

        // load versions for the right sidebar
        try {
          const vs = await getVersions(projectName, currentDoc)
          setVersions?.(currentDoc, vs)
        } catch (e) {
          console.error('Failed to load versions:', e)
          setVersions?.(currentDoc, [])
        }
      } finally {
        isLoadingPrimaryRef.current = false
      }
    }

    load()
    return () => {
      cancelled = true
      flushAutosave(primaryAutosaveRef)
      stashEditorState(editor, currentDoc, 'primary')
    }
  }, [
    currentDoc,
    editor,
    flushAutosave,
    getWordStats,
    getDocCacheKey,
    projectName,
    restoreEditorStateForDoc,
    setVersions,
    stashEditorState,
  ])

  /* ---------------- Load Secondary Doc ---------------- */

  useEffect(() => {
    if (!isEditorReady(secondaryEditor) || splitView !== 'editor' || !secondaryDoc) return
    let cancelled = false
    const cacheKey = getDocCacheKey(projectName, secondaryDoc, 'secondary')

    const load = async () => {
      isLoadingSecondaryRef.current = true
      loadedDocsRef.current.delete(cacheKey)

      try {
        const doc = await loadDocument(projectName, secondaryDoc)
        if (cancelled || !isEditorReady(secondaryEditor)) return

        restoreEditorStateForDoc(secondaryEditor, secondaryDoc, 'secondary', doc)
        setSecondaryWordStats(getWordStats(secondaryEditor))
      } finally {
        isLoadingSecondaryRef.current = false
      }
    }

    load()
    return () => {
      cancelled = true
      flushAutosave(secondaryAutosaveRef)
      stashEditorState(secondaryEditor, secondaryDoc, 'secondary')
    }
  }, [
    flushAutosave,
    getDocCacheKey,
    getWordStats,
    projectName,
    restoreEditorStateForDoc,
    secondaryDoc,
    secondaryEditor,
    splitView,
    stashEditorState,
  ])

  /* ---------------- Sync Notes → Editor Storage ---------------- */

  useEffect(() => {
    if (!isEditorReady(editor)) return
    syncEditorNotes(editor, currentDocNotes, currentDoc)
  }, [currentDoc, currentDocNotes, editor])

  useEffect(() => {
    if (!isEditorReady(secondaryEditor) || splitView !== 'editor') return
    syncEditorNotes(secondaryEditor, secondaryDocNotes, secondaryDoc)
  }, [secondaryDoc, secondaryDocNotes, secondaryEditor, splitView])

  /* ---------------- Autosave ---------------- */

  useEffect(() => {
    if (!isEditorReady(editor) || !currentDoc) return
    const handler = debounce(async () => {
      if (!isEditorReady(editor)) return
      if (isLoadingPrimaryRef.current) return
      if (!loadedDocsRef.current.has(getDocCacheKey(projectName, currentDoc, 'primary'))) return

      const contentJson = editor.getJSON()
      const contentHtml = editor.getHTML()

      await saveDocument(projectName, currentDoc, {
        content: contentJson,
        notes: notesByDocRef.current?.[currentDoc] || [],
        _appendVersion: true,
        _version: {
          contentHtml,
          contentJson,
        },
      })

      try {
        const vs = await getVersions(projectName, currentDoc)
        setVersions?.(currentDoc, vs)
      } catch (e) {
        console.error('Failed to refresh versions:', e)
      }
    }, 800)

    primaryAutosaveRef.current = handler
    editor.on('update', handler)

    return () => {
      if (!editor.isDestroyed) editor.off('update', handler)
      handler.flush()
      handler.cancel()
      if (primaryAutosaveRef.current === handler) {
        primaryAutosaveRef.current = null
      }
    }
  }, [currentDoc, editor, getDocCacheKey, projectName, setVersions])

  /* ---------------- Word Count ---------------- */

  useEffect(() => {
    if (!isEditorReady(editor)) return

    const update = () => {
      if (!isEditorReady(editor)) return
      setPrimaryWordStats(getWordStats(editor))
    }

    editor.on('update', update)
    editor.on('selectionUpdate', update)
    update()

    return () => {
      if (!editor.isDestroyed) {
        editor.off('update', update)
        editor.off('selectionUpdate', update)
      }
    }
  }, [editor, getWordStats])

  useEffect(() => {
    if (!isEditorReady(secondaryEditor) || splitView !== 'editor' || !secondaryDoc) return

    const handler = debounce(async () => {
      if (!isEditorReady(secondaryEditor)) return
      if (isLoadingSecondaryRef.current) return
      if (!loadedDocsRef.current.has(getDocCacheKey(projectName, secondaryDoc, 'secondary'))) return

      await saveDocument(projectName, secondaryDoc, {
        content: secondaryEditor.getJSON(),
        notes: notesByDocRef.current?.[secondaryDoc] || [],
      })
    }, 800)

    secondaryAutosaveRef.current = handler
    secondaryEditor.on('update', handler)

    return () => {
      if (!secondaryEditor.isDestroyed) secondaryEditor.off('update', handler)
      handler.flush()
      handler.cancel()
      if (secondaryAutosaveRef.current === handler) {
        secondaryAutosaveRef.current = null
      }
    }
  }, [getDocCacheKey, projectName, secondaryDoc, secondaryEditor, splitView])

  useEffect(() => {
    if (!isEditorReady(secondaryEditor) || splitView !== 'editor') return

    const update = () => {
      if (!isEditorReady(secondaryEditor)) return
      setSecondaryWordStats(getWordStats(secondaryEditor))
    }

    secondaryEditor.on('update', update)
    secondaryEditor.on('selectionUpdate', update)
    update()

    return () => {
      if (!secondaryEditor.isDestroyed) {
        secondaryEditor.off('update', update)
        secondaryEditor.off('selectionUpdate', update)
      }
    }
  }, [getWordStats, secondaryEditor, splitView])

  /* ---------------- Autosave Notes ---------------- */

  useEffect(() => {
    if (!activeDoc) return
    const activePaneId = activeDoc === secondaryDoc && activeDoc !== currentDoc ? 'secondary' : 'primary'
    if (!loadedDocsRef.current.has(getDocCacheKey(projectName, activeDoc, activePaneId))) return

    const getEditorForDoc = (docName) => {
      if (docName === currentDoc) return editor
      if (docName === secondaryDoc) return secondaryEditor
      return null
    }

    const targetEditor = getEditorForDoc(activeDoc)
    if (!isEditorReady(targetEditor)) return

    const handler = debounce(async () => {
      if (!isEditorReady(targetEditor)) return
      if (
        (activeDoc === currentDoc && isLoadingPrimaryRef.current) ||
        (activeDoc === secondaryDoc && isLoadingSecondaryRef.current)
      ) {
        return
      }

      const contentJson = targetEditor.getJSON()
      const contentHtml = targetEditor.getHTML && targetEditor.getHTML()
      await saveDocument(projectName, activeDoc, {
        content: contentJson,
        notes: activeDocNotes,
        _appendVersion: true,
        _version: { contentHtml, contentJson },
      })
    }, 800)

    // run once to persist notes immediately, include version snapshot to avoid overwriting versions
    try { handler() } catch (e) {}

    return () => {
      handler.cancel()
    }
  }, [activeDoc, activeDocNotes, currentDoc, editor, getDocCacheKey, projectName, secondaryDoc, secondaryEditor])

  /* ---------------- Anchor Remapping ---------------- */

  useEffect(() => {
    if (!isEditorReady(editor)) return

    const handler = ({ transaction }) => {
      if (!isEditorReady(editor)) return
      if (!transaction.docChanged) return
      if (isLoadingPrimaryRef.current) return

      const existingNotes = notesByDocRef.current?.[currentDoc] || []
      const hasQuoteNotes = existingNotes.some(note => note.type === 'quote')
      if (!hasQuoteNotes) return

      const mapping = transaction.mapping

      const updated = existingNotes
        .map(note => {
          if (note.type !== 'quote') return note

          const newFrom = mapping.map(note.from)
          const newTo = mapping.map(note.to)

          if (newFrom >= newTo) return null

          return {
            ...note,
            from: newFrom,
            to: newTo,
            anchor: editor.state.doc.textBetween(newFrom, newTo),
          }
        })
        .filter(Boolean)

      if (areNoteArraysEqual(existingNotes, updated)) {
        return
      }

      setNotesForDoc(currentDoc, updated)
    }

    editor.on('transaction', handler)
    return () => {
      if (!editor.isDestroyed) editor.off('transaction', handler)
    }

  }, [editor, currentDoc, setNotesForDoc])

  /* ---------------- Render ---------------- */

  const closeSecondary = () => {
    setSecondaryDoc?.(null)
    setSplitView?.(null)
  }

  const closePrimary = () => {
    if (secondaryDoc) {
      setCurrentDoc?.(secondaryDoc)
    }
    closeSecondary()
  }

  const focusEditor = (target) => {
    if (!isEditorReady(target)) return
    if (target.isEmpty) {
      target.commands.focus('start')
      return
    }
    target.chain().focus().run()
  }

  const liveEditor = isEditorReady(editor) ? editor : null
  const liveSecondaryEditor = isEditorReady(secondaryEditor) ? secondaryEditor : null
  const liveActiveEditor = isEditorReady(activeEditor) ? activeEditor : null
  const focusModeEditor = liveActiveEditor || liveEditor || liveSecondaryEditor

  if (!hasActiveDoc) {
    return (
      <div className="middle-section">
        <div className="empty-state">
          <div className="empty-state-content">
            {projectName ? 'Create a new document to begin.' : 'Select a project to begin.'}
            {projectName && (
              <button
                className="empty-state-action"
                onClick={() => {
                  window.dispatchEvent(
                    new CustomEvent('filetree:new-entry', {
                      detail: { type: 'file', parent: '' },
                    })
                  )
                }}
                aria-label="Create new document"
                title="Create new document"
              >
                <SFIcon name="plus" />
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="middle-section">
      <div className={`editor-container ${splitView ? 'split-active' : ''}`}>

        <div
          ref={primaryPaneRef}
          className="pane primary-pane"
          onFocus={() => {
            setActiveDoc(currentDoc)
            setActiveEditor?.(liveEditor)
          }}
          onMouseEnter={() => {
            setActiveDoc(currentDoc)
            setActiveEditor?.(liveEditor)
          }}
          onWheel={() => {
            setActiveDoc(currentDoc)
            setActiveEditor?.(liveEditor)
          }}
          onMouseDown={() => focusEditor(liveEditor)}
          onClick={() => focusEditor(liveEditor)}
          onMouseMove={() => setActiveEditor?.(liveEditor)}
        >
          {dragCaret?.pane === 'primary' ? (
            <div
              className="drag-drop-caret"
              style={{
                left: `${dragCaret.left}px`,
                top: `${dragCaret.top}px`,
                height: `${dragCaret.height}px`,
              }}
            />
          ) : null}
          <div className="pane-scroll">
            {splitView === 'editor' && (
              <div className="pane-header pane-header-centered">
                <span>{currentDoc}</span>
                <button onClick={closePrimary}>×</button>
              </div>
            )}
            {liveEditor ? <EditorContent editor={liveEditor} className="editor" /> : null}
          </div>
          {showWordCountBadge ? (
            <div className="word-count">{formatWordStats(primaryWordStats)}</div>
          ) : null}
        </div>

        {splitView === 'editor' && (
          <div
            ref={secondaryPaneRef}
            className="pane secondary-pane"
            onFocus={() => {
              setActiveDoc(secondaryDoc)
              setActiveEditor?.(liveSecondaryEditor)
            }}
            onMouseEnter={() => {
              setActiveDoc(secondaryDoc)
              setActiveEditor?.(liveSecondaryEditor)
            }}
            onWheel={() => {
              setActiveDoc(secondaryDoc)
              setActiveEditor?.(liveSecondaryEditor)
            }}
            onMouseDown={() => focusEditor(liveSecondaryEditor)}
            onClick={() => focusEditor(liveSecondaryEditor)}
            onMouseMove={() => setActiveEditor?.(liveSecondaryEditor)}
          >
            {dragCaret?.pane === 'secondary' ? (
              <div
                className="drag-drop-caret"
                style={{
                  left: `${dragCaret.left}px`,
                  top: `${dragCaret.top}px`,
                  height: `${dragCaret.height}px`,
                }}
              />
            ) : null}
            <div className="pane-scroll">
              <div className="pane-header split-header pane-header-centered">
                <span>{secondaryDoc}</span>
                <button onClick={closeSecondary}>×</button>
              </div>
              {liveSecondaryEditor ? <EditorContent editor={liveSecondaryEditor} className="editor" /> : null}
            </div>
            {showWordCountBadge ? (
              <div className="word-count">{formatWordStats(secondaryWordStats)}</div>
            ) : null}
          </div>
        )}
        {focusModeOpen ? (
          <FocusModeOverlay
            editor={focusModeEditor}
            onExit={onExitFocusMode}
          />
        ) : null}
      </div>
    </div>
  )
}

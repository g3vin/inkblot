import { useCallback, useEffect, useRef, useState } from 'react'
import { TextSelection } from '@tiptap/pm/state'
import SFIcon from './SFIcon'
import {
  DEFAULT_DICTATION_MODEL_PATH,
  loadDictationModel,
  setupDictationListeners,
  startDictation,
  stopDictation,
} from './dictation'
import {
  clearDictationInlineRange,
  getDictationInlineState,
  setDictationInlineRange,
} from './extensions/DictationInline'

const FINALIZE_DECORATION_MS = 520
const RECENT_FINAL_SUPPRESS_MS = 2600
const INITIAL_BAR_LEVELS = [0.08, 0.12, 0.16, 0.1, 0.14, 0.09]
const BAR_RESPONSE = [0.54, 0.86, 1, 0.72, 0.94, 0.62]
const BAR_KEYS = ['sub', 'low', 'lowMid', 'highMid', 'presence', 'air']
const NON_SPEECH_TAG_PATTERN = /\s*(?:\[(?:blank[\s_-]*audio|silence|inaudible|noise|music|laughter|applause|no speech|background noise)\]|\((?:blank[\s_-]*audio|silence|inaudible|noise|music|laughter|applause|no speech|background noise)\))\s*/gi
const NON_SPEECH_TAG_TEST_PATTERN = /\[(?:blank[\s_-]*audio|silence|inaudible|noise|music|laughter|applause|no speech|background noise)\]|\((?:blank[\s_-]*audio|silence|inaudible|noise|music|laughter|applause|no speech|background noise)\)/i

const getEventText = (payload) => (
  typeof payload?.text === 'string'
    ? payload.text
    : typeof payload === 'string'
      ? payload
      : ''
)

const sanitizeDictationText = (text) => {
  const raw = String(text || '')
  const hadNonSpeechTag = NON_SPEECH_TAG_TEST_PATTERN.test(raw)
  const cleaned = raw
    .replace(NON_SPEECH_TAG_PATTERN, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  if (/[A-Za-z0-9]/.test(cleaned)) return cleaned
  if (!hadNonSpeechTag && /[.,!?;:]/.test(cleaned)) return cleaned
  return ''
}

const getEventLevel = (payload) => {
  const value = payload?.level ?? payload?.rms ?? payload?.volume ?? payload?.audioLevel
  if (!Number.isFinite(value)) return null
  return Math.max(0, Math.min(1, value > 1 ? value / 100 : value))
}

const getComparableDictationText = (text) => (
  String(text || '').replace(/\s+/g, ' ').trim().toLowerCase()
)

export default function DictationControl({ editor }) {
  const editorRef = useRef(editor)
  const modelLoadedRef = useRef(false)
  const finalizeTimerRef = useRef(null)
  const draftRangeRef = useRef(null)
  const draftTextRef = useRef('')
  const recentFinalRef = useRef({ text: '', at: 0 })
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')
  const [barLevels, setBarLevels] = useState(INITIAL_BAR_LEVELS)

  useEffect(() => {
    editorRef.current = editor
  }, [editor])

  useEffect(() => () => {
    if (finalizeTimerRef.current) {
      window.clearTimeout(finalizeTimerRef.current)
    }
  }, [])

  const applyWaveLevel = useCallback((level) => {
    setBarLevels((currentLevels) => currentLevels.map((currentLevel, index) => {
      const targetLevel = Math.min(1, 0.05 + level * BAR_RESPONSE[index])
      return currentLevel * 0.58 + targetLevel * 0.42
    }))
  }, [])

  const getCurrentDraftRange = useCallback((targetEditor) => {
    if (!targetEditor || targetEditor.isDestroyed) return null

    const pluginState = getDictationInlineState(targetEditor)
    const range = pluginState?.status === 'draft'
      ? pluginState.range
      : draftRangeRef.current
    const docSize = targetEditor.state.doc.content.size

    if (
      !range ||
      !Number.isFinite(range.from) ||
      !Number.isFinite(range.to) ||
      range.from < 0 ||
      range.to <= range.from ||
      range.to > docSize
    ) {
      return null
    }

    return range
  }, [])

  const replaceInlineDraft = useCallback((text, decorationStatus = 'draft') => {
    const targetEditor = editorRef.current
    if (!targetEditor || targetEditor.isDestroyed) return null
    if (!text) return getCurrentDraftRange(targetEditor)

    const state = targetEditor.state
    const existingRange = getCurrentDraftRange(targetEditor)
    const selectionRange = {
      from: state.selection.from,
      to: state.selection.to,
    }
    const replaceRange = existingRange || selectionRange
    const tr = state.tr.insertText(text, replaceRange.from, replaceRange.to)
    const nextRange = {
      from: replaceRange.from,
      to: replaceRange.from + text.length,
    }

    tr.setSelection(TextSelection.create(tr.doc, nextRange.to))
    targetEditor.view.dispatch(tr.scrollIntoView())
    targetEditor.view.focus()

    draftRangeRef.current = nextRange
    draftTextRef.current = text
    setDictationInlineRange(targetEditor, nextRange, decorationStatus)
    return nextRange
  }, [getCurrentDraftRange])

  const clearFinalizeTimer = useCallback(() => {
    if (finalizeTimerRef.current) {
      window.clearTimeout(finalizeTimerRef.current)
      finalizeTimerRef.current = null
    }
  }, [])

  const clearInlineDraft = useCallback((deleteText = false) => {
    const targetEditor = editorRef.current
    if (!targetEditor || targetEditor.isDestroyed) return

    clearFinalizeTimer()
    const range = getCurrentDraftRange(targetEditor)
    if (deleteText && range) {
      const tr = targetEditor.state.tr.delete(range.from, range.to)
      targetEditor.view.dispatch(tr)
    }

    clearDictationInlineRange(targetEditor)
    draftRangeRef.current = null
    draftTextRef.current = ''
  }, [clearFinalizeTimer, getCurrentDraftRange])

  const isRecentFinalRepeat = useCallback((text) => {
    const comparableText = getComparableDictationText(text)
    const recentFinal = recentFinalRef.current
    if (!comparableText || comparableText !== recentFinal.text) return false

    const now = performance.now()
    return now - recentFinal.at <= RECENT_FINAL_SUPPRESS_MS
  }, [])

  const rememberFinalText = useCallback((text) => {
    const comparableText = getComparableDictationText(text)
    if (!comparableText) return

    recentFinalRef.current = {
      text: comparableText,
      at: performance.now(),
    }
  }, [])

  const finalizeInlineDraft = useCallback((text) => {
    const cleaned = sanitizeDictationText(text)
    const targetEditor = editorRef.current
    if (!targetEditor || targetEditor.isDestroyed) return

    clearFinalizeTimer()

    if (!cleaned) {
      clearInlineDraft(true)
      return
    }

    if (isRecentFinalRepeat(cleaned)) {
      const currentDraft = getCurrentDraftRange(targetEditor)
      if (currentDraft && getComparableDictationText(draftTextRef.current) === getComparableDictationText(cleaned)) {
        clearInlineDraft(true)
      }
      return
    }

    const finalizedText = `${cleaned} `
    const nextRange = replaceInlineDraft(finalizedText, 'finalizing')
    if (!nextRange) return

    rememberFinalText(cleaned)
    setDictationInlineRange(targetEditor, nextRange, 'finalizing')
    draftRangeRef.current = null
    draftTextRef.current = ''
    finalizeTimerRef.current = window.setTimeout(() => {
      clearDictationInlineRange(targetEditor)
      finalizeTimerRef.current = null
    }, FINALIZE_DECORATION_MS)
  }, [
    clearFinalizeTimer,
    clearInlineDraft,
    getCurrentDraftRange,
    isRecentFinalRepeat,
    rememberFinalText,
    replaceInlineDraft,
  ])

  const settleCurrentDraft = useCallback(() => {
    const targetEditor = editorRef.current
    if (!targetEditor || targetEditor.isDestroyed) return

    const range = getCurrentDraftRange(targetEditor)
    if (!range) return

    clearFinalizeTimer()
    setDictationInlineRange(targetEditor, range, 'finalizing')
    draftRangeRef.current = null
    draftTextRef.current = ''
    finalizeTimerRef.current = window.setTimeout(() => {
      clearDictationInlineRange(targetEditor)
      finalizeTimerRef.current = null
    }, FINALIZE_DECORATION_MS)
  }, [clearFinalizeTimer, getCurrentDraftRange])

  useEffect(() => {
    let disposed = false
    let cleanup = null

    setupDictationListeners({
      onStarted: () => {
        setStatus('listening')
        setError('')
      },
      onPartial: (payload) => {
        const text = sanitizeDictationText(getEventText(payload))
        setStatus('listening')
        setError('')
        if (text) {
          if (isRecentFinalRepeat(text)) {
            const targetEditor = editorRef.current
            const currentDraft = getCurrentDraftRange(targetEditor)
            if (
              currentDraft &&
              getComparableDictationText(draftTextRef.current) === getComparableDictationText(text)
            ) {
              clearInlineDraft(true)
            }
            return
          }

          clearFinalizeTimer()
          replaceInlineDraft(text, 'draft')
        }
      },
      onFinal: (payload) => {
        finalizeInlineDraft(getEventText(payload))
      },
      onLevel: (payload) => {
        const level = getEventLevel(payload)
        if (level !== null) {
          applyWaveLevel(level)
        }
      },
      onStopped: () => {
        settleCurrentDraft()
        setStatus('idle')
        setBarLevels(INITIAL_BAR_LEVELS)
      },
      onError: (payload) => {
        setStatus('error')
        setError(payload?.message || String(payload || 'Dictation failed'))
      },
    }).then((unlisten) => {
      if (disposed) {
        unlisten()
        return
      }
      cleanup = unlisten
    }).catch((err) => {
      setStatus('error')
      setError(err?.message || String(err))
    })

    return () => {
      disposed = true
      cleanup?.()
    }
  }, [applyWaveLevel, clearFinalizeTimer, clearInlineDraft, finalizeInlineDraft, getCurrentDraftRange, isRecentFinalRepeat, replaceInlineDraft, settleCurrentDraft])

  const start = useCallback(async () => {
    setStatus('loading')
    setError('')

    try {
      if (!modelLoadedRef.current) {
        await loadDictationModel(DEFAULT_DICTATION_MODEL_PATH)
        modelLoadedRef.current = true
      }

      await startDictation()
      setStatus('listening')
    } catch (err) {
      setStatus('error')
      setError(err?.message || String(err))
    }
  }, [])

  const stop = useCallback(async () => {
    try {
      await stopDictation()
    } catch (err) {
      setStatus('error')
      setError(err?.message || String(err))
    } finally {
      setStatus('idle')
      setBarLevels(INITIAL_BAR_LEVELS)
    }
  }, [])

  const toggle = useCallback(() => {
    if (status === 'listening' || status === 'loading') {
      void stop()
      return
    }
    void start()
  }, [start, status, stop])

  const live = status === 'listening'
  const loading = status === 'loading'
  const active = live || loading
  const buttonTitle = error || (live ? 'Stop dictation' : 'Start dictation')

  return (
    <div className="dictation-control">
      <button
        type="button"
        className={`dictation-mic-btn${live ? ' active' : ''}${loading ? ' loading' : ''}${status === 'error' ? ' error' : ''}`}
        onClick={toggle}
        aria-label={live ? 'Stop dictation' : 'Start dictation'}
        title={buttonTitle}
      >
        <SFIcon name="mic" size={16} />
        {active ? (
          <span className="dictation-button-wave" aria-hidden="true">
            {barLevels.slice(0, 4).map((barLevel, index) => (
              <span
                key={BAR_KEYS[index]}
                className="dictation-button-wave-bar"
                style={{
                  '--bar-height': `${4 + barLevel * 12}px`,
                }}
              />
            ))}
          </span>
        ) : null}
      </button>
    </div>
  )
}

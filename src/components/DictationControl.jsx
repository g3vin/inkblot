/**
 * DictationControl.jsx — toolbar button + popover for voice dictation.
 *
 * Talks to the Rust whisper.cpp backend through lib/dictation: loads the
 * model on first use, streams partial transcripts into the editor as a
 * draft range (styled by the DictationInline extension), and commits text
 * on final transcripts, filtering out non-speech tags like [silence].
 * Includes a live mic level-meter driven by dictation://level events.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { TextSelection } from '@tiptap/pm/state'
import SFIcon from './SFIcon'
import {
  loadDictationModel,
  setupDictationListeners,
  startDictation,
  stopDictation,
} from '../lib/dictation'
import {
  clearDictationInlineRange,
  getDictationInlineState,
  setDictationInlineRange,
  withDictationInlineRange,
} from '../extensions/DictationInline'

const FINALIZE_DECORATION_MS = 520
const RECENT_FINAL_SUPPRESS_MS = 2600
// `dictation://stopped` only means the mic closed: whisper is still chewing on
// the audio already captured, so partials and a final for the tail arrive
// after it. Keep the draft range open through a short drain so those land in
// place instead of being re-inserted at the cursor as a duplicate.
const DRAIN_QUIET_MS = 1800
const DRAIN_MAX_MS = 8000
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
  // 'idle' | 'live' | 'draining' — which transcripts we still accept.
  const phaseRef = useRef('idle')
  const sessionIdRef = useRef(null)
  const drainTimerRef = useRef(null)
  const drainDeadlineRef = useRef(0)
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
    if (drainTimerRef.current) {
      window.clearTimeout(drainTimerRef.current)
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
    const nextRange = {
      from: replaceRange.from,
      to: replaceRange.from + text.length,
    }

    // Rewrite only the part of the draft that actually changed. Whisper
    // revisions usually just extend the tail, and leaving the untouched text
    // alone keeps ProseMirror from rebuilding the whole decorated span.
    const currentText = replaceRange.to > replaceRange.from
      ? state.doc.textBetween(replaceRange.from, replaceRange.to, '\n', '\n')
      : ''
    const canDiff = currentText.length === replaceRange.to - replaceRange.from

    if (canDiff && currentText === text) {
      draftRangeRef.current = nextRange
      draftTextRef.current = text
      setDictationInlineRange(targetEditor, nextRange, decorationStatus)
      return nextRange
    }

    let changedFrom = replaceRange.from
    let changedTo = replaceRange.to
    let insertion = text

    if (canDiff) {
      const maxShared = Math.min(currentText.length, text.length)

      let prefix = 0
      while (prefix < maxShared && currentText[prefix] === text[prefix]) prefix += 1

      let suffix = 0
      while (
        suffix < maxShared - prefix &&
        currentText[currentText.length - 1 - suffix] === text[text.length - 1 - suffix]
      ) suffix += 1

      changedFrom = replaceRange.from + prefix
      changedTo = replaceRange.to - suffix
      insertion = text.slice(prefix, text.length - suffix)
    }

    const tr = insertion
      ? state.tr.insertText(insertion, changedFrom, changedTo)
      : state.tr.delete(changedFrom, changedTo)

    tr.setSelection(TextSelection.create(tr.doc, nextRange.to))
    // Same transaction as the text edit — see withDictationInlineRange.
    withDictationInlineRange(tr, nextRange, decorationStatus)
    targetEditor.view.dispatch(tr.scrollIntoView())
    if (!targetEditor.view.hasFocus()) {
      targetEditor.view.focus()
    }

    draftRangeRef.current = nextRange
    draftTextRef.current = text
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

  // Chunks are transcribed concurrently, so a partial can land after the final
  // that supersedes it. A stale partial is always a prefix of that final, so
  // drop it instead of letting it re-open a draft at the cursor.
  const isSupersededByRecentFinal = useCallback((text) => {
    const comparableText = getComparableDictationText(text)
    const recentFinal = recentFinalRef.current
    if (!comparableText || !recentFinal.text) return false
    if (!recentFinal.text.startsWith(comparableText)) return false

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

  const clearDrainTimer = useCallback(() => {
    if (drainTimerRef.current) {
      window.clearTimeout(drainTimerRef.current)
      drainTimerRef.current = null
    }
  }, [])

  const endDrain = useCallback(() => {
    clearDrainTimer()
    drainDeadlineRef.current = 0
    phaseRef.current = 'idle'
    sessionIdRef.current = null
    settleCurrentDraft()
    setStatus((current) => (current === 'finishing' ? 'idle' : current))
  }, [clearDrainTimer, settleCurrentDraft])

  // Each late transcript pushes the drain out a little, up to a hard cap, so a
  // slow tail still lands but a dead session cannot keep the draft open.
  const scheduleDrainEnd = useCallback(() => {
    clearDrainTimer()

    const now = performance.now()
    if (!drainDeadlineRef.current) {
      drainDeadlineRef.current = now + DRAIN_MAX_MS
    }

    const wait = Math.max(0, Math.min(DRAIN_QUIET_MS, drainDeadlineRef.current - now))
    drainTimerRef.current = window.setTimeout(() => {
      drainTimerRef.current = null
      endDrain()
    }, wait)
  }, [clearDrainTimer, endDrain])

  const beginDrain = useCallback(() => {
    if (phaseRef.current === 'idle') return
    if (phaseRef.current !== 'draining') {
      phaseRef.current = 'draining'
      drainDeadlineRef.current = performance.now() + DRAIN_MAX_MS
    }
    scheduleDrainEnd()
    setStatus((current) => (current === 'error' ? current : 'finishing'))
  }, [scheduleDrainEnd])

  const acceptsTranscript = useCallback((payload) => {
    if (phaseRef.current === 'idle') return false

    const eventSessionId = payload?.sessionId
    const activeSessionId = sessionIdRef.current
    return !eventSessionId || !activeSessionId || eventSessionId === activeSessionId
  }, [])

  useEffect(() => {
    let disposed = false
    let cleanup = null

    setupDictationListeners({
      onStarted: (payload) => {
        if (payload?.sessionId) sessionIdRef.current = payload.sessionId
        phaseRef.current = 'live'
        clearDrainTimer()
        drainDeadlineRef.current = 0
        setStatus('listening')
        setError('')
      },
      onPartial: (payload) => {
        if (!acceptsTranscript(payload)) return

        const text = sanitizeDictationText(getEventText(payload))

        if (phaseRef.current === 'draining') {
          scheduleDrainEnd()
        } else {
          setStatus('listening')
          setError('')
        }

        if (text) {
          if (isSupersededByRecentFinal(text)) {
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
        if (!acceptsTranscript(payload)) return

        if (phaseRef.current === 'draining') {
          scheduleDrainEnd()
        }

        finalizeInlineDraft(getEventText(payload))
      },
      onLevel: (payload) => {
        const level = getEventLevel(payload)
        if (level !== null) {
          applyWaveLevel(level)
        }
      },
      onStopped: (payload) => {
        setBarLevels(INITIAL_BAR_LEVELS)

        if (!acceptsTranscript(payload)) return

        // The tail transcript is still coming — hold the draft open for it.
        beginDrain()
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
  }, [
    acceptsTranscript,
    applyWaveLevel,
    beginDrain,
    clearDrainTimer,
    clearFinalizeTimer,
    clearInlineDraft,
    finalizeInlineDraft,
    getCurrentDraftRange,
    isSupersededByRecentFinal,
    replaceInlineDraft,
    scheduleDrainEnd,
  ])

  const start = useCallback(async () => {
    // Settle whatever the previous session left draining before reusing the refs.
    endDrain()
    recentFinalRef.current = { text: '', at: 0 }
    setStatus('loading')
    setError('')

    try {
      if (!modelLoadedRef.current) {
        await loadDictationModel()
        modelLoadedRef.current = true
      }

      phaseRef.current = 'live'
      const sessionId = await startDictation()
      if (typeof sessionId === 'string' && sessionId) {
        sessionIdRef.current = sessionId
      }
      setStatus((current) => (current === 'loading' ? 'listening' : current))
    } catch (err) {
      phaseRef.current = 'idle'
      sessionIdRef.current = null
      setStatus('error')
      setError(err?.message || String(err))
    }
  }, [endDrain])

  const stop = useCallback(async () => {
    const wasRunning = phaseRef.current !== 'idle'
    beginDrain()

    try {
      await stopDictation()
    } catch (err) {
      endDrain()
      if (wasRunning) {
        setStatus('error')
        setError(err?.message || String(err))
      } else {
        setStatus('idle')
      }
    } finally {
      setBarLevels(INITIAL_BAR_LEVELS)
    }
  }, [beginDrain, endDrain])

  const toggle = useCallback(() => {
    if (status === 'listening' || status === 'loading') {
      void stop()
      return
    }
    void start()
  }, [start, status, stop])

  const live = status === 'listening'
  const loading = status === 'loading'
  const finishing = status === 'finishing'
  const active = live || loading || finishing
  const buttonTitle = error || (
    live
      ? 'Stop dictation'
      : finishing
        ? 'Finishing transcription…'
        : 'Start dictation'
  )

  return (
    <div className="dictation-control">
      <button
        type="button"
        className={`dictation-mic-btn${live ? ' active' : ''}${loading ? ' loading' : ''}${finishing ? ' finishing' : ''}${status === 'error' ? ' error' : ''}`}
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

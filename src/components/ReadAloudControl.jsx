/**
 * ReadAloudControl.jsx — toolbar button + popover for read-aloud playback. In the card's
 * toolbar the popover is one compact row in place (DESIGN.md §6): read or stop, the level
 * meter, and the voice, which swaps the row for the voices to choose from.
 *
 * Drives the Pocket TTS pipeline in lib/readAloud: builds chunks from the
 * editor text (or selection), generates audio ahead of playback
 * (READ_ALOUD_PREFETCH_AHEAD), plays chunks back-to-back while highlighting
 * the spoken word via the ReadAloudHighlight extension, and animates a
 * level-meter visualization. Voice choice persists to the preference store.
 *
 * The model is downloaded once, so until it is the row offers the download in place
 * of the player. Where there is no native backend (a plain browser), or it stops
 * answering, it reads with the system speechSynthesis voices instead.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from '../ui/Icon.jsx'
import Popover from '../ui/Popover.jsx'
import MenuRow from './toolbar/MenuRow'
import { useCommands } from '../lib/commands'
import { clearReadAloudHighlight, setReadAloudHighlight } from '../extensions/ReadAloudHighlight'
import {
  DEFAULT_READ_ALOUD_VOICE,
  READ_ALOUD_VOICES,
  buildReadAloudChunks,
  downloadSpeechModel,
  generateReadAloudAudio,
  getReadableEditorPayload,
  getSpeechModelStatus,
  isModelNotInstalledError,
  prewarmReadAloud,
  shouldUseSystemSpeech,
} from '../lib/readAloud'
import { getPreference, setPreference } from '../lib/preferences'
import { documentSurface, editorRegistry } from '../bridge'

const READ_ALOUD_VOICE_STORAGE_KEY = 'inkblot:read-aloud-voice'
const INITIAL_READ_ALOUD_LEVELS = [0.08, 0.12, 0.16, 0.1, 0.14, 0.09]
const READ_ALOUD_BAR_RESPONSE = [0.56, 0.9, 1, 0.76, 0.94, 0.62]
const READ_ALOUD_BAR_KEYS = ['sub', 'low', 'lowMid', 'highMid', 'presence', 'air']
const READ_ALOUD_PREFETCH_AHEAD = 2
const WORD_HIGHLIGHT_LAG_MS = 180
// The download is the four graphs and the voices; shown before it starts.
const SPEECH_DOWNLOAD_SIZE = 'About 440 MB'

const formatDownloadProgress = (progress) => {
  if (!progress) return 'Starting…'
  const percent = progress.total > 0 ? ` · ${Math.round((progress.received / progress.total) * 100)}%` : ''
  return `${progress.index} of ${progress.count}${percent}`
}

/** The system voice to fall back on: the best-known English ones first. */
const pickSystemVoice = () => {
  const synth = window.speechSynthesis
  if (!synth?.getVoices) return null

  const voices = synth.getVoices()
  const english = voices.filter((voice) => voice.lang?.startsWith('en'))
  const preferred = ['ava', 'samantha', 'daniel', 'serena', 'allison', 'karen']
  return preferred.map((hint) => english.find((voice) => voice.name.toLowerCase().includes(hint))).find(Boolean)
    || english.find((voice) => voice.default) || english[0] || voices[0] || null
}

const getLocalWordOffsets = (text, words) => {
  let cursor = 0

  return (words || []).map((word) => {
    const localStart = text.indexOf(word.text, cursor)
    if (localStart === -1) return null

    cursor = localStart + word.text.length
    return {
      ...word,
      localStart,
      localEnd: cursor,
    }
  }).filter(Boolean)
}

const findWordForSpeechOffset = (words, charIndex) => {
  if (!words?.length || !Number.isFinite(charIndex)) return null

  return words.find((word) => charIndex >= word.localStart && charIndex < word.localEnd)
    || words.find((word) => word.localStart >= charIndex)
    || null
}

const getWordSpeechWeight = (word) => {
  const cleanLength = word.text.replace(/[^A-Za-z0-9]/g, '').length
  const pauseWeight = /[.!?]$/.test(word.text)
    ? 5
    : /[,;:]$/.test(word.text)
      ? 2
      : 0

  return Math.max(1, cleanLength || word.text.length) + pauseWeight
}

/** The wire shape: text and words, without the local-only `originalSelection`. */
const toWirePayload = ({ text, words }) => ({ text, words })

/**
 * Answer `getReadAloudPayload` for whichever editor the shell names.
 *
 * Resolved through the registry rather than this control's `editor` prop: the shell
 * may name a pane that is not the toolbar's. `null` is the protocol's "no editor",
 * which the bridge turns into a `noEditor` reply.
 */
const answerReadAloudPayload = ({ target, selectionOnly }) => {
  const resolved = target ? editorRegistry.resolve(target) : editorRegistry.active()
  if (!resolved?.editor || resolved.editor.isDestroyed) return null
  const payload = getReadableEditorPayload(resolved.editor, {
    scope: selectionOnly ? 'selection' : 'document',
  })
  return { docPath: resolved.docPath ?? '', payload: toWirePayload(payload) }
}

export default function ReadAloudControl({ editor }) {
  const buttonRef = useRef(null)
  const audioContextRef = useRef(null)
  const sourceRef = useRef(null)
  const playbackResolveRef = useRef(null)
  const requestIdRef = useRef(0)
  const highlightTimersRef = useRef([])
  const waveformTimerRef = useRef(null)
  const activeReadChunksRef = useRef(null)
  const systemUtteranceRef = useRef(null)
  const useSystemSpeechRef = useRef(false)
  const [open, setOpen] = useState(false)
  // Choosing a voice: the row shows the voices in place of the player.
  const [choosingVoice, setChoosingVoice] = useState(false)
  const [voice, setVoice] = useState(() => {
    const storedVoice = getPreference(READ_ALOUD_VOICE_STORAGE_KEY)
    return READ_ALOUD_VOICES.some((option) => option.id === storedVoice)
      ? storedVoice
      : DEFAULT_READ_ALOUD_VOICE
  })
  const [status, setStatus] = useState('idle')
  const [message, setMessage] = useState('')
  // 'unknown' until asked, then 'missing', 'downloading' or 'ready'. 'unavailable'
  // where there is no native backend, which reads with the system voices.
  const [modelState, setModelState] = useState('unknown')
  const [downloadProgress, setDownloadProgress] = useState(null)
  const [levels, setLevels] = useState(INITIAL_READ_ALOUD_LEVELS)
  useEffect(() => {
    setPreference(READ_ALOUD_VOICE_STORAGE_KEY, voice)
  }, [voice])

  useEffect(() => documentSurface.onRequest('getReadAloudPayload', answerReadAloudPayload), [])

  useEffect(() => {
    if (!open || modelState !== 'unknown') return undefined

    let cancelled = false
    getSpeechModelStatus()
      .then(({ installed }) => {
        if (!cancelled) setModelState(installed ? 'ready' : 'missing')
      })
      .catch((error) => {
        if (cancelled) return
        if (shouldUseSystemSpeech(error)) {
          useSystemSpeechRef.current = true
          setModelState('unavailable')
        } else {
          setMessage(error?.message || String(error))
        }
      })

    return () => {
      cancelled = true
    }
  }, [open, modelState])

  useEffect(() => {
    if (!open || modelState !== 'ready' || status === 'loading' || status === 'playing') return undefined

    let cancelled = false
    prewarmReadAloud({ voice }).catch((error) => {
      if (cancelled) return
      if (isModelNotInstalledError(error)) setModelState('missing')
      else if (!shouldUseSystemSpeech(error)) setMessage(error?.message || String(error))
    })

    return () => {
      cancelled = true
    }
  }, [open, modelState, status, voice])

  const downloadVoices = useCallback(async () => {
    setModelState('downloading')
    setDownloadProgress(null)
    setStatus('idle')
    setMessage('')
    try {
      await downloadSpeechModel(setDownloadProgress)
      setModelState('ready')
    } catch (error) {
      setModelState('missing')
      setStatus('error')
      setMessage(`Couldn’t download the voices: ${error?.message || error}`)
    } finally {
      setDownloadProgress(null)
    }
  }, [])

  const clearWordHighlight = useCallback(() => {
    highlightTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    highlightTimersRef.current = []
    clearReadAloudHighlight(editor)
  }, [editor])

  const cleanupAudio = useCallback(() => {
    if (systemUtteranceRef.current) {
      systemUtteranceRef.current.onboundary = null
      systemUtteranceRef.current.onend = null
      systemUtteranceRef.current.onerror = null
      systemUtteranceRef.current = null
      window.speechSynthesis?.cancel?.()
    }

    if (sourceRef.current) {
      sourceRef.current.onended = null
      try {
        sourceRef.current.stop()
      } catch {
        // The source may already be stopped; either way, it is no longer active.
      }
      sourceRef.current.disconnect()
      sourceRef.current = null
    }

    if (playbackResolveRef.current) {
      playbackResolveRef.current()
      playbackResolveRef.current = null
    }

    if (waveformTimerRef.current) {
      window.clearInterval(waveformTimerRef.current)
      waveformTimerRef.current = null
    }

    setLevels(INITIAL_READ_ALOUD_LEVELS)
  }, [])

  useEffect(() => () => {
    activeReadChunksRef.current = null
    cleanupAudio()
    clearWordHighlight(false)
    audioContextRef.current?.close?.()
  }, [cleanupAudio, clearWordHighlight])

  useEffect(() => {
    if (!editor || editor.isDestroyed) return undefined

    const mapActiveReadRanges = ({ transaction }) => {
      const chunks = activeReadChunksRef.current
      if (!chunks || !transaction.docChanged) return

      chunks.forEach((chunk) => {
        chunk.words?.forEach((word) => {
          if (word.deleted) return

          const from = transaction.mapping.mapResult(word.from, 1)
          const to = transaction.mapping.mapResult(word.to, -1)

          word.from = from.pos
          word.to = to.pos
          word.deleted = from.deletedAcross || to.deletedAcross || word.from >= word.to
        })
      })
    }

    editor.on('transaction', mapActiveReadRanges)
    return () => editor.off('transaction', mapActiveReadRanges)
  }, [editor])

  const getAudioContext = useCallback(async () => {
    if (!audioContextRef.current) {
      const AudioContextConstructor = window.AudioContext || window.webkitAudioContext
      if (!AudioContextConstructor) {
        throw new Error('Audio playback is not available in this webview.')
      }

      audioContextRef.current = new AudioContextConstructor()
    }

    if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume()
    }

    return audioContextRef.current
  }, [])

  const scheduleWordHighlight = useCallback((words, durationMs) => {
    clearWordHighlight(false)
    if (!words?.length || !editor || editor.isDestroyed) return

    const totalWeight = words.reduce((sum, word) => sum + getWordSpeechWeight(word), 0)
    let elapsedWeight = 0

    words.forEach((word, index) => {
      const rawDelay = (elapsedWeight / totalWeight) * durationMs
      const delay = index === 0
        ? 0
        : Math.min(Math.max(0, durationMs - 90), rawDelay + WORD_HIGHLIGHT_LAG_MS)
      const timer = window.setTimeout(() => {
        if (!editor || editor.isDestroyed) return
        if (word.deleted) return
        setReadAloudHighlight(editor, { from: word.from, to: word.to })
      }, delay)

      highlightTimersRef.current.push(timer)
      elapsedWeight += getWordSpeechWeight(word)
    })
  }, [clearWordHighlight, editor])

  const startPlaybackWaveform = useCallback((samples, sampleRate, audioContext, startedAt, durationSeconds, requestId) => {
    if (waveformTimerRef.current) {
      window.clearInterval(waveformTimerRef.current)
    }

    waveformTimerRef.current = window.setInterval(() => {
      if (requestIdRef.current !== requestId) return

      const elapsedSeconds = audioContext.currentTime - startedAt
      const centerSample = Math.max(0, Math.min(samples.length - 1, Math.floor(elapsedSeconds * sampleRate)))
      const startSample = Math.max(0, centerSample - 720)
      const endSample = Math.min(samples.length, centerSample + 720)
      let sum = 0

      for (let index = startSample; index < endSample; index += 1) {
        sum += samples[index] * samples[index]
      }

      const rms = endSample > startSample ? Math.sqrt(sum / (endSample - startSample)) : 0
      const progressFalloff = elapsedSeconds > durationSeconds ? 0 : 1
      const level = Math.min(1, Math.max(0, rms * 8.5) * progressFalloff)

      setLevels((currentLevels) => currentLevels.map((currentLevel, index) => {
        const targetLevel = Math.min(1, 0.05 + level * READ_ALOUD_BAR_RESPONSE[index])
        return currentLevel * 0.58 + targetLevel * 0.42
      }))
    }, 70)
  }, [])

  const playAudioChunk = useCallback(async (audio, requestId, words) => {
    if (!(audio?.audio instanceof Float32Array) || !audio.audio.length) {
      throw new Error('The voice returned no audio.')
    }

    const audioContext = await getAudioContext()
    if (requestIdRef.current !== requestId) return

    const buffer = audioContext.createBuffer(1, audio.audio.length, audio.sampling_rate)
    buffer.copyToChannel(audio.audio, 0)

    const source = audioContext.createBufferSource()
    source.buffer = buffer
    source.connect(audioContext.destination)
    sourceRef.current = source

    await audioContext.resume()
    const durationSeconds = audio.audio.length / audio.sampling_rate

    await new Promise((resolve) => {
      playbackResolveRef.current = resolve

      source.onended = () => {
        source.onended = null
        if (sourceRef.current === source) {
          source.disconnect()
          sourceRef.current = null
        }
        if (playbackResolveRef.current === resolve) {
          playbackResolveRef.current = null
        }
        resolve()
      }

      const startedAt = audioContext.currentTime
      scheduleWordHighlight(words, durationSeconds * 1000)
      startPlaybackWaveform(audio.audio, audio.sampling_rate, audioContext, startedAt, durationSeconds, requestId)
      source.start()
    })
  }, [getAudioContext, scheduleWordHighlight, startPlaybackWaveform])

  const startSystemSpeechWaveform = useCallback((requestId) => {
    if (waveformTimerRef.current) {
      window.clearInterval(waveformTimerRef.current)
    }

    let tick = 0
    waveformTimerRef.current = window.setInterval(() => {
      if (requestIdRef.current !== requestId) return

      tick += 1
      setLevels((currentLevels) => currentLevels.map((currentLevel, index) => {
        const pulse = 0.18 + Math.abs(Math.sin((tick + index * 1.7) * 0.38)) * READ_ALOUD_BAR_RESPONSE[index]
        const targetLevel = Math.min(1, pulse)
        return currentLevel * 0.66 + targetLevel * 0.34
      }))
    }, 80)
  }, [])

  const playSystemSpeechChunk = useCallback(async (text, requestId, words) => {
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
      throw new Error('On-device speech stopped, and there is no system voice to use instead.')
    }

    cleanupAudio()
    clearWordHighlight(false)

    const utterance = new window.SpeechSynthesisUtterance(text)
    const systemVoice = pickSystemVoice()
    if (systemVoice) utterance.voice = systemVoice
    utterance.rate = 1
    utterance.pitch = 1
    utterance.volume = 1
    systemUtteranceRef.current = utterance

    const localWords = getLocalWordOffsets(text, words)

    await new Promise((resolve, reject) => {
      utterance.onstart = () => {
        if (requestIdRef.current !== requestId) return
        startSystemSpeechWaveform(requestId)
      }

      utterance.onboundary = (event) => {
        if (requestIdRef.current !== requestId || !editor || editor.isDestroyed) return
        const word = findWordForSpeechOffset(localWords, event.charIndex)
        if (word) setReadAloudHighlight(editor, { from: word.from, to: word.to })
      }

      utterance.onend = () => {
        if (systemUtteranceRef.current === utterance) {
          systemUtteranceRef.current = null
        }
        resolve()
      }

      utterance.onerror = (event) => {
        if (event.error === 'interrupted' || event.error === 'canceled') {
          resolve()
          return
        }

        reject(new Error(`System speech failed: ${event.error || 'unknown error'}`))
      }

      window.speechSynthesis.cancel()
      window.speechSynthesis.speak(utterance)
    })
  }, [cleanupAudio, clearWordHighlight, editor, startSystemSpeechWaveform])

  const stop = useCallback(() => {
    requestIdRef.current += 1
    activeReadChunksRef.current = null
    cleanupAudio()
    clearWordHighlight()
    setStatus('idle')
    setMessage('')
  }, [cleanupAudio, clearWordHighlight])

  const read = useCallback(async () => {
    if (modelState === 'missing' || modelState === 'downloading') {
      setOpen(true)
      return
    }

    const payload = getReadableEditorPayload(editor)
    if (!payload.text) {
      setStatus('error')
      setMessage('Select text or write something first.')
      setOpen(true)
      return
    }

    const chunks = buildReadAloudChunks(payload)
    if (!chunks.length) {
      setStatus('error')
      setMessage('Nothing readable found.')
      setOpen(true)
      return
    }

    documentSurface.publishReadAloudPayload({
      docPath: editorRegistry.active()?.docPath ?? '',
      payload: toWirePayload(payload),
    })

    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    activeReadChunksRef.current = chunks
    cleanupAudio()
    clearWordHighlight(false)
    setStatus('loading')
    setMessage('Getting the voice ready…')
    setOpen(true)

    try {
      const audioPromises = new Map()
      const queueAudioChunk = (index) => {
        if (index >= chunks.length || audioPromises.has(index) || useSystemSpeechRef.current) {
          return
        }

        const shouldReportProgress = index === 0
        const audioPromise = generateReadAloudAudio(chunks[index].text, {
          voice,
          onPhase: (label) => {
            if (!shouldReportProgress || requestIdRef.current !== requestId) return
            setMessage(label)
          },
        })

        audioPromise.catch(() => {})
        audioPromises.set(index, audioPromise)
      }

      const queueAudioAhead = (index) => {
        const finalIndex = Math.min(chunks.length - 1, index + READ_ALOUD_PREFETCH_AHEAD)
        for (let nextIndex = index; nextIndex <= finalIndex; nextIndex += 1) {
          queueAudioChunk(nextIndex)
        }
      }

      queueAudioAhead(0)

      for (let index = 0; index < chunks.length; index += 1) {
        if (requestIdRef.current !== requestId) return

        setStatus('loading')
        setMessage(index === 0 ? 'Getting the voice ready…' : `Preparing ${index + 1} of ${chunks.length}`)
        queueAudioAhead(index)

        if (useSystemSpeechRef.current) {
          setStatus('playing')
          setMessage(chunks.length === 1 ? 'Reading with the system voice' : `System voice ${index + 1} of ${chunks.length}`)
          await playSystemSpeechChunk(chunks[index].text, requestId, chunks[index].words)
          continue
        }

        try {
          const audio = await audioPromises.get(index)

          if (requestIdRef.current !== requestId) return

          setStatus('playing')
          setMessage(chunks.length === 1 ? 'Reading aloud' : `Reading ${index + 1} of ${chunks.length}`)
          queueAudioAhead(index + 1)
          await playAudioChunk(audio, requestId, chunks[index].words)
        } catch (error) {
          if (!shouldUseSystemSpeech(error)) throw error
          if (requestIdRef.current !== requestId) return

          useSystemSpeechRef.current = true
          setStatus('playing')
          setMessage('Reading with the system voice')
          await playSystemSpeechChunk(chunks[index].text, requestId, chunks[index].words)
        }
      }

      if (requestIdRef.current !== requestId) return
      activeReadChunksRef.current = null
      cleanupAudio()
      clearWordHighlight()
      setStatus('idle')
      setMessage('')
    } catch (error) {
      if (requestIdRef.current !== requestId) return
      activeReadChunksRef.current = null
      cleanupAudio()
      clearWordHighlight()
      if (isModelNotInstalledError(error)) {
        setModelState('missing')
        setStatus('idle')
        setMessage('')
        return
      }
      setStatus('error')
      setMessage(error?.message || String(error))
    }
  }, [cleanupAudio, clearWordHighlight, editor, modelState, playAudioChunk, playSystemSpeechChunk, voice])

  const active = status === 'loading' || status === 'playing'

  useCommands(() => [{
    id: 'speech.read-aloud',
    section: 'Writing',
    title: active ? 'Stop reading aloud' : 'Read aloud',
    icon: 'read-aloud',
    keywords: ['speak', 'listen', 'voice', 'text to speech'],
    when: () => Boolean(editor),
    run: active ? stop : read,
  }], [active, editor, read, stop])
  const selectedVoice = READ_ALOUD_VOICES.find((option) => option.id === voice)
  const voiceItems = READ_ALOUD_VOICES.map((option) => ({
    text: option.name,
    checked: option.id === voice,
    action: () => setVoice(option.id),
  }))
  const needsDownload = modelState === 'missing' || modelState === 'downloading'
  const statusText = modelState === 'downloading'
    ? formatDownloadProgress(downloadProgress)
    : message || (modelState === 'missing' ? SPEECH_DOWNLOAD_SIZE : active ? 'Preparing…' : '')
  const close = () => { setOpen(false); setChoosingVoice(false) }
  const popover = (
    <Popover open={open} anchorRef={buttonRef} onClose={close} align="end" eyebrow="Read aloud" className={`read-aloud-popover ${status}`}>
      {choosingVoice ? (
        <MenuRow label="Read aloud voice" items={voiceItems} onDone={() => setChoosingVoice(false)} className="tb-strip" />
      ) : needsDownload ? (
        <div className="toolbar-group read-aloud-row">
          <button
            type="button"
            className="read-aloud-download"
            disabled={modelState === 'downloading'}
            title={modelState === 'downloading' ? 'Downloading the voices' : 'Download the voices Read Aloud uses, once. They stay on this device.'}
            onClick={downloadVoices}
          >
            <Icon name="download" />
            <span className="tb-text">Download voices</span>
          </button>
          <span className={`ib-meta read-aloud-status${status === 'error' ? ' is-error' : ''}`} role="status" aria-live="polite" title={statusText || undefined}>
            {statusText}
          </span>
        </div>
      ) : (
        <div className="toolbar-group read-aloud-row">
          <button
            type="button"
            className={active ? 'active' : undefined}
            aria-label={active ? 'Stop reading' : 'Read aloud'}
            title={active ? 'Stop' : 'Read the selection, or the whole document'}
            onClick={active ? stop : read}
          >
            <Icon name={active ? 'stop' : 'play'} active={active} />
          </button>
          <div className="read-aloud-wave" aria-hidden="true">
            {levels.map((level, index) => (
              <span
                key={READ_ALOUD_BAR_KEYS[index]}
                className="read-aloud-wave-bar"
                style={{ '--bar-height': `${3 + level * 14}px` }}
              />
            ))}
          </div>
          <button
            type="button"
            className="read-aloud-voice"
            disabled={active}
            aria-label={`Voice: ${selectedVoice?.name ?? 'choose one'}`}
            title={selectedVoice ? `Voice: ${selectedVoice.name}` : 'Choose a voice'}
            onClick={() => setChoosingVoice(true)}
          >
            <Icon name="voice" />
            <span className="tb-text">{selectedVoice?.name ?? 'Voice'}</span>
          </button>
          <span className={`ib-meta read-aloud-status${status === 'error' ? ' is-error' : ''}`} role="status" aria-live="polite" title={statusText || undefined}>
            {statusText}
          </span>
        </div>
      )}
    </Popover>
  )

  return (
    <div className="read-aloud-control">
      <button
        ref={buttonRef}
        type="button"
        className={`read-aloud-btn${active ? ' active' : ''}${status === 'loading' ? ' loading' : ''}${status === 'error' ? ' error' : ''}`}
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        aria-label="Read aloud options"
        title="Read aloud"
      >
        <Icon name="read-aloud" />
      </button>
      {popover}
    </div>
  )
}

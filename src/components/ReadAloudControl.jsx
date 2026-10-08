/**
 * ReadAloudControl.jsx — toolbar button + popover for read-aloud playback.
 *
 * Drives the Kokoro TTS pipeline in lib/readAloud: builds chunks from the
 * editor text (or selection), generates audio ahead of playback
 * (READ_ALOUD_PREFETCH_AHEAD), plays chunks back-to-back while highlighting
 * the spoken word via the ReadAloudHighlight extension, and animates a
 * level-meter visualization. Voice choice persists to the preference store; falls
 * back to the system speechSynthesis voices if Kokoro can't load.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from '../ui/Icon.jsx'
import { useCommands } from '../lib/commands'
import { clearReadAloudHighlight, setReadAloudHighlight } from '../extensions/ReadAloudHighlight'
import {
  DEFAULT_READ_ALOUD_VOICE,
  READ_ALOUD_VOICES,
  buildReadAloudChunks,
  generateReadAloudAudio,
  getReadableEditorPayload,
  isKokoroGenerationTimeoutError,
  prewarmReadAloud,
} from '../lib/readAloud'
import { getPreference, setPreference } from '../lib/preferences'
import { documentSurface, editorRegistry } from '../bridge'

const READ_ALOUD_VOICE_STORAGE_KEY = 'inkblot:read-aloud-voice'
const INITIAL_READ_ALOUD_LEVELS = [0.08, 0.12, 0.16, 0.1, 0.14, 0.09]
const READ_ALOUD_BAR_RESPONSE = [0.56, 0.9, 1, 0.76, 0.94, 0.62]
const READ_ALOUD_BAR_KEYS = ['sub', 'low', 'lowMid', 'highMid', 'presence', 'air']
const READ_ALOUD_PREFETCH_AHEAD = 2
const WORD_HIGHLIGHT_LAG_MS = 180
const SYSTEM_FEMALE_VOICE_HINTS = ['samantha', 'victoria', 'ava', 'allison', 'karen', 'serena']
const SYSTEM_MALE_VOICE_HINTS = ['alex', 'daniel', 'tom', 'fred', 'oliver']

const formatProgress = (progress) => {
  if (!progress || typeof progress !== 'object') return ''

  if (Number.isFinite(progress.progress)) {
    const fileLabel = progress.file ? `${String(progress.file).split('/').pop()} ` : ''
    return `${fileLabel}${Math.round(progress.progress)}%`
  }

  if (progress.status === 'download' && progress.file) {
    return `Downloading ${String(progress.file).split('/').pop()}`
  }

  if (progress.status === 'initiate' && progress.file) {
    return `Starting ${String(progress.file).split('/').pop()}`
  }

  if (progress.status === 'done' && progress.file) {
    return `Loaded ${String(progress.file).split('/').pop()}`
  }

  if (progress.status === 'ready') return 'Ready'
  if (typeof progress.status === 'string') return progress.status
  return ''
}

const pickSystemVoiceForKokoroVoice = (kokoroVoice) => {
  const synth = window.speechSynthesis
  if (!synth?.getVoices) return null

  const voices = synth.getVoices()
  if (!voices.length) return null

  const wantsBritish = kokoroVoice?.startsWith('b')
  const wantsMale = kokoroVoice?.includes('m_')
  const languagePrefix = wantsBritish ? 'en-GB' : 'en-US'
  const hints = wantsMale ? SYSTEM_MALE_VOICE_HINTS : SYSTEM_FEMALE_VOICE_HINTS
  const matchingLanguageVoices = voices.filter((voice) => voice.lang?.startsWith(languagePrefix))

  return matchingLanguageVoices.find((voice) => (
    hints.some((hint) => voice.name.toLowerCase().includes(hint))
  )) || matchingLanguageVoices[0] || voices.find((voice) => voice.lang?.startsWith('en')) || voices[0] || null
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
  const [voice, setVoice] = useState(() => {
    const storedVoice = getPreference(READ_ALOUD_VOICE_STORAGE_KEY)
    return READ_ALOUD_VOICES.some((option) => option.id === storedVoice)
      ? storedVoice
      : DEFAULT_READ_ALOUD_VOICE
  })
  const [status, setStatus] = useState('idle')
  const [message, setMessage] = useState('')
  const [levels, setLevels] = useState(INITIAL_READ_ALOUD_LEVELS)
  const [popoverAnchor, setPopoverAnchor] = useState({ top: 52, right: 16 })

  const updatePopoverAnchor = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect?.()
    if (!rect) {
      setPopoverAnchor({ top: 52, right: 16 })
      return
    }

    setPopoverAnchor({
      top: Math.round(rect.bottom + 8),
      right: Math.max(12, Math.round(window.innerWidth - rect.right)),
    })
  }, [])

  useEffect(() => {
    if (!open) return undefined

    updatePopoverAnchor()
    window.addEventListener('resize', updatePopoverAnchor)
    window.addEventListener('scroll', updatePopoverAnchor, true)

    return () => {
      window.removeEventListener('resize', updatePopoverAnchor)
      window.removeEventListener('scroll', updatePopoverAnchor, true)
    }
  }, [open, updatePopoverAnchor])

  useEffect(() => {
    setPreference(READ_ALOUD_VOICE_STORAGE_KEY, voice)
  }, [voice])

  useEffect(() => documentSurface.onRequest('getReadAloudPayload', answerReadAloudPayload), [])

  useEffect(() => {
    if (!open || status === 'loading' || status === 'playing') return

    let cancelled = false
    setMessage('Warming Kokoro...')

    prewarmReadAloud({ voice })
      .then(() => {
        if (!cancelled) setMessage('')
      })
      .catch((error) => {
        if (!cancelled) setMessage(error?.message || String(error))
      })

    return () => {
      cancelled = true
    }
  }, [open, status, voice])

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
      throw new Error('Kokoro returned an empty audio chunk.')
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
      throw new Error('Kokoro stalled, and system speech is not available in this webview.')
    }

    cleanupAudio()
    clearWordHighlight(false)

    const utterance = new window.SpeechSynthesisUtterance(text)
    const systemVoice = pickSystemVoiceForKokoroVoice(voice)
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
  }, [cleanupAudio, clearWordHighlight, editor, startSystemSpeechWaveform, voice])

  const stop = useCallback(() => {
    requestIdRef.current += 1
    activeReadChunksRef.current = null
    cleanupAudio()
    clearWordHighlight()
    setStatus('idle')
    setMessage('')
  }, [cleanupAudio, clearWordHighlight])

  const read = useCallback(async () => {
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
    setMessage('Preparing Kokoro...')
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
            setMessage(chunks.length === 1 ? label : `${label} ${index + 1}/${chunks.length}`)
          },
          onProgress: (progress) => {
            if (!shouldReportProgress || requestIdRef.current !== requestId) return
            const label = formatProgress(progress)
            if (label) setMessage(label)
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
        setMessage(index === 0 ? 'Preparing Kokoro...' : `Preparing chunk ${index + 1}/${chunks.length}`)
        queueAudioAhead(index)

        if (useSystemSpeechRef.current) {
          setStatus('playing')
          setMessage(chunks.length === 1 ? 'Reading with system voice' : `System voice ${index + 1}/${chunks.length}`)
          await playSystemSpeechChunk(chunks[index].text, requestId, chunks[index].words)
          continue
        }

        try {
          const audio = await audioPromises.get(index)

          if (requestIdRef.current !== requestId) return

          setStatus('playing')
          setMessage(chunks.length === 1 ? 'Reading aloud' : `Reading ${index + 1}/${chunks.length}`)
          queueAudioAhead(index + 1)
          await playAudioChunk(audio, requestId, chunks[index].words)
        } catch (error) {
          if (!isKokoroGenerationTimeoutError(error)) throw error
          if (requestIdRef.current !== requestId) return

          useSystemSpeechRef.current = true
          setStatus('playing')
          setMessage('Kokoro stalled, using system voice')
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
      setStatus('error')
      setMessage(error?.message || String(error))
    }
  }, [cleanupAudio, clearWordHighlight, editor, playAudioChunk, playSystemSpeechChunk, voice])

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
  const popover = open ? createPortal(
    <div
      className={`read-aloud-popover ${status}`}
      style={{
        '--read-aloud-popover-top': `${popoverAnchor.top}px`,
        '--read-aloud-popover-right': `${popoverAnchor.right}px`,
      }}
    >
      <div className="read-aloud-popover-header">
        <div>
          <div className="read-aloud-title">Read aloud</div>
          <div className="read-aloud-subtitle">
            {selectedVoice ? `${selectedVoice.name} · ${selectedVoice.language} ${selectedVoice.gender}` : 'Choose a voice'}
          </div>
        </div>
        <div className="read-aloud-wave" aria-hidden="true">
          {levels.map((level, index) => (
            <span
              key={READ_ALOUD_BAR_KEYS[index]}
              className="read-aloud-wave-bar"
              style={{ '--bar-height': `${6 + level * 24}px` }}
            />
          ))}
        </div>
      </div>

      <label className="read-aloud-field">
        <span>Voice</span>
        <select
          className="read-aloud-voice-select"
          value={voice}
          onChange={(event) => setVoice(event.target.value)}
          disabled={active}
          aria-label="Read aloud voice"
          title={selectedVoice ? `${selectedVoice.name} - ${selectedVoice.language} ${selectedVoice.gender}` : 'Read aloud voice'}
        >
          <optgroup label="American female">
            {READ_ALOUD_VOICES.filter((option) => option.language === 'American' && option.gender === 'Female').map((option) => (
              <option key={option.id} value={option.id}>
                {option.name} ({option.grade})
              </option>
            ))}
          </optgroup>
          <optgroup label="American male">
            {READ_ALOUD_VOICES.filter((option) => option.language === 'American' && option.gender === 'Male').map((option) => (
              <option key={option.id} value={option.id}>
                {option.name} ({option.grade})
              </option>
            ))}
          </optgroup>
          <optgroup label="British female">
            {READ_ALOUD_VOICES.filter((option) => option.language === 'British' && option.gender === 'Female').map((option) => (
              <option key={option.id} value={option.id}>
                {option.name} ({option.grade})
              </option>
            ))}
          </optgroup>
          <optgroup label="British male">
            {READ_ALOUD_VOICES.filter((option) => option.language === 'British' && option.gender === 'Male').map((option) => (
              <option key={option.id} value={option.id}>
                {option.name} ({option.grade})
              </option>
            ))}
          </optgroup>
        </select>
      </label>

      <div className={`read-aloud-status ${status}`}>
        {message || (active ? 'Preparing...' : 'Reads selection, or the whole document.')}
      </div>

      <button
        type="button"
        className="read-aloud-action"
        onClick={active ? stop : read}
      >
        {active ? 'Stop' : 'Read'}
      </button>
    </div>,
    document.body
  ) : null

  return (
    <div className="read-aloud-control">
      <button
        ref={buttonRef}
        type="button"
        className={`read-aloud-btn${active ? ' active' : ''}${status === 'loading' ? ' loading' : ''}${status === 'error' ? ' error' : ''}`}
        onClick={() => {
          updatePopoverAnchor()
          setOpen((current) => !current)
        }}
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

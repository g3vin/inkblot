/**
 * useAudioRecorder.js — one recorder, shared by every place that can capture a memo.
 *
 * Three callers: the notes-panel footer, the note cards (panel / hover preview /
 * canvas), and the canvas toolbar. They all record the same way and must all release
 * the microphone the same way, so the machinery lives here rather than three times.
 *
 * `stop()` resolves to the saved clip (or null if nothing was captured), so a caller
 * can decide what to do with it — attach it to a note, or drop it on a canvas.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { canRecordAudio, saveAudioClip, startAudioRecording } from '../lib/audioNotes'

export function useAudioRecorder(projectName) {
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState('')
  const handleRef = useRef(null)

  // Tick while recording, so the elapsed time visibly runs.
  useEffect(() => {
    if (!recording) return
    const id = setInterval(() => {
      const startedAt = handleRef.current?.startedAt
      if (startedAt) setElapsed(Date.now() - startedAt)
    }, 200)
    return () => clearInterval(id)
  }, [recording])

  // A recording still running when the component goes away would hold the microphone
  // open and leave the OS "in use" indicator lit.
  useEffect(
    () => () => {
      handleRef.current?.cancel()
      handleRef.current = null
    },
    []
  )

  const start = useCallback(async () => {
    setError('')
    try {
      handleRef.current = await startAudioRecording()
      setElapsed(0)
      setRecording(true)
      return true
    } catch (cause) {
      console.warn('[audio] could not start recording:', cause)
      // Almost always a denied microphone permission — say so rather than doing
      // nothing, which looks like a broken button.
      setError('Microphone unavailable')
      return false
    }
  }, [])

  /** Stop and save. Resolves to the stored clip, or null if nothing was captured. */
  const stop = useCallback(async () => {
    const handle = handleRef.current
    handleRef.current = null
    setRecording(false)
    if (!handle) return null

    try {
      const result = await handle.stop()
      if (!result?.blob) return null
      return await saveAudioClip(projectName, result.blob, result.durationMs)
    } catch (cause) {
      console.error('[audio] could not save recording:', cause)
      setError('Could not save recording')
      return null
    }
  }, [projectName])

  const toggle = useCallback(async () => (recording ? stop() : (await start(), null)), [
    recording,
    start,
    stop,
  ])

  return {
    supported: canRecordAudio(),
    recording,
    elapsed,
    error,
    start,
    stop,
    toggle,
  }
}

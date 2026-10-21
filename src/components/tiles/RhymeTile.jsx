/**
 * RhymeTile.jsx — "Find Rhymes" workbench tile.
 *
 * Asks Rust's `get_rhymes` for perfect rhymes, read out of the CMU Pronouncing
 * Dictionary (see `inkblot-models/src/rhymes.rs`); clicking a rhyme replaces the source
 * word in the document.
 *
 * The dictionary is 3.6 MB, so when Rust reports `MODEL_NOT_INSTALLED` the tile
 * fetches it without asking, the way it would load any other small resource.
 */
import { useEffect, useMemo, useState } from 'react'

/** Tauri's API, imported lazily so the tile still renders in a plain browser. */
const tauri =
  typeof window !== 'undefined' && window.__TAURI__
    ? import('@tauri-apps/api/core')
        .then((core) => ({ invoke: core.invoke }))
        .catch(() => null)
    : Promise.resolve(null)

/** One download for every tile, however many are open when it is needed. */
let dictionaryDownload = null

const ensureDictionary = (api) => {
  dictionaryDownload ??= api.invoke('download_rhyme_dictionary').catch((error) => {
    dictionaryDownload = null
    throw error
  })
  return dictionaryDownload
}

export default function RhymeTile({ word, onReplace, onRemove, onSelect }) {
  const [rhymes, setRhymes] = useState([])
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')

  const normalizedWord = useMemo(() => word?.trim().toLowerCase() || '', [word])

  useEffect(() => {
    if (!normalizedWord) {
      setRhymes([])
      setError('')
      return undefined
    }

    let cancelled = false

    const fetchRhymes = async () => {
      setStatus('loading')
      setError('')
      try {
        const api = await tauri
        if (!api) throw new Error('Rhymes need the desktop app.')

        let response
        try {
          response = await api.invoke('get_rhymes', { word: normalizedWord })
        } catch (err) {
          if (!String(err?.message || err).includes('MODEL_NOT_INSTALLED')) throw err
          if (!cancelled) setStatus('downloading')
          await ensureDictionary(api)
          response = await api.invoke('get_rhymes', { word: normalizedWord })
        }

        if (cancelled) return
        setRhymes(response?.rhymes || [])
        setStatus('ready')
      } catch (err) {
        if (cancelled) return
        console.error('Finding rhymes failed:', err)
        setError(String(err?.message || err || 'Finding rhymes failed.'))
        setRhymes([])
        setStatus('ready')
      }
    }

    fetchRhymes()
    return () => {
      cancelled = true
    }
  }, [normalizedWord])

  return (
    <div
      className="tile sidebar-card"
      onClick={onSelect}
    >
      <button
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
        className="sidebar-card-close"
      >
        ×
      </button>

      <div className="sidebar-card-eyebrow sidebar-card-eyebrow--rhyme">
        Rhymes
      </div>

      <h4 className="sidebar-card-title">{normalizedWord}</h4>

      <div className="sidebar-chip-list">
        {status === 'downloading' ? (
          <span className="sidebar-muted">Getting the rhyming dictionary…</span>
        ) : status === 'loading' ? (
          <span className="sidebar-muted">Finding rhymes...</span>
        ) : error ? (
          <span className="sidebar-error">{error}</span>
        ) : rhymes.length > 0 ? (
          rhymes.map((rhyme) => (
            <button
              key={rhyme}
              onClick={(e) => {
                e.stopPropagation()
                onReplace(rhyme)
              }}
              className="synonym-btn rhyme-btn"
            >
              {rhyme}
            </button>
          ))
        ) : (
          <span className="sidebar-muted">No rhymes found.</span>
        )}
      </div>
    </div>
  )
}

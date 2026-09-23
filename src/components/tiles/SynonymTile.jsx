/**
 * SynonymTile.jsx — "Find Synonyms" workbench tile.
 *
 * Asks the Rust backend's `get_synonyms` command (a local ONNX NLP model)
 * for synonyms and antonyms of the selected word in its sentence context.
 * Antonyms are inflected to match the original word's tense/form, and
 * clicking any chip replaces the word in the document.
 *
 * The model is ~423 MB and is NOT shipped with the app — it downloads once into the
 * app data directory. So the tile has a second job: when Rust reports
 * `MODEL_NOT_INSTALLED`, it offers the download and reports progress, rather than
 * silently showing "no matches" for a model that was never there.
 */
import React, { useCallback, useEffect, useRef, useState } from "react"
import nlp from "compromise"

const normalizeTerm = (term) => term.trim().toLowerCase()

/**
 * Tauri's API is imported lazily so the tile still renders in a plain browser.
 *
 * Held as a PROMISE rather than a resolved value, so a render before the import
 * settles waits for it instead of reporting "Tauri API not available".
 */
const tauri =
  typeof window !== "undefined" && window.__TAURI__
    ? Promise.all([import("@tauri-apps/api/core"), import("@tauri-apps/api/event")])
        .then(([core, event]) => ({ invoke: core.invoke, listen: event.listen }))
        .catch((err) => {
          console.warn("Tauri API failed to load:", err?.message || err)
          return null
        })
    : Promise.resolve(null)

const formatBytes = (bytes) => {
  if (!bytes) return ""
  const mb = bytes / (1024 * 1024)
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`
}

/**
 * Inflect a candidate antonym to match the input word's tense/form using compromise
 */
function inflectToMatch(word, candidate) {
  if (!word || !candidate) return candidate

  const docWord = nlp(word)
  const docCand = nlp(candidate)

  // Determine part-of-speech
  if (docWord.has("#Verb")) {
    const verbForm = docWord.verbs().data()[0]?.tense || "PresentTense"
    return docCand.verbs()[verbForm.toLowerCase()]()?.text() || candidate
  }

  if (docWord.has("#Adjective")) {
    return docCand.adjectives().conjugate()?.adjective || candidate
  }

  return candidate
}

export default function SynonymTile({ word, context, onReplace, onRemove, onSelect }) {
  const [synonyms, setSynonyms] = useState([])
  const [antonyms, setAntonyms] = useState([])
  const [loading, setLoading] = useState(false)
  // 'ready' | 'missing' | 'downloading'
  const [modelState, setModelState] = useState("ready")
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState("")
  const unlistenRef = useRef(null)

  const fetchSynonyms = useCallback(async () => {
    if (!word) {
      setSynonyms([])
      setAntonyms([])
      return
    }

    setLoading(true)
    setError("")
    try {
      const api = await tauri
      if (!api) {
        setError("Synonyms need the desktop app.")
        return
      }

      const textContext = context && context.includes(word) ? context : `I am ${word}.`
      const response = await api.invoke("get_synonyms", {
        text: textContext,
        targetWord: normalizeTerm(word),
      })

      setModelState("ready")

      const rawSyns = response?.synonyms || []
      const rawAnts = response?.antonyms || []
      const normTarget = normalizeTerm(word)

      // Filter synonyms: remove duplicates and words containing original
      const synFiltered = rawSyns
        .filter((s) => s && normalizeTerm(s) !== normTarget && !normalizeTerm(s).includes(normTarget))
        .filter((v, i, a) => a.findIndex((x) => normalizeTerm(x) === normalizeTerm(v)) === i)
        .slice(0, 10)

      // Inflect antonyms and filter duplicates/containing original word
      const antsInflected = rawAnts
        .filter((a) => a && normalizeTerm(a) !== normTarget && !normalizeTerm(a).includes(normTarget))
        .map((a) => inflectToMatch(word, a))
        .filter((v, i, a) => a.findIndex((x) => normalizeTerm(x) === normalizeTerm(v)) === i)
        .slice(0, 5)

      setSynonyms(synFiltered)
      setAntonyms(antsInflected)
    } catch (err) {
      const message = String(err?.message || err || "")
      if (message.includes("MODEL_NOT_INSTALLED")) {
        // Not an error the user caused — the model just has not been fetched yet.
        setModelState("missing")
      } else {
        console.error("Error fetching synonyms:", err)
        setError(message || "Could not reach the synonym model.")
      }
      setSynonyms([])
      setAntonyms([])
    } finally {
      setLoading(false)
    }
  }, [word, context])

  useEffect(() => {
    fetchSynonyms()
  }, [fetchSynonyms])

  // Progress events keep flowing after an unmount otherwise; the model is large and
  // the download outlives most tiles.
  useEffect(() => () => { unlistenRef.current?.() }, [])

  const startDownload = useCallback(async (event) => {
    event.stopPropagation()
    const api = await tauri
    if (!api) return

    setModelState("downloading")
    setError("")
    setProgress(null)

    unlistenRef.current = await api.listen("synonym://download", ({ payload }) => {
      setProgress(payload)
    })

    try {
      await api.invoke("download_synonym_model")
      setModelState("ready")
      await fetchSynonyms()
    } catch (err) {
      console.error("Synonym model download failed:", err)
      setError(String(err?.message || err || "Download failed."))
      setModelState("missing")
    } finally {
      unlistenRef.current?.()
      unlistenRef.current = null
      setProgress(null)
    }
  }, [fetchSynonyms])

  const renderBody = () => {
    if (modelState === "downloading") {
      const pct =
        progress?.total > 0 ? Math.round((progress.received / progress.total) * 100) : null
      return (
        <span className="sidebar-muted">
          Downloading model
          {progress ? ` (${progress.index} of ${progress.count})` : ""}
          {pct !== null ? ` — ${pct}% of ${formatBytes(progress.total)}` : "…"}
        </span>
      )
    }

    if (modelState === "missing") {
      return (
        <>
          <span className="sidebar-muted">
            The synonym model (~426 MB) isn&rsquo;t downloaded yet. It&rsquo;s kept once and
            works offline after.
          </span>
          <button onClick={startDownload} className="synonym-btn">
            Download model
          </button>
        </>
      )
    }

    if (error) return <span className="sidebar-muted">{error}</span>
    if (loading) return <span className="sidebar-muted">Searching...</span>
    if (synonyms.length === 0 && antonyms.length === 0) {
      return <span className="sidebar-muted">No high-quality matches.</span>
    }

    return (
      <>
        {synonyms.map((syn, i) => (
          <button
            key={`syn-${syn}-${i}`}
            onClick={(e) => { e.stopPropagation(); onReplace(syn) }}
            className="synonym-btn"
          >
            {syn}
          </button>
        ))}

        {antonyms.map((ant, i) => (
          <button
            key={`ant-${ant}-${i}`}
            onClick={(e) => { e.stopPropagation(); onReplace(ant) }}
            className="synonym-btn synonym-btn-antonym"
            title="antonym"
          >
            {ant}
          </button>
        ))}
      </>
    )
  }

  return (
    <div className="tile sidebar-card" onClick={onSelect}>
      <button
        onClick={(e) => { e.stopPropagation(); onRemove() }}
        className="sidebar-card-close"
      >
        ×
      </button>

      <div className="sidebar-card-eyebrow sidebar-card-eyebrow--thesaurus">
        Thesaurus
      </div>

      <h4 className="sidebar-card-title">{normalizeTerm(word)}</h4>

      <div className="sidebar-chip-list">{renderBody()}</div>
    </div>
  )
}

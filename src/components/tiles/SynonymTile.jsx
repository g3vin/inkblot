/**
 * SynonymTile.jsx — "Find Synonyms" workbench tile.
 *
 * Asks the Rust backend's `get_synonyms` command (a local ONNX NLP model)
 * for synonyms and antonyms of the selected word in its sentence context.
 * Antonyms are inflected to match the original word's tense/form, and
 * clicking any chip replaces the word in the document.
 */
import React, { useEffect, useState } from "react"
import nlp from "compromise"

const normalizeTerm = (term) => term.trim().toLowerCase()

// Tauri's invoke is loaded lazily so the tile also renders in a plain browser.
let invokeFn = null
if (typeof window !== "undefined" && window.__TAURI__) {
  import("@tauri-apps/api/core")
    .then((mod) => {
      if (typeof mod.invoke === "function") invokeFn = mod.invoke
    })
    .catch((err) => console.warn("Tauri API failed to load:", err?.message || err))
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

  useEffect(() => {
    if (!word) {
      setSynonyms([])
      setAntonyms([])
      return
    }

    const fetchSynonyms = async () => {
      setLoading(true)
      try {
        const textContext = context && context.includes(word) ? context : `I am ${word}.`
        let response = null

        if (invokeFn) {
          response = await invokeFn("get_synonyms", {
            text: textContext,
            targetWord: normalizeTerm(word),
          })
        } else {
          console.warn("Tauri API not available")
        }

        const rawSyns = response?.synonyms || []
        const rawAnts = response?.antonyms || []

        const normTarget = normalizeTerm(word)

        // Filter synonyms: remove duplicates and words containing original
        const synFiltered = rawSyns
          .filter((s) => s && normalizeTerm(s) !== normTarget && !normalizeTerm(s).includes(normTarget))
          .filter((v, i, a) => a.findIndex(x => normalizeTerm(x) === normalizeTerm(v)) === i)
          .slice(0, 10)

        // Inflect antonyms and filter duplicates/containing original word
        const antsInflected = rawAnts
          .filter((a) => a && normalizeTerm(a) !== normTarget && !normalizeTerm(a).includes(normTarget))
          .map((a) => inflectToMatch(word, a))
          .filter((v, i, a) => a.findIndex(x => normalizeTerm(x) === normalizeTerm(v)) === i)
          .slice(0, 5)

        setSynonyms(synFiltered)
        setAntonyms(antsInflected)
      } catch (error) {
        console.error("Error fetching synonyms:", error)
        setSynonyms([])
        setAntonyms([])
      } finally {
        setLoading(false)
      }
    }

    fetchSynonyms()
  }, [word, context])

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

      <div className="sidebar-chip-list">
        {loading ? (
          <span className="sidebar-muted">Searching...</span>
        ) : synonyms.length === 0 && antonyms.length === 0 ? (
          <span className="sidebar-muted">No high-quality matches.</span>
        ) : (
          <>
            {synonyms.map((syn, i) => (
              <button key={`syn-${syn}-${i}`} onClick={(e) => { e.stopPropagation(); onReplace(syn) }} className="synonym-btn">
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
        )}
      </div>
    </div>
  )
}

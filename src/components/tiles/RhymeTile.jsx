/**
 * RhymeTile.jsx — "Find Rhymes" workbench tile.
 *
 * Scores rhyme candidates with a local ONNX model (public/rhyme_model.onnx +
 * public/vocab.json) running in onnxruntime-web. Candidates are pre-filtered
 * by shared word suffix, then ranked by model score; clicking a rhyme
 * replaces the source word in the document.
 */
import React, { useEffect, useMemo, useState } from 'react'
import * as ort from 'onnxruntime-web/ort-wasm'

// Model session and vocabulary are module-level singletons shared by all tiles.
let session
let vocab = []
let word2idx = {}

async function initRhymeModel() {
  if (!session) {
    ort.env.wasm.numThreads = 1
    ort.env.wasm.simd = false
    session = await ort.InferenceSession.create('/rhyme_model.onnx', {
      executionProviders: ['wasm'],
    })
  }

  if (!vocab.length) {
    vocab = await fetch('/vocab.json').then((r) => r.json())
    word2idx = Object.fromEntries(vocab.map((w, i) => [w, i]))
  }

  return { session, vocab, word2idx }
}

export default function RhymeTile({ word, onReplace, onRemove, onSelect }) {
  const [rhymes, setRhymes] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const normalizedWord = useMemo(() => word?.toLowerCase() || '', [word])

  useEffect(() => {
    if (!normalizedWord) {
      setRhymes([])
      setError('')
      return
    }

    let cancelled = false

    const scoreCandidate = async (candidate, modelSession, map) => {
      const a = map[normalizedWord]
      const b = map[candidate]
      if (a === undefined || b === undefined) return null

      const inputA = new ort.Tensor('int64', BigInt64Array.from([BigInt(a)]), [1])
      const inputB = new ort.Tensor('int64', BigInt64Array.from([BigInt(b)]), [1])

      const outputs = await modelSession.run({ word_a: inputA, word_b: inputB })
      return outputs.rhyme_score.data[0]
    }

    const fetchRhymes = async () => {
      setLoading(true)
      setError('')
      try {
        const { session: modelSession, vocab: modelVocab, word2idx: map } = await initRhymeModel()
        if (cancelled) return

        const suffix3 = normalizedWord.slice(-3)
        const suffix2 = normalizedWord.slice(-2)
        const candidates = modelVocab
          .filter((candidate) => candidate !== normalizedWord)
          .filter((candidate) => {
            if (normalizedWord.length <= 2) return candidate.endsWith(suffix2)
            return candidate.endsWith(suffix3) || candidate.endsWith(suffix2)
          })

        const limitedCandidates = candidates.length > 300
          ? candidates.slice(0, 300)
          : candidates

        const scored = []
        for (const candidate of limitedCandidates) {
          if (cancelled) return
          const score = await scoreCandidate(candidate, modelSession, map)
          if (score !== null && Number.isFinite(score)) {
            scored.push({ word: candidate, score })
          }
        }

        scored.sort((a, b) => b.score - a.score)
        const top = scored.slice(0, 15).map(item => item.word)
        setRhymes(top)
      } catch (err) {
        if (cancelled) return
        console.error('Error scoring rhymes:', err)
        setError('Failed to score rhymes.')
        setRhymes([])
      } finally {
        if (!cancelled) setLoading(false)
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
        {loading ? (
          <span className="sidebar-muted">Finding rhymes...</span>
        ) : error ? (
          <span className="sidebar-error">{error}</span>
        ) : rhymes.length > 0 ? (
          rhymes.map((rhyme, i) => (
            <button
              key={i}
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

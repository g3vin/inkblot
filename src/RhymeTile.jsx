import React, { useEffect, useMemo, useState } from 'react'
import * as ort from 'onnxruntime-web/ort-wasm'

let session
let vocab = []
let word2idx = {}

export async function initRhymeModel() {
  if (!session) {
    console.log('Loading ONNX model...')
    ort.env.wasm.numThreads = 1
    ort.env.wasm.simd = false
    session = await ort.InferenceSession.create('/rhyme_model.onnx', {
      executionProviders: ['wasm'],
    })
  }

  if (!vocab.length) {
    console.log('Loading vocab...')
    vocab = await fetch('/vocab.json').then((r) => r.json())
    word2idx = Object.fromEntries(vocab.map((w, i) => [w, i]))
  }

  return { session, vocab, word2idx }
}

export async function getRhymeScore(wordA, wordB) {
  const { session, word2idx } = await initRhymeModel()

  const a = word2idx[wordA.toLowerCase()]
  const b = word2idx[wordB.toLowerCase()]
  if (a === undefined || b === undefined) {
    throw new Error('One or both words not found in vocabulary.')
  }

  const inputA = new ort.Tensor('int64', BigInt64Array.from([BigInt(a)]), [1])
  const inputB = new ort.Tensor('int64', BigInt64Array.from([BigInt(b)]), [1])

  const outputs = await session.run({ word_a: inputA, word_b: inputB })
  const score = outputs.rhyme_score.data[0]
  return score
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
      className="tile"
      style={{ position: 'relative' }}
      onClick={onSelect}
    >
      <button
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
        style={{
          position: 'absolute',
          top: '5px',
          right: '8px',
          background: 'none',
          border: 'none',
          color: '#888',
          cursor: 'pointer',
          fontSize: '16px',
        }}
      >
        ×
      </button>

      <div
        style={{
          fontSize: '10px',
          color: '#ff9500',
          marginBottom: '8px',
          fontWeight: 'bold',
          textTransform: 'uppercase',
        }}
      >
        Rhymes
      </div>

      <h4 style={{ margin: '0 0 8px 0', fontSize: '16px' }}>{normalizedWord}</h4>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
        {loading ? (
          <span style={{ color: '#666', fontSize: '12px' }}>Finding rhymes...</span>
        ) : error ? (
          <span style={{ color: '#ff5a5a', fontSize: '12px' }}>{error}</span>
        ) : rhymes.length > 0 ? (
          rhymes.map((rhyme, i) => (
            <button
              key={i}
              onClick={(e) => {
                e.stopPropagation()
                onReplace(rhyme)
              }}
              className="rhyme-btn"
              style={{
                background: '#1a1a1a',
                border: '1px solid #444',
                color: '#ddd',
                padding: '4px 10px',
                borderRadius: '4px',
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              {rhyme}
            </button>
          ))
        ) : (
          <span style={{ color: '#666', fontSize: '12px' }}>No rhymes found.</span>
        )}
      </div>
    </div>
  )
}
import React, { useEffect, useState } from 'react'

export default function RhymeTile({ word, onReplace, onRemove }) {
  const [rhymes, setRhymes] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!word) return

    const fetchRhymes = async () => {
      setLoading(true)
      try {
        // Datamuse: "rel_rhy" finds words that rhyme with the given word
        const response = await fetch(
          `https://api.datamuse.com/words?rel_rhy=${encodeURIComponent(word)}&max=20`
        )
        const data = await response.json()

        const filtered = data
          .filter(item => item.word.toLowerCase() !== word.toLowerCase())
          .map(item => item.word)
          .slice(0, 15)

        setRhymes(filtered)
      } catch (error) {
        console.error('Error fetching rhymes:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchRhymes()
  }, [word])

  return (
    <div className="tile" style={{ position: 'relative' }}>
      <button
        onClick={onRemove}
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

      <h4 style={{ margin: '0 0 8px 0', fontSize: '16px' }}>{word.toLowerCase()}</h4>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
        {loading ? (
          <span style={{ color: '#666', fontSize: '12px' }}>Finding rhymes...</span>
        ) : rhymes.length > 0 ? (
          rhymes.map((rhyme, i) => (
            <button
              key={i}
              onClick={() => onReplace(rhyme)}
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
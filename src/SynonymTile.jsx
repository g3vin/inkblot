import React, { useEffect, useState } from 'react'

export default function SynonymTile({ word, onReplace, onRemove }) {
  const [synonyms, setSynonyms] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!word) return

    const fetchSynonyms = async () => {
      setLoading(true)
      try {
        // We use 'ml' (means like) but we add a 'topics' hint and limit to high-score results
        const response = await fetch(
          `https://api.datamuse.com/words?ml=${encodeURIComponent(word)}&max=15`
        )
        const data = await response.json()
        const filtered = data
          .filter(item => 
            item.word.toLowerCase() !== word.toLowerCase() && 
            item.word.length > 2 &&
            item.score > 1000000
          )
          .map(item => item.word)
          .slice(0, 10)

        setSynonyms(filtered)
      } catch (error) {
        console.error("Error fetching synonyms:", error)
      } finally {
        setLoading(false)
      }
    }

    fetchSynonyms()
  }, [word])

  return (
    <div className="tile" style={{
    }}>
      <button 
        onClick={onRemove} 
        style={{ 
          position: 'absolute', top: '5px', right: '8px', 
          background: 'none', border: 'none', color: '#888', 
          cursor: 'pointer', fontSize: '16px' 
        }}
      >
        ×
      </button>
      
      <div style={{ fontSize: '10px', color: '#007aff', marginBottom: '8px', fontWeight: 'bold', textTransform: 'uppercase' }}>
        Thesaurus
      </div>
      <h4 style={{ margin: '0 0 8px 0', fontSize: '16px' }}>{word.toLowerCase()}</h4>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
        {loading ? (
          <span style={{ color: '#666', fontSize: '12px' }}>Searching...</span>
        ) : synonyms.length > 0 ? (
          synonyms.map((syn, i) => (
            <button
              key={i}
              onClick={() => onReplace(syn)}
              className="synonym-btn"
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
              {syn}
            </button>
          ))
        ) : (
          <span style={{ color: '#666', fontSize: '12px' }}>No high-quality matches.</span>
        )}
      </div>
    </div>
  )
}
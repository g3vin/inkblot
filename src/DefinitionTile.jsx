import React, { useEffect, useState } from 'react'

export default function DefinitionTile({ word, onRemove }) {
  const [definition, setDefinition] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!word) return

    const fetchDefinition = async () => {
      setLoading(true)
      try {
        const response = await fetch(
          `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`
        )

        if (!response.ok) {
          setDefinition(null)
          return
        }

        const data = await response.json()
        const firstEntry = Array.isArray(data) ? data[0] : null
        const firstMeaning = firstEntry?.meanings?.[0]
        const firstDefinition = firstMeaning?.definitions?.[0]

        if (firstMeaning && firstDefinition?.definition) {
          setDefinition({
            pos: firstMeaning.partOfSpeech || '',
            text: firstDefinition.definition
          })
        } else {
          setDefinition(null)
        }
      } catch (error) {
        console.error('Error fetching definition:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchDefinition()
  }, [word])

  return (
    <div className="tile definition-tile" style={{
    }}>
      <button onClick={onRemove} style={{ position: 'absolute', top: '5px', right: '8px', background: 'none', border: 'none', color: '#888', cursor: 'pointer' }}>×</button>
      
      <div style={{ fontSize: '10px', color: '#ffcc00', marginBottom: '4px', fontWeight: 'bold', textTransform: 'uppercase' }}>
        Dictionary
      </div>
      
      <h4 style={{ margin: '0 0 8px 0', fontSize: '16px' }}>{word.toLowerCase()}</h4>

      {loading ? (
        <span className="definition-loading" style={{ fontSize: '12px' }}>Looking up...</span>
      ) : definition ? (
        <div>
          <span style={{ 
            fontStyle: 'italic', 
            fontSize: '12px', 
            marginRight: '8px' 
          }} className="definition-pos">
            ({definition.pos}.)
          </span>
          <p style={{ 
            margin: '4px 0 0 0', 
            fontSize: '13px', 
            lineHeight: '1.4' 
          }} className="definition-text">
            {definition.text}
          </p>
        </div>
      ) : (
        <span className="definition-empty" style={{ fontSize: '12px' }}>No definition found.</span>
      )}
    </div>
  )
}
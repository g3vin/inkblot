import React, { useEffect, useState } from 'react'

export default function DefinitionTile({ word, onRemove }) {
  const [definition, setDefinition] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!word) return

    const fetchDefinition = async () => {
      setLoading(true)
      try {
        // 'md=d' tells Datamuse to include definitions in the metadata
        const response = await fetch(`https://api.datamuse.com/words?sp=${encodeURIComponent(word)}&md=d&max=1`)
        const data = await response.json()
        
        if (data.length > 0 && data[0].defs) {
          // Datamuse definitions come back as "n\tdefinition" or "v\tdefinition"
          const firstDef = data[0].defs[0].split('\t')
          setDefinition({
            pos: firstDef[0],
            text: firstDef[1]
          })
        } else {
          setDefinition(null)
        }
      } catch (error) {
        console.error("Error fetching definition:", error)
      } finally {
        setLoading(false)
      }
    }

    fetchDefinition()
  }, [word])

  return (
    <div className="tile" style={{
    }}>
      <button onClick={onRemove} style={{ position: 'absolute', top: '5px', right: '8px', background: 'none', border: 'none', color: '#888', cursor: 'pointer' }}>×</button>
      
      <div style={{ fontSize: '10px', color: '#ffcc00', marginBottom: '4px', fontWeight: 'bold', textTransform: 'uppercase' }}>
        Dictionary
      </div>
      
      <h4 style={{ margin: '0 0 8px 0', fontSize: '16px' }}>{word.toLowerCase()}</h4>

      {loading ? (
        <span style={{ color: '#666', fontSize: '12px' }}>Looking up...</span>
      ) : definition ? (
        <div>
          <span style={{ 
            fontStyle: 'italic', 
            color: '#aaa', 
            fontSize: '12px', 
            marginRight: '8px' 
          }}>
            ({definition.pos}.)
          </span>
          <p style={{ 
            margin: '4px 0 0 0', 
            color: '#ddd', 
            fontSize: '13px', 
            lineHeight: '1.4' 
          }}>
            {definition.text}
          </p>
        </div>
      ) : (
        <span style={{ color: '#666', fontSize: '12px' }}>No definition found.</span>
      )}
    </div>
  )
}
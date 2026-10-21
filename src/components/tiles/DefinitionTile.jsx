/**
 * DefinitionTile.jsx — "Define Word" workbench tile.
 * Fetches the first definition from the free dictionaryapi.dev API.
 */
import { useEffect, useState } from 'react'

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
    <div className="tile definition-tile sidebar-card">
      <button onClick={onRemove} className="sidebar-card-close">×</button>
      
      <div className="sidebar-card-eyebrow sidebar-card-eyebrow--dictionary">
        Dictionary
      </div>
      
      <h4 className="sidebar-card-title">{word.toLowerCase()}</h4>

      {loading ? (
        <span className="definition-loading sidebar-muted">Looking up...</span>
      ) : definition ? (
        <div className="sidebar-card-copy">
          <span className="definition-pos">
            ({definition.pos}.)
          </span>
          <p className="definition-text">
            {definition.text}
          </p>
        </div>
      ) : (
        <span className="definition-empty sidebar-muted">No definition found.</span>
      )}
    </div>
  )
}

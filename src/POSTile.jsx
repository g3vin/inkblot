import React, { useEffect, useState } from 'react'
import nlp from 'compromise'

export default function POSTile({ sentence, onRemove }) {
  const [analysis, setAnalysis] = useState([])

  const tagColors = {
    Noun: '#1f77b4',
    Verb: '#2ca02c',
    Adjective: '#ff7f0e',
    Adverb: '#d62728',
    Number: '#17becf',
    Pronoun: '#9467bd',
    Determiner: '#8c564b',
    Conjunction: '#e377c2',
    Preposition: '#7f7f7f',
    Unknown: '#cccccc'
  }

  const normalizeTag = (tags, wordText) => {
    if (!tags || !Array.isArray(tags)) return 'Unknown'
    
    if (tags.some(t => ['Noun', 'Singular', 'Plural', 'ProperNoun', 'Person', 'Place', 'Organization'].includes(t))) return 'Noun'
    if (tags.some(t => ['Verb', 'Infinitive', 'PastTense', 'PresentTense', 'Gerund', 'Copula', 'Modal'].includes(t))) return 'Verb'
    if (tags.some(t => ['Adjective', 'Comparative', 'Superlative'].includes(t))) return 'Adjective'
    if (tags.includes('Adverb')) return 'Adverb'
    if (tags.some(t => ['Value', 'NumericValue', 'Ordinal', 'Cardinal', 'Number'].includes(t))) return 'Number'
    if (tags.includes('Pronoun')) return 'Pronoun'
    if (tags.includes('Determiner')) return 'Determiner'
    if (tags.includes('Conjunction')) return 'Conjunction'
    if (tags.includes('Preposition')) return 'Preposition'

    return 'Unknown'
  }

  useEffect(() => {
    if (!sentence) {
      setAnalysis([])
      return
    }

    const doc = nlp(sentence)
    const termsJson = doc.terms().json()

    const result = termsJson.flatMap(s => s.terms).map(item => ({
      text: item.text,
      tag: normalizeTag(item.tags, item.text)
    }))

    setAnalysis(result)
  }, [sentence])

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

      <div style={{ fontSize: '10px', color: '#ff8500', marginBottom: '8px', fontWeight: 'bold', textTransform: 'uppercase' }}>
        Parts of Speech
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '10px' }}>
        {analysis.map((word, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span style={{
              fontSize: '9px',
              color: 'white',
              backgroundColor: tagColors[word.tag],
              padding: '1px 4px',
              borderRadius: '3px',
              marginBottom: '2px',
              textTransform: 'uppercase'
            }}>
              {word.tag}
            </span>
            <span style={{
              fontSize: '14px',
              borderBottom: `2px solid ${tagColors[word.tag]}`
            }}>
              {word.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
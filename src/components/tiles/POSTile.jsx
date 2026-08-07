import React, { useMemo } from 'react'
import nlp from 'compromise'

export default function POSTile({ sentence, onRemove }) {
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

  const normalizeTag = (tags) => {
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

  const analysis = useMemo(() => {
    if (!sentence) return []
    const doc = nlp(sentence)
    const termsJson = doc.terms().json()

    return termsJson.flatMap(s => s.terms).map(item => ({
      text: item.text,
      tag: normalizeTag(item.tags)
    }))
  }, [sentence])

  return (
    <div className="tile sidebar-card">
      <button 
        onClick={onRemove}
        className="sidebar-card-close"
      >
        ×
      </button>

      <div className="sidebar-card-eyebrow sidebar-card-eyebrow--pos">
        Parts of Speech
      </div>

      <div className="sidebar-pos-grid">
        {analysis.map((word, i) => (
          <div key={i} className="sidebar-pos-token">
            <span
              className="sidebar-pos-badge"
              style={{ backgroundColor: tagColors[word.tag] }}
            >
              {word.tag}
            </span>
            <span
              className="sidebar-pos-word"
              style={{ borderBottomColor: tagColors[word.tag] }}
            >
              {word.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

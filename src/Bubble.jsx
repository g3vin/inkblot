import React, { useEffect, useState } from 'react'
import nlp from 'compromise'
import './Bubble.css'

export default function Bubble({ sentence, onClose }) {
  const [analysis, setAnalysis] = useState([])

  const tagColors = {
    Noun: '#1f77b4',
    Verb: '#2ca02c',
    Adjective: '#ff7f0e',
    Adverb: '#d62728',
    Pronoun: '#9467bd',
    Determiner: '#8c564b',
    Conjunction: '#e377c2',
    Preposition: '#7f7f7f',
    Unknown: '#cccccc'
  }

  const normalizeTag = (tags, wordText) => {
    if (!tags || !Array.isArray(tags)) {
      console.warn(`No tags found for word: "${wordText}"`);
      return 'Unknown';
    }

    // DEBUG: See what compromise is calling this word
    console.log(`Word: "${wordText}" | Tags:`, tags);

    if (tags.some(t => ['Noun', 'Singular', 'Plural', 'ProperNoun', 'Person', 'Place', 'Organization'].includes(t))) return 'Noun'
    if (tags.some(t => ['Verb', 'Infinitive', 'PastTense', 'PresentTense', 'Gerund', 'Copula', 'Modal'].includes(t))) return 'Verb'
    if (tags.some(t => ['Adjective', 'Comparative', 'Superlative'].includes(t))) return 'Adjective'
    if (tags.includes('Adverb')) return 'Adverb'
    if (tags.includes('Pronoun')) return 'Pronoun'
    if (tags.includes('Determiner')) return 'Determiner'
    if (tags.includes('Conjunction')) return 'Conjunction'
    if (tags.includes('Preposition')) return 'Preposition'

    return 'Unknown'
  }

  useEffect(() => {
    if (!sentence) return

    console.log('--- Analyzing Sentence ---');
    console.log('Input:', sentence);

    const doc = nlp(sentence)
    
    // Get raw JSON
    const termsJson = doc.terms().json()
    
    // DEBUG: Check the exact structure of the returned JSON
    console.log('Full JSON Structure:', termsJson);

    const result = termsJson.map(item => {
      const actualTags = item.tags || (item.terms && item.terms[0].tags);
      const actualText = item.text || (item.terms && item.terms[0].text);

      return {
        text: actualText,
        tag: normalizeTag(actualTags, actualText)
      }
    })

    setAnalysis(result)
  }, [sentence])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <h2>Parts of Speech Analysis</h2>
        
        <div className="pos-sentence">
          {analysis.map((word, i) => (
            <span 
              key={i} 
              className="pos-word-container" 
              style={{ 
                borderBottom: `3px solid ${tagColors[word.tag] || '#000'}`,
                margin: '0 5px',
                display: 'inline-block'
              }}
            >
              <div className="pos-tag" style={{ 
                backgroundColor: tagColors[word.tag] || '#000',
                fontSize: '10px',
                color: 'white',
                padding: '2px 4px',
                borderRadius: '3px',
                marginBottom: '4px',
                textAlign: 'center'
              }}>
                {word.tag}
              </div>
              <span className="word-text" style={{ fontSize: '18px' }}>{word.text}</span>
            </span>
          ))}
        </div>

        <button className="close-btn" style={{ marginTop: '20px' }} onClick={onClose}>Close</button>
      </div>
    </div>
  )
}
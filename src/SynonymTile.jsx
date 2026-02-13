import React, { useEffect, useState } from 'react'

let synonymsIndexPromise

const normalizeTerm = (term) => term.trim().toLowerCase()

const parseCsvToIndex = (csvText) => {
  const lines = csvText.split(/\r?\n/).filter(Boolean)
  if (lines.length === 0) return new Map()

  const header = lines[0].split(',')
  const lemmaIndex = header.indexOf('lemma')
  const synonymsIndex = header.indexOf('synonyms')

  const index = new Map()

  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i]
    const parts = line.split(',')
    const lemma = parts[lemmaIndex]
    const synonyms = parts[synonymsIndex]

    if (!lemma || !synonyms) continue

    const lemmaKey = normalizeTerm(lemma)
    const synList = synonyms
      .split('|')
      .flatMap((group) => group.split(';'))
      .map(normalizeTerm)
      .filter(Boolean)

    if (!index.has(lemmaKey)) {
      index.set(lemmaKey, new Set())
    }

    const existing = index.get(lemmaKey)
    synList.forEach((syn) => existing.add(syn))
  }

  return index
}

const loadSynonymsIndex = async () => {
  if (!synonymsIndexPromise) {
    synonymsIndexPromise = fetch('/synonyms.csv')
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load synonyms.csv (${response.status})`)
        }
        return response.text()
      })
      .then(parseCsvToIndex)
  }

  return synonymsIndexPromise
}

export default function SynonymTile({ word, onReplace, onRemove, onSelect }) {
  const [synonyms, setSynonyms] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!word) return

    const fetchSynonyms = async () => {
      setLoading(true)
      try {
        const index = await loadSynonymsIndex()
        const key = normalizeTerm(word)
        const list = index.get(key)
        const filtered = list
          ? Array.from(list)
              .filter((syn) => syn && syn !== key)
              .slice(0, 10)
          : []

        setSynonyms(filtered)
      } catch (error) {
        console.error('Error fetching synonyms:', error)
        setSynonyms([])
      } finally {
        setLoading(false)
      }
    }

    fetchSynonyms()
  }, [word])

  return (
    <div
      className="tile"
      style={{
      }}
      onClick={onSelect}
    >
      <button 
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }} 
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
              onClick={(e) => {
                e.stopPropagation()
                onReplace(syn)
              }}
              className="synonym-btn"
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
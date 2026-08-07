/**
 * Bubble.jsx — the "Analytic Bubble" sentence-structure overlay.
 *
 * Parses the selected sentence with a small probabilistic CNF grammar
 * (CKY algorithm) over compromise POS tags and renders the best parse
 * tree, so a writer can inspect a sentence's grammatical structure.
 * Opened from the editor context menu.
 */
import React, { useMemo } from "react"
import nlp from "compromise"
import "./Bubble.css"

/* ============================================================
   DEBUG
============================================================ */

const DEBUG = true
const log = (...args) => DEBUG && console.log(...args)

/* ============================================================
   STRUCTURAL CNF GRAMMAR (NO LEXICAL RULES HERE)
============================================================ */

const BASE_GRAMMAR = [
  { lhs: "S", rhs: ["NP", "VP"], prob: 0.9 },
  { lhs: "S", rhs: ["Interj", "S"], prob: 0.1 },

  { lhs: "VP", rhs: ["V", "NP"], prob: 0.25 },
  { lhs: "VP", rhs: ["V", "PP"], prob: 0.2 },
  { lhs: "VP", rhs: ["VP", "PP"], prob: 0.2 },
  { lhs: "VP", rhs: ["Aux", "VP"], prob: 0.25 },
  { lhs: "VP", rhs: ["V"], prob: 0.1 },

  /* NP rules */
  { lhs: "NP", rhs: ["DetN"], prob: 0.3 },
  { lhs: "NP", rhs: ["DetN", "S"], prob: 0.2 },   // ← allows “the day we met”
  { lhs: "NP", rhs: ["NP", "PP"], prob: 0.3 },
  { lhs: "NP", rhs: ["Pronoun"], prob: 0.2 },

  /* helper */
  { lhs: "DetN", rhs: ["Det", "N"], prob: 1.0 },

  /* PP rules */
  { lhs: "PP", rhs: ["P", "NP"], prob: 0.5 },
  { lhs: "PP", rhs: ["P", "S"], prob: 0.5 },

  { lhs: "Nom", rhs: ["Adj", "Nom"], prob: 0.3 },
{ lhs: "Nom", rhs: ["N"], prob: 0.7 },
{ lhs: "NP", rhs: ["Det", "Nom"], prob: 0.4 },
]



/* ============================================================
   POS → Grammar Mapping
============================================================ */

function tagToSymbols(tags) {
  const symbols = []

  if (tags.includes("Pronoun")) {
    symbols.push({ sym: "Pronoun", prob: 1.0 })
  }

  if (tags.includes("Determiner")) {
    symbols.push({ sym: "Det", prob: 1.0 })
  }

  if (tags.includes("Possessive")) {
    symbols.push({ sym: "Det", prob: 0.9 })   // his, her, their
  }

  if (tags.includes("Noun")) {
    symbols.push({ sym: "N", prob: 0.9 })
  }

  if (tags.includes("ProperNoun")) {
    symbols.push({ sym: "N", prob: 1.0 })
  }

  if (tags.includes("Verb")) {
    symbols.push({ sym: "V", prob: 0.8 })
  }

  if (tags.includes("PastTense")) {
    symbols.push({ sym: "V", prob: 0.9 })
  }

  if (tags.includes("Gerund")) {
    symbols.push({ sym: "V", prob: 0.9 })
  }

  if (tags.includes("Preposition")) {
    symbols.push({ sym: "P", prob: 1.0 })
  }

  if (tags.includes("Auxiliary")) {
    symbols.push({ sym: "Aux", prob: 1.0 })
  }

  if (tags.includes("Interjection")) {
    symbols.push({ sym: "Interj", prob: 1.0 })
  }

  // Soft ambiguity
  if (tags.includes("Noun")) {
    symbols.push({ sym: "V", prob: 0.1 })
  }

  if (tags.includes("Verb")) {
    symbols.push({ sym: "N", prob: 0.1 })
  }

  return symbols
}



function buildLexicalRules(cleanedSentence) {
  const doc = nlp(cleanedSentence)
  const terms = doc.terms().json()

  const lexicalRules = []

  terms.forEach(termObj => {
    const word = termObj.text
    const tags = Object.keys(termObj.tags || {})

    log("TAGS:", word, tags)

    const symbols = tagToSymbols(tags)

    // Fallback if compromise fails
    const finalSymbols =
      symbols.length > 0
        ? symbols
        : [{ sym: "N", prob: 0.4 }, { sym: "V", prob: 0.2 }]

    finalSymbols.forEach(({ sym, prob }) => {
      log("Lexical:", word, "→", sym, "p=", prob)
      lexicalRules.push({
        lhs: sym,
        rhs: [word],
        prob
      })
    })
  })

  return lexicalRules
}





/* ============================================================
   CKY PARSER (Ambiguous + Top-K)
============================================================ */
function ckyParse(sentence, maxParses = 5) {

  // 🔥 Normalize ONCE
  const cleaned = sentence
    .toLowerCase()
    .replace(/[^\w\s]/g, "")     // remove punctuation
    .replace(/\s+/g, " ")
    .trim()

  const words = cleaned.split(" ").filter(Boolean)

  log("CLEANED:", cleaned)
  log("WORDS:", words)

  // 🔥 Build lexical rules from CLEANED sentence
  const lexicalRules = buildLexicalRules(cleaned)

  const grammar = [...BASE_GRAMMAR, ...lexicalRules]
  const n = words.length

  const table = Array.from({ length: n }, () =>
    Array.from({ length: n + 1 }, () => new Map())
  )

  function addEntry(i, j, symbol, tree, prob) {
    if (!table[i][j].has(symbol)) table[i][j].set(symbol, [])
    table[i][j].get(symbol).push({ tree, prob })
  }

  function applyUnaryClosure(i, j) {
    let changed = true
    while (changed) {
      changed = false

      for (let rule of grammar) {
        if (rule.rhs.length !== 1) continue

        const B = rule.rhs[0]
        if (!table[i][j].has(B)) continue

        for (let entry of table[i][j].get(B)) {
          const newProb = entry.prob * rule.prob

          const newTree = {
            symbol: rule.lhs,
            children: [entry.tree]
          }

          const existing = table[i][j].get(rule.lhs) || []

          const exists = existing.some(
            e => JSON.stringify(e.tree) === JSON.stringify(newTree)
          )

          if (!exists) {
            addEntry(i, j, rule.lhs, newTree, newProb)
            changed = true
          }
        }
      }
    }
  }

  // Diagonal
  for (let i = 0; i < n; i++) {
    const word = words[i]

    for (let rule of grammar) {
      if (rule.rhs.length === 1 && rule.rhs[0] === word) {
        addEntry(i, i + 1, rule.lhs, {
          symbol: rule.lhs,
          children: [word]
        }, rule.prob)
      }
    }

    applyUnaryClosure(i, i + 1)
  }

  // Main CKY
  for (let span = 2; span <= n; span++) {
    for (let i = 0; i <= n - span; i++) {
      const j = i + span

      for (let k = i + 1; k < j; k++) {
        for (let rule of grammar) {
          if (rule.rhs.length !== 2) continue

          const [B, C] = rule.rhs
          if (!table[i][k].has(B) || !table[k][j].has(C)) continue

          for (let left of table[i][k].get(B)) {
            for (let right of table[k][j].get(C)) {
              const prob = left.prob + right.prob + Math.log(rule.prob)


              addEntry(i, j, rule.lhs, {
                symbol: rule.lhs,
                children: [left.tree, right.tree]
              }, prob)
            }
          }
        }
      }

      applyUnaryClosure(i, j)
    }
  }

  const parses = table[0][n].get("S") || []
  parses.sort((a, b) => b.prob - a.prob)

  log("FINAL PARSES:", parses)

  return parses.slice(0, maxParses)
}


/* ============================================================
   TREE VISUALIZER
============================================================ */

function TreeNode({ node }) {
  if (typeof node === "string") {
    return <span className="leaf">{node}</span>
  }

  return (
    <div className="tree-node">
      <div className="label">{node.symbol}</div>
      <div className="children">
        {node.children.map((child, i) => (
          <TreeNode key={i} node={child} />
        ))}
      </div>
    </div>
  )
}

/* ============================================================
   BUBBLE COMPONENT
============================================================ */

export default function Bubble({ sentence }) {
  const trees = useMemo(() => {
    if (!sentence) return []

    log("Parsing:", sentence)
    return ckyParse(sentence, 5)
  }, [sentence])

  return (
    <div className="bubble">
      {trees.length === 0 && <div>No parses found.</div>}

      {trees.map((t, i) => (
        <div key={i} className="parse">
          <div className="prob">
            Probability: {t.prob.toFixed(6)}
          </div>
          <TreeNode node={t.tree} />
        </div>
      ))}
    </div>
  )
}

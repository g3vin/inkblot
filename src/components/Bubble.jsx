/**
 * Bubble.jsx — the "Analytic Bubble" sentence-structure overlay.
 *
 * Parses the selected sentence with a small probabilistic CNF grammar
 * (CKY algorithm) over compromise POS tags and renders the best parse
 * tree, so a writer can inspect a sentence's grammatical structure.
 * Opened from the editor context menu.
 */
import React, { useMemo } from "react"
import { ckyParse } from "../lib/sentenceParse"
import "./Bubble.css"

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

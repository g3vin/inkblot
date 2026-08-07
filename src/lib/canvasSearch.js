/**
 * canvasSearch.js — finding text inside a canvas document.
 *
 * sidebarSearch's collectMatchesFromDocJson walks a ProseMirror document and reports
 * character offsets, because that is what a text editor can be told to jump to. A
 * canvas has no such positions: its text lives in independent cards, so a hit is
 * addressed by NODE ID, and revealing it means selecting and centering that node
 * rather than placing a caret.
 *
 * We read `node.text` — the plain-text projection the JSON Canvas spec asks every
 * card to carry — not `node.inkblotTipTap`. That keeps this a pure string walk (no
 * schema, no ProseMirror) and means a canvas authored in Obsidian is searchable too.
 * Cards written here keep the two in sync when they commit.
 */

const MATCH_PREVIEW_RADIUS = 34

const preview = (text, index, length) => {
  const start = Math.max(0, index - MATCH_PREVIEW_RADIUS)
  const end = Math.min(text.length, index + length + MATCH_PREVIEW_RADIUS)
  return text.slice(start, end).trim()
}

/** First line of a card, which is what identifies it in a list of results. */
const titleOf = (text, fallback) => {
  const firstLine = String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean)
  if (!firstLine) return fallback
  return firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine
}

/**
 * Every match for `query` in a canvas's raw (on-disk) JSON.
 *
 * `matcher` is a compiled matcher from sidebarSearch.createMatcher, so a canvas
 * honours the same case / whole-word / regex switches as every other scope.
 */
export function collectCanvasMatches(raw, matcher, docPath, { limit = Infinity } = {}) {
  if (!raw || !matcher || matcher.isEmpty || !matcher.valid) return []

  const matches = []

  const scan = (text, { nodeId, title }) => {
    const value = String(text || '')
    if (!value) return

    const remaining = limit - matches.length
    if (remaining <= 0) return

    matcher.findAll(value, remaining).forEach((hit) => {
      matches.push({
        id: `${docPath}-${nodeId}-${hit.index}`,
        type: 'canvas-match',
        docName: docPath,
        path: docPath,
        nodeId,
        title,
        preview: preview(value, hit.index, hit.length),
        matchText: hit.text,
      })
    })
  }

  const nodes = Array.isArray(raw.nodes) ? raw.nodes : []
  for (const node of nodes) {
    if (matches.length >= limit) break
    if (!node || typeof node !== 'object' || !node.id) continue

    if (node.type === 'group') {
      scan(node.label, { nodeId: node.id, title: node.label || 'Group' })
      continue
    }

    if (node.type === 'file') {
      // The path is the only text a file card has of its own; its document's
      // contents are searched under that document's own entry in the file list.
      scan(node.file, { nodeId: node.id, title: node.file || 'File' })
      continue
    }

    scan(node.text, { nodeId: node.id, title: titleOf(node.text, 'Card') })
  }

  const edges = Array.isArray(raw.edges) ? raw.edges : []
  for (const edge of edges) {
    if (matches.length >= limit) break
    if (!edge || typeof edge !== 'object' || !edge.id) continue
    // An edge label is revealed by centering the node it leaves from — an edge has
    // no position of its own, and its endpoints are the only thing selectable.
    scan(edge.label, { nodeId: edge.fromNode, title: edge.label || 'Arrow' })
  }

  return matches
}

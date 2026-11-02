/**
 * versionHistory.js — everything version history computes, none of what it stores.
 *
 * Storage (FileSystem.js) keeps version entries; this module gives them meaning:
 *   - the editing-session identity and its color (the single-user analogue of
 *     "which collaborator made this edit")
 *   - word counting and text extraction from either document kind
 *   - the diff engine: word-level token diff, paragraph-level block diff for
 *     side-by-side compare/merge, and a card-level diff for canvases
 *   - time grouping (day sections, then bursts of edits) for the condensed view
 *   - merge builders that turn per-chunk / per-card choices into a new document
 *
 * All pure (DOMParser aside) — nothing here touches the filesystem or React.
 *
 * Mirrors: `src-tauri/crates/inkblot-core/src/version_history.rs`; `npm run parity` asserts they agree.
 */
import { countMapWords } from './map/mapModel'
import { INKS, inkVar } from './palette'

/* ============================================================
   Editing sessions
   ============================================================ */

/**
 * One id per app launch. Every checkpoint written this session carries it, so
 * the panel can color-code edits by sitting — the desktop stand-in for Google
 * Docs' per-collaborator colors.
 */
export const EDIT_SESSION_ID = (() => {
  try {
    return crypto.randomUUID()
  } catch {
    return `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  }
})()

/** Stable session → hue. Same session, same color, across reloads of the panel. */
export const sessionColor = (sessionId) => {
  if (!sessionId) return 'var(--text-subtle)'
  let hash = 0
  const str = String(sessionId)
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0
  }
  return inkVar(INKS[Math.abs(hash) % INKS.length].id)
}

/* ============================================================
   Text extraction and word counts
   ============================================================ */

const BLOCK_TAG_RE = /<\/(p|h[1-6]|li|blockquote|pre|div|tr)>|<br\s*\/?>/gi

/** HTML → plain text, with block boundaries becoming line breaks. */
export const htmlToText = (html) => {
  if (!html) return ''
  return String(html)
    .replace(BLOCK_TAG_RE, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
}

export const textWords = (text) => String(text || '').split(/\s+/).filter(Boolean)

export const countWords = (htmlOrText, isHtml = true) =>
  textWords(isHtml ? htmlToText(htmlOrText) : htmlOrText).length

/** Words on a canvas: everything typed into cards, labels, and edge labels. */
export const countCanvasWords = (canvas) => {
  if (!canvas) return 0
  let total = 0
  for (const node of canvas.nodes || []) {
    if (node?.text) total += textWords(node.text).length
    if (node?.label) total += textWords(node.label).length
  }
  for (const edge of canvas.edges || []) {
    if (edge?.label) total += textWords(edge.label).length
  }
  return total
}

/** Words in a version entry, whichever kind it is (older entries lack `words`). */
export const versionWords = (entry) => {
  if (!entry) return 0
  if (Number.isFinite(entry.words)) return entry.words
  if (entry.canvas) return countCanvasWords(entry.canvas)
  if (entry.map) return countMapWords(entry.map)
  return countWords(entry.contentHtml || '')
}

/* ============================================================
   Token diff (word level)
   ============================================================ */

// Above this many DP cells the middle is treated as a plain replace: edits in
// prose are local, so the prefix/suffix trim almost always keeps us under it.
const LCS_CELL_LIMIT = 400_000

/**
 * Diff two token arrays into runs: [{ type: 'equal'|'added'|'removed', tokens }].
 * Common prefix/suffix are trimmed first; the middle gets a real LCS when it is
 * small enough and a whole-run replace when it is not.
 */
export function diffTokens(aTokens, bTokens) {
  const a = aTokens || []
  const b = bTokens || []

  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++

  let end = 0
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  ) end++

  const midA = a.slice(start, a.length - end)
  const midB = b.slice(start, b.length - end)

  const ops = []
  const push = (type, tokens) => {
    if (!tokens.length) return
    const last = ops[ops.length - 1]
    if (last && last.type === type) last.tokens = last.tokens.concat(tokens)
    else ops.push({ type, tokens })
  }

  push('equal', a.slice(0, start))

  if (!midA.length || !midB.length || midA.length * midB.length > LCS_CELL_LIMIT) {
    push('removed', midA)
    push('added', midB)
  } else {
    // Standard LCS table over the trimmed middles, walked back into runs.
    const rows = midA.length + 1
    const cols = midB.length + 1
    const table = new Uint32Array(rows * cols)
    for (let i = 1; i < rows; i++) {
      for (let j = 1; j < cols; j++) {
        table[i * cols + j] = midA[i - 1] === midB[j - 1]
          ? table[(i - 1) * cols + (j - 1)] + 1
          : Math.max(table[(i - 1) * cols + j], table[i * cols + (j - 1)])
      }
    }

    const reversed = []
    let i = midA.length
    let j = midB.length
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && midA[i - 1] === midB[j - 1]) {
        reversed.push({ type: 'equal', token: midA[i - 1] })
        i--; j--
      } else if (j > 0 && (i === 0 || table[i * cols + (j - 1)] >= table[(i - 1) * cols + j])) {
        reversed.push({ type: 'added', token: midB[j - 1] })
        j--
      } else {
        reversed.push({ type: 'removed', token: midA[i - 1] })
        i--
      }
    }
    for (let k = reversed.length - 1; k >= 0; k--) {
      push(reversed[k].type, [reversed[k].token])
    }
  }

  push('equal', end ? a.slice(a.length - end) : [])
  return ops
}

/** Word diff of two plain texts. */
export const diffWords = (aText, bText) => diffTokens(textWords(aText), textWords(bText))

/** How many words a change added and removed. */
export function wordDelta(aText, bText) {
  let added = 0
  let removed = 0
  for (const op of diffWords(aText, bText)) {
    if (op.type === 'added') added += op.tokens.length
    else if (op.type === 'removed') removed += op.tokens.length
  }
  return { added, removed }
}

/* ============================================================
   Block diff (paragraph level, for side-by-side compare/merge)
   ============================================================ */

/**
 * Split rendered HTML into its top-level blocks. Each block keeps its exact
 * HTML (so a merge preserves formatting) plus a normalized text key for
 * matching. Loose text outside any element becomes a paragraph.
 */
export function htmlToBlocks(html) {
  if (!html) return []
  const doc = new DOMParser().parseFromString(String(html), 'text/html')
  const blocks = []

  for (const node of doc.body.childNodes) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const text = (node.textContent || '').replace(/\s+/g, ' ').trim()
      blocks.push({ html: node.outerHTML, text })
    } else if (node.nodeType === Node.TEXT_NODE) {
      const raw = node.textContent || ''
      if (raw.trim()) blocks.push({ html: `<p>${raw}</p>`, text: raw.replace(/\s+/g, ' ').trim() })
    }
  }

  return blocks
}

/**
 * Diff two block lists into aligned chunks for a two-column view:
 *   { type: 'equal',   blocks }             — identical run
 *   { type: 'changed', left, right }        — left was replaced by right
 * (left or right may be empty: pure deletion / pure insertion.)
 */
export function diffBlockLists(aBlocks, bBlocks) {
  const ops = diffTokens(aBlocks.map((b) => b.text), bBlocks.map((b) => b.text))

  const chunks = []
  let ai = 0
  let bi = 0
  const pushChanged = (left, right) => {
    const last = chunks[chunks.length - 1]
    if (last && last.type === 'changed') {
      last.left = last.left.concat(left)
      last.right = last.right.concat(right)
    } else {
      chunks.push({ type: 'changed', left, right })
    }
  }

  for (const op of ops) {
    const count = op.tokens.length
    if (op.type === 'equal') {
      chunks.push({ type: 'equal', blocks: bBlocks.slice(bi, bi + count) })
      ai += count
      bi += count
    } else if (op.type === 'removed') {
      pushChanged(aBlocks.slice(ai, ai + count), [])
      ai += count
    } else {
      pushChanged([], bBlocks.slice(bi, bi + count))
      bi += count
    }
  }

  return chunks
}

/** Two versions' HTML compared block by block: the chunks the compare view shows. */
export const diffHtmlDocuments = (aHtml, bHtml) =>
  diffBlockLists(htmlToBlocks(aHtml), htmlToBlocks(bHtml))

/**
 * Build merged HTML from compare chunks and the user's per-chunk choices.
 * `choices[i]` is 'left' | 'right' | 'both' (default 'right'); equal chunks
 * pass through untouched.
 */
export function mergeChunksToHtml(chunks, choices = {}) {
  const parts = []
  chunks.forEach((chunk, index) => {
    if (chunk.type === 'equal') {
      for (const block of chunk.blocks) parts.push(block.html)
      return
    }
    const choice = choices[index] || 'right'
    if (choice === 'left' || choice === 'both') {
      for (const block of chunk.left) parts.push(block.html)
    }
    if (choice === 'right' || choice === 'both') {
      for (const block of chunk.right) parts.push(block.html)
    }
  })
  return parts.join('') || '<p></p>'
}

/* ============================================================
   Canvas diff (card level)
   ============================================================ */

const canvasNodesById = (canvas) => {
  const map = new Map()
  for (const node of canvas?.nodes || []) {
    if (node?.id) map.set(node.id, node)
  }
  return map
}

/** What a card says, for previews and text diffs. */
export const canvasNodeText = (node) => {
  if (!node) return ''
  if (node.text) return node.text
  if (node.label) return node.label
  if (node.url) return node.url
  if (node.file) return String(node.file).split('/').pop() || node.file
  return ''
}

const CONTENT_KEYS = ['text', 'inkblotTipTap', 'label', 'file', 'url', 'color', 'inkblotNoteId']
const nodeContentChanged = (a, b) =>
  CONTENT_KEYS.some((key) => JSON.stringify(a?.[key] ?? null) !== JSON.stringify(b?.[key] ?? null))
const nodeMoved = (a, b) =>
  a.x !== b.x || a.y !== b.y || a.width !== b.width || a.height !== b.height

/**
 * Card-level diff of two serialized canvases (left = older, right = newer):
 *   added / removed  — cards present on only one side
 *   edited           — same card, different content (text, color, target…)
 *   moved            — same card, same content, different geometry
 * plus added/removed edges. Geometry-only changes are kept apart from edits so
 * the panel can say "3 cards moved" without burying real writing changes.
 */
export function diffCanvases(left, right) {
  const leftNodes = canvasNodesById(left)
  const rightNodes = canvasNodesById(right)

  const added = []
  const removed = []
  const edited = []
  const moved = []

  for (const [id, node] of rightNodes) {
    const before = leftNodes.get(id)
    if (!before) added.push(node)
    else if (nodeContentChanged(before, node)) edited.push({ before, after: node })
    else if (nodeMoved(before, node)) moved.push({ before, after: node })
  }
  for (const [id, node] of leftNodes) {
    if (!rightNodes.has(id)) removed.push(node)
  }

  const leftEdgeIds = new Set((left?.edges || []).map((e) => e?.id).filter(Boolean))
  const rightEdgeIds = new Set((right?.edges || []).map((e) => e?.id).filter(Boolean))
  const edgesAdded = (right?.edges || []).filter((e) => e?.id && !leftEdgeIds.has(e.id))
  const edgesRemoved = (left?.edges || []).filter((e) => e?.id && !rightEdgeIds.has(e.id))

  return { added, removed, edited, moved, edgesAdded, edgesRemoved }
}

export const canvasDiffIsEmpty = (diff) =>
  !diff.added.length && !diff.removed.length && !diff.edited.length &&
  !diff.moved.length && !diff.edgesAdded.length && !diff.edgesRemoved.length

/** One-line summary for a condensed history row: "+2 cards · 1 edited · 3 moved". */
export function describeCanvasDiff(diff) {
  const parts = []
  if (diff.added.length) parts.push(`+${diff.added.length} card${diff.added.length === 1 ? '' : 's'}`)
  if (diff.removed.length) parts.push(`−${diff.removed.length} card${diff.removed.length === 1 ? '' : 's'}`)
  if (diff.edited.length) parts.push(`${diff.edited.length} edited`)
  if (diff.moved.length) parts.push(`${diff.moved.length} moved`)
  const edgeCount = diff.edgesAdded.length + diff.edgesRemoved.length
  if (edgeCount) parts.push(`${edgeCount} arrow${edgeCount === 1 ? '' : 's'}`)
  return parts.join(' · ') || 'No card changes'
}

/**
 * Merge two canvases from per-change decisions. The result starts as the RIGHT
 * side; each decision key flips one change back to the left side:
 *   added:<id>    take 'left'  → drop the card right added
 *   removed:<id>  take 'left'  → bring back the card right deleted
 *   edited:<id>   take 'left'  → keep the older card content
 *   moved:<id>    take 'left'  → keep the older position
 * Edges survive when both endpoints do; edge add/removes follow the same keys.
 */
export function mergeCanvases(left, right, diff, decisions = {}) {
  const take = (key) => decisions[key] === 'left'
  const nodes = []

  for (const node of right?.nodes || []) {
    const addedHere = diff.added.some((n) => n.id === node.id)
    if (addedHere && take(`added:${node.id}`)) continue

    const edit = diff.edited.find((e) => e.after.id === node.id)
    if (edit && take(`edited:${node.id}`)) {
      nodes.push(edit.before)
      continue
    }

    const move = diff.moved.find((m) => m.after.id === node.id)
    if (move && take(`moved:${node.id}`)) {
      nodes.push(move.before)
      continue
    }

    nodes.push(node)
  }

  for (const node of diff.removed) {
    if (take(`removed:${node.id}`)) nodes.push(node)
  }

  const nodeIds = new Set(nodes.map((n) => n.id))
  const edges = []
  const seenEdges = new Set()
  const pushEdge = (edge) => {
    if (!edge?.id || seenEdges.has(edge.id)) return
    if (!nodeIds.has(edge.fromNode) || !nodeIds.has(edge.toNode)) return
    seenEdges.add(edge.id)
    edges.push(edge)
  }

  for (const edge of right?.edges || []) {
    if (diff.edgesAdded.some((e) => e.id === edge.id) && take(`edgeAdded:${edge.id}`)) continue
    pushEdge(edge)
  }
  for (const edge of diff.edgesRemoved) {
    if (take(`edgeRemoved:${edge.id}`)) pushEdge(edge)
  }

  return {
    ...(right || {}),
    nodes,
    edges,
  }
}

/* ============================================================
   Time grouping (the condensed view)
   ============================================================ */

// Edits closer together than this belong to the same burst of writing.
const GROUP_GAP_MS = 15 * 60 * 1000

const dayKeyOf = (date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`

export function formatDayLabel(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return String(iso || '')

  const today = new Date()
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)
  if (dayKeyOf(date) === dayKeyOf(today)) return 'Today'
  if (dayKeyOf(date) === dayKeyOf(yesterday)) return 'Yesterday'

  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  })
}

export function formatTime(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return String(iso || '')
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export function formatFullTimestamp(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return String(iso || '')
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  })
}

/**
 * Fold a newest-first version list into day sections of edit bursts:
 *
 *   [{ dayKey, dayLabel, groups: [{ key, entries }] }]
 *
 * A group breaks on a new day, a >15-minute silence, or a different editing
 * session. Named versions always stand alone — they are landmarks, and folding
 * "Final Submission" into a burst of autosaves would hide the point of naming it.
 */
export function groupVersions(versions) {
  const sections = []
  let section = null
  let group = null
  let prevTime = null
  let prevSession = null

  for (const entry of versions || []) {
    const time = new Date(entry.timestamp || 0)
    const key = dayKeyOf(time)

    if (!section || section.dayKey !== key) {
      section = { dayKey: key, dayLabel: formatDayLabel(entry.timestamp), groups: [] }
      sections.push(section)
      group = null
    }

    const isNamed = Boolean(entry.name)
    const gap = prevTime ? Math.abs(prevTime - time.getTime()) : Infinity
    const sameSession = (entry.sessionId || null) === prevSession

    if (isNamed || !group || group.named || gap > GROUP_GAP_MS || !sameSession) {
      group = { key: `${entry.id}`, entries: [entry], named: isNamed }
      section.groups.push(group)
    } else {
      group.entries.push(entry)
    }

    prevTime = time.getTime()
    prevSession = entry.sessionId || null
  }

  return sections
}

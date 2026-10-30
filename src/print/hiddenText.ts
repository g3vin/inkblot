/**
 * hiddenText.ts — what a printed or exported document leaves out: text the writer hid
 * (extensions/HiddenText.js). Applied where chapters are loaded for print and export
 * (compile.ts), so every format leaves it out alike.
 */

interface JsonNode {
  type?: string
  text?: string
  marks?: { type: string }[]
  content?: JsonNode[]
  [key: string]: unknown
}

const isHidden = (node: JsonNode) => node.type === 'text' && Boolean(node.marks?.some((mark) => mark.type === 'hiddenText'))

// A table's cells keep their place when everything in one is hidden: dropping a cell
// would leave its row short.
const CELLS = new Set(['tableCell', 'tableHeader'])

/** `node` without its hidden text; null when hiding emptied it. */
function strip(node: JsonNode): JsonNode | null {
  if (!Array.isArray(node.content)) return node
  let changed = false
  const content: JsonNode[] = []
  for (const child of node.content) {
    if (isHidden(child)) { changed = true; continue }
    const next = strip(child)
    if (next !== child) changed = true
    if (next) content.push(next)
  }
  if (!changed) return node
  // A block that hiding emptied goes with it; one that was empty already stays.
  if (!content.length && node.type !== 'doc') {
    return CELLS.has(node.type ?? '') ? { ...node, content: [{ type: 'paragraph' }] } : null
  }
  return { ...node, content }
}

/** A document's TipTap JSON with the hidden text taken out. Untouched if there is none. */
export function withoutHiddenText<T>(doc: T): T {
  if (!doc || typeof doc !== 'object') return doc
  return (strip(doc as JsonNode) ?? { ...(doc as JsonNode), content: [] }) as T
}

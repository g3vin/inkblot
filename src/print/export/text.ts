/**
 * text.ts — a document or a book as plain text, for a submission form, an email, or
 * anything that takes words and nothing else.
 *
 * Paragraphs are separated by a blank line; headings stand alone, a scene break is the
 * setup's glyph, centred; lists keep their bullets and numbers; a table is its rows,
 * cells separated by tabs. Lines are wrapped at `wrap` columns when asked (72 is the
 * email convention), and never when not — a form reflows text itself.
 */
import { portableContent } from './portable'
import type { PMJSON } from './portable'

export interface TextOptions {
  /** Wrap lines at this many columns; 0 leaves every paragraph one line. */
  wrap?: number
  sceneBreak?: string
}

const inlineText = (nodes: PMJSON[] = []): string => nodes.map((node) => {
  if (node.type === 'text') return node.text || ''
  if (node.type === 'hardBreak') return '\n'
  if (node.type === 'image') return '[Image]'
  if (node.type === 'citation') return String(node.attrs?.rendered || '').replace(/<[^>]*>/g, '')
  return inlineText(node.content)
}).join('')

/** Greedy word wrap, each line after the first starting with `indent`. */
export const wrapText = (text: string, width: number, first = '', indent = first.replace(/./g, ' ')): string => {
  if (!width) return text.split('\n').map((line, i) => (i === 0 ? first : indent) + line).join('\n')
  const out: string[] = []
  text.split('\n').forEach((hard, h) => {
    let line = h === 0 ? first : indent
    let empty = true
    for (const word of hard.split(/ +/).filter(Boolean)) {
      if (!empty && line.length + 1 + word.length > width) {
        out.push(line)
        line = indent + word
      } else {
        line += (empty ? '' : ' ') + word
      }
      empty = false
    }
    out.push(line)
  })
  return out.join('\n')
}

const center = (text: string, width: number): string => {
  const pad = Math.max(0, Math.floor(((width || 72) - text.length) / 2))
  return ' '.repeat(pad) + text
}

const blockText = (node: PMJSON, options: Required<TextOptions>, prefix = ''): string[] => {
  const { wrap } = options
  switch (node.type) {
    case 'paragraph': {
      const text = inlineText(node.content)
      return [wrapText(text, wrap, prefix)]
    }
    case 'heading':
      return [wrapText(inlineText(node.content), wrap, prefix)]
    case 'blockquote':
      return (node.content || []).flatMap((child) => blockText(child, options, `${prefix}    `))
    case 'bulletList':
    case 'orderedList': {
      const start = Number(node.attrs?.start) || 1
      return (node.content || []).flatMap((item, i) => {
        const marker = node.type === 'orderedList' ? `${start + i}. ` : '- '
        const [first, ...rest] = item.content || []
        const lead = first ? blockText(first, options, prefix + marker) : [prefix + marker.trimEnd()]
        const inner = prefix + ' '.repeat(marker.length)
        return [...lead, ...rest.flatMap((child) => blockText(child, options, inner))]
      })
    }
    case 'codeBlock':
      return [(node.content || []).map((n) => n.text || '').join('').split('\n').map((l) => prefix + l).join('\n')]
    case 'horizontalRule':
      return [center(options.sceneBreak, wrap)]
    case 'image':
      return [`${prefix}[Image]`]
    case 'pageBreak':
      return []
    case 'table':
      return [(node.content || []).map((row) => (row.content || []).map((cell) => inlineText((cell.content || []).flatMap((p) => p.content || []))).join('\t')).join('\n')]
    case 'bibliography': {
      const lines = [String(node.attrs?.title || 'References')]
      for (const entry of (node.attrs?.entries as Array<{ html?: string }>) || []) {
        lines.push(wrapText(String(entry?.html || '').replace(/<[^>]*>/g, ''), wrap))
      }
      return lines
    }
    default:
      return (node.content || []).flatMap((child) => blockText(child, options, prefix))
  }
}

/* ---- a script, laid out as a typewriter would: columns of a 60-character line ---- */

export interface ScriptColumns { left: number; width: number; upper?: boolean; align?: 'right' | 'center'; before?: boolean }

export const SCRIPT_COLUMNS: Record<string, ScriptColumns> = {
  sceneHeading: { left: 0, width: 60, upper: true, before: true },
  action: { left: 0, width: 60, before: true },
  shot: { left: 0, width: 60, upper: true, before: true },
  character: { left: 22, width: 38, upper: true, before: true },
  parenthetical: { left: 16, width: 25 },
  dialogue: { left: 10, width: 35 },
  transition: { left: 0, width: 60, upper: true, align: 'right', before: true },
  centered: { left: 0, width: 60, align: 'center', before: true },
  actHeading: { left: 0, width: 60, upper: true, align: 'center', before: true },
  sceneTitle: { left: 0, width: 60, upper: true, align: 'center', before: true },
  stageCharacter: { left: 0, width: 60, upper: true, align: 'center', before: true },
  stageDialogue: { left: 0, width: 60 },
  stageDirection: { left: 25, width: 35, before: true },
}

const scriptText = (doc: PMJSON): string => {
  const out: string[] = []
  for (const node of doc.content || []) {
    if (node.type === 'pageBreak') continue
    const spec = SCRIPT_COLUMNS[String(node.attrs?.element)] || SCRIPT_COLUMNS.action
    let text = inlineText(node.content)
    if (spec.upper) text = text.toUpperCase()
    const lines = wrapText(text, spec.width).split('\n').map((l) => {
      if (spec.align === 'right') return ' '.repeat(Math.max(0, 60 - l.length)) + l
      if (spec.align === 'center') return center(l, 60)
      return ' '.repeat(spec.left) + l
    })
    if (spec.before && out.length) out.push('')
    out.push(...lines)
  }
  return out.join('\n')
}

/** One document's content as plain text. */
export const toPlainText = (content: PMJSON, options: TextOptions = {}): string => {
  const settled: Required<TextOptions> = { wrap: options.wrap ?? 0, sceneBreak: options.sceneBreak || '* * *' }
  const doc = portableContent(content)
  const format = doc.attrs?.writingFormat
  if (format === 'screenplay' || format === 'stageplay') return scriptText(doc).replace(/[ \t]+$/gm, '')
  return (doc.content || []).flatMap((node) => blockText(node, settled)).join('\n\n').replace(/[ \t]+$/gm, '')
}

/** Chapters (and the front matter, as text) joined into one file. */
export const buildPlainText = (parts: PMJSON[], options: TextOptions = {}): string => (
  `${parts.map((part) => toPlainText(part, options)).filter(Boolean).join('\n\n\n')}\n`
)

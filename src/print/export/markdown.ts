/**
 * markdown.ts — TipTap JSON to GitHub-flavoured Markdown.
 *
 * Written against the document's JSON rather than its HTML, so structure survives
 * exactly: nested lists keep their depth, an ordered list keeps its start number,
 * tables become GFM tables. What Markdown has no syntax for is written as the small
 * inline HTML every Markdown renderer passes through: underline as <u>, a page
 * break as a div with `break-after: page`. Highlight uses `==text==`, which most
 * editors (Obsidian, Typora, iA Writer) read.
 *
 * Images are handed to `imageSrc`, which the exporter uses to write each embedded
 * image out as a file beside the Markdown and link it relatively.
 */
import type { PMJSON } from './portable'

export interface MarkdownOptions {
  imageSrc?: (src: string) => string
}

const escapeText = (value: string): string => value
  .replace(/\\/g, '\\\\')
  .replace(/([*_`[\]<>~])/g, '\\$1')

/** Characters that would start a block construct at the head of a line. */
const escapeLineStart = (line: string): string => line
  .replace(/^(\s*)([#>+-])(?=\s|$)/, '$1\\$2')
  .replace(/^(\s*)(\d+)([.)])(?=\s)/, '$1$2\\$3')

const MARK_ORDER = ['link', 'bold', 'italic', 'strike', 'underline', 'highlight', 'code']

const wrapMarks = (value: string, marks: PMJSON['marks'] = []): string => {
  const types = new Map(marks.map((m) => [m.type, m]))
  if (types.has('code')) {
    const fence = value.includes('`') ? '``' : '`'
    return `${fence}${value}${fence}`
  }
  // Emphasis markers cannot touch whitespace on their inner side: move it outside.
  const lead = value.match(/^\s*/)?.[0] || ''
  const trail = value.slice(lead.length).match(/\s*$/)?.[0] || ''
  let core = escapeText(value.slice(lead.length, value.length - trail.length))
  if (!core) return value
  for (const type of [...MARK_ORDER].reverse()) {
    if (!types.has(type)) continue
    if (type === 'bold') core = `**${core}**`
    else if (type === 'italic') core = `*${core}*`
    else if (type === 'strike') core = `~~${core}~~`
    else if (type === 'underline') core = `<u>${core}</u>`
    else if (type === 'highlight') core = `==${core}==`
    else if (type === 'link') {
      const href = String(types.get('link')?.attrs?.href || '')
      core = `[${core}](${href.replace(/\)/g, '%29').replace(/ /g, '%20')})`
    }
  }
  return `${lead}${core}${trail}`
}

const inline = (nodes: PMJSON[] = [], options: MarkdownOptions): string => nodes.map((node) => {
  if (node.type === 'text') return wrapMarks(node.text || '', node.marks)
  if (node.type === 'hardBreak') return '  \n'
  if (node.type === 'image') {
    const src = String(node.attrs?.src || '')
    const alt = String(node.attrs?.alt || node.attrs?.title || '').replace(/[[\]]/g, '')
    return `![${alt}](${(options.imageSrc ? options.imageSrc(src) : src).replace(/ /g, '%20')})`
  }
  return inline(node.content, options)
}).join('')

const indent = (text: string, prefix: string, first = prefix): string => text
  .split('\n')
  .map((line, i) => (line ? (i === 0 ? first : prefix) + line : line))
  .join('\n')

const cellText = (cell: PMJSON, options: MarkdownOptions): string => (cell.content || [])
  .map((block) => inline(block.content, options))
  .join('<br>')
  .replace(/\|/g, '\\|')
  .replace(/\n/g, ' ')

const table = (node: PMJSON, options: MarkdownOptions): string => {
  const rows = (node.content || []).map((row) => (row.content || []).map((cell) => cellText(cell, options)))
  if (!rows.length) return ''
  const width = Math.max(...rows.map((r) => r.length))
  const pad = (r: string[]) => [...r, ...Array(width - r.length).fill('')]
  const [head, ...body] = rows
  const line = (r: string[]) => `| ${pad(r).join(' | ')} |`
  return [line(head), `| ${Array(width).fill('---').join(' | ')} |`, ...body.map(line)].join('\n')
}

const block = (node: PMJSON, options: MarkdownOptions): string => {
  switch (node.type) {
    case 'paragraph': {
      const out = inline(node.content, options)
      return out.split('\n').map(escapeLineStart).join('\n')
    }
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level) || 1))
      return `${'#'.repeat(level)} ${inline(node.content, options)}`
    }
    case 'blockquote':
      return indent(blocks(node.content, options), '> ').replace(/^$/gm, '>')
    case 'bulletList':
      return (node.content || []).map((item) => listItem(item, '- ', options)).join('\n')
    case 'orderedList': {
      const start = Number(node.attrs?.start) || 1
      return (node.content || []).map((item, i) => listItem(item, `${start + i}. `, options)).join('\n')
    }
    case 'codeBlock': {
      const code = (node.content || []).map((t) => t.text || '').join('')
      const fence = code.includes('```') ? '~~~' : '```'
      return `${fence}${node.attrs?.language || ''}\n${code}\n${fence}`
    }
    case 'horizontalRule':
      return '---'
    case 'table':
      return table(node, options)
    case 'pageBreak':
      return '<div style="break-after: page"></div>'
    default:
      return node.content ? blocks(node.content, options) : ''
  }
}

const listItem = (item: PMJSON, marker: string, options: MarkdownOptions): string => {
  const body = blocks(item.content, options, '\n')
  return indent(body, ' '.repeat(marker.length), marker)
}

const blocks = (nodes: PMJSON[] = [], options: MarkdownOptions, separator = '\n\n'): string => nodes
  .map((node) => block(node, options))
  .filter((text) => text !== '')
  .join(separator)

export const toMarkdown = (doc: PMJSON, options: MarkdownOptions = {}): string => `${blocks(doc.content, options).trimEnd()}\n`

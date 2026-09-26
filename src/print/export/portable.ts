/**
 * portable.ts — a document with Inkblot's own nodes turned into ordinary ones, for
 * formats that cannot hold them.
 *
 * A Pinterest board is a live embed and a conversation tile is an interactive
 * mock-up of a chat; Markdown, EPUB and a standalone HTML file cannot run either.
 * What they can carry is what the author put in them: the board's link, and the
 * conversation as a transcript — who said what, in order.
 */

export interface PMJSON {
  type: string
  attrs?: Record<string, unknown>
  content?: PMJSON[]
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>
  text?: string
}

interface Message { sender?: string; name?: string; text?: string; timestamp?: string }

const text = (value: string, marks?: PMJSON['marks']): PMJSON => ({ type: 'text', text: value, ...(marks ? { marks } : {}) })

const conversationToBlocks = (attrs: Record<string, unknown> = {}): PMJSON => {
  const messages = Array.isArray(attrs.messages) ? (attrs.messages as Message[]) : []
  const participants = (attrs.participants || {}) as Record<string, string>
  const paragraphs: PMJSON[] = messages
    .filter((m) => m && typeof m.text === 'string' && m.text.trim())
    .map((m) => {
      const who = m.name || participants[m.sender || ''] || (m.sender === 'you' ? 'You' : 'Them')
      return { type: 'paragraph', content: [text(`${who}: `, [{ type: 'bold' }]), text(String(m.text))] }
    })
  return { type: 'blockquote', attrs: { 'data-conversation': true }, content: paragraphs.length ? paragraphs : [{ type: 'paragraph' }] }
}

const pinterestToBlock = (attrs: Record<string, unknown> = {}): PMJSON => {
  const url = typeof attrs.url === 'string' ? attrs.url : ''
  if (!url) return { type: 'paragraph' }
  return {
    type: 'paragraph',
    content: [text('Pinterest board: '), text(url, [{ type: 'link', attrs: { href: url } }])],
  }
}

/** A deep copy of `node` with every non-portable node replaced. */
export const portableContent = (node: PMJSON): PMJSON => {
  if (node.type === 'conversationTile') return conversationToBlocks(node.attrs)
  if (node.type === 'pinterestBoard') return pinterestToBlock(node.attrs)
  const out: PMJSON = { ...node }
  if (node.content) out.content = node.content.map(portableContent)
  return out
}

/** A chapter head's pictures: the ornament's and the chapter's own. */
const HEAD_IMAGES = ['ornamentImage', 'image'] as const

/** Every image src in a document, in order — a chapter head's pictures among them. */
export const collectImageSources = (node: PMJSON, out: string[] = []): string[] => {
  if (node.type === 'image' && typeof node.attrs?.src === 'string') out.push(node.attrs.src as string)
  if (node.type === 'chapterHead') {
    const head = (node.attrs?.head || {}) as Record<string, unknown>
    for (const key of HEAD_IMAGES) if (typeof head[key] === 'string' && head[key]) out.push(head[key] as string)
  }
  for (const child of node.content || []) collectImageSources(child, out)
  return out
}

/** A copy of `node` with image srcs rewritten. */
export const mapImageSources = (node: PMJSON, map: (src: string) => string): PMJSON => {
  const out: PMJSON = { ...node }
  if (node.type === 'image' && typeof node.attrs?.src === 'string') out.attrs = { ...node.attrs, src: map(node.attrs.src as string) }
  if (node.type === 'chapterHead') {
    const head = { ...((node.attrs?.head || {}) as Record<string, unknown>) }
    for (const key of HEAD_IMAGES) if (typeof head[key] === 'string' && head[key]) head[key] = map(head[key] as string)
    out.attrs = { ...node.attrs, head }
  }
  if (node.content) out.content = node.content.map((child) => mapImageSources(child, map))
  return out
}

const plain = (value: string): PMJSON => ({ type: 'text', text: value })

/**
 * A document with each chapter head set as plain blocks — its number and title as a
 * heading, its subtitle, pictures and epigraph under it — for a format with no way to
 * draw the head itself: Markdown, plain text, Word.
 */
export const headsToBlocks = (doc: PMJSON): PMJSON => {
  if (!doc.content?.some((n) => n.type === 'chapterHead')) return doc
  const content: PMJSON[] = []
  for (const node of doc.content) {
    if (node.type !== 'chapterHead') {
      content.push(node)
      continue
    }
    const head = (node.attrs?.head || {}) as Record<string, string | undefined>
    const picture = (src?: string): PMJSON[] => (src ? [{ type: 'paragraph', attrs: { textAlign: 'center' }, content: [{ type: 'image', attrs: { src } }] }] : [])
    const ornament = head.ornament === 'glyph' && head.ornamentGlyph
      ? [{ type: 'paragraph', attrs: { textAlign: 'center' }, content: [plain(head.ornamentGlyph)] }]
      : head.ornament === 'image' ? picture(head.ornamentImage) : []
    const inline: PMJSON[] = []
    if (head.label) inline.push(plain(head.label))
    if (head.label && head.title) inline.push({ type: 'hardBreak' })
    if (head.title) inline.push(plain(head.title))
    if (head.ornamentPosition !== 'below') content.push(...ornament, ...picture(head.image))
    if (inline.length) content.push({ type: 'heading', attrs: { level: 1, textAlign: head.alignment === 'center' ? 'center' : null }, content: inline })
    if (head.subtitle) content.push({ type: 'paragraph', attrs: { textAlign: 'center' }, content: [{ type: 'text', text: head.subtitle, marks: [{ type: 'italic' }] }] })
    if (head.ornamentPosition === 'below') content.push(...ornament, ...picture(head.image))
    if (head.epigraph) {
      const quote: PMJSON[] = [{ type: 'paragraph', content: [{ type: 'text', text: head.epigraph, marks: [{ type: 'italic' }] }] }]
      if (head.epigraphSource) quote.push({ type: 'paragraph', content: [plain(`— ${head.epigraphSource}`)] })
      content.push({ type: 'blockquote', content: quote })
    }
  }
  return { ...doc, content }
}

/** The document's plain text title: its head, or its first heading, or null. */
export const firstHeadingText = (doc: PMJSON): string | null => {
  const head = (doc.content || []).find((n) => n.type === 'chapterHead')
  if (head) {
    const h = (head.attrs?.head || {}) as Record<string, string | undefined>
    return [h.label, h.title].filter(Boolean).join(': ') || null
  }
  const heading = (doc.content || []).find((n) => n.type === 'heading')
  if (!heading) return null
  const collect = (n: PMJSON): string => (n.text || '') + (n.content || []).map(collect).join('')
  return collect(heading).trim() || null
}

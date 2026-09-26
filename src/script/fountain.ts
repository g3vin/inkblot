/**
 * fountain.ts — Fountain, the plain-text screenplay format (fountain.io), in and out.
 *
 * Reading follows the 1.1 spec: the title page block, scene headings (INT., EXT., EST.,
 * INT./EXT., I/E, or forced with "."), characters (a line in capitals with speech under
 * it, or forced with "@"), parentheticals and dialogue, transitions (capitals ending
 * "TO:", or forced with ">"), centred text (">…<"), forced action ("!"), dual dialogue
 * ("^"), scene numbers ("#12A#"), page breaks ("==="), and *italic*, **bold** and
 * _underline_. Notes ([[…]]), the boneyard (/* … *\/), sections (#) and synopses (=) are
 * the writer's scaffolding, not the script, and are left out.
 *
 * Writing produces what reads back the same: an element is forced wherever its text
 * alone would be taken for something else. A stage play, which Fountain has no words
 * for, is written as a screenplay would carry it — acts and scenes as forced headings,
 * directions as action.
 */
import type { PMJSON } from '../print/export/portable'
import type { ScriptElementType } from './elements'
import { SCRIPT_NODE } from './ScriptElement'
import { sceneNumbersOfJSON } from './sceneNumbers'

export interface FountainTitlePage {
  title?: string
  credit?: string
  author?: string
  source?: string
  draftDate?: string
  contact?: string
  [key: string]: string | undefined
}

export interface FountainDocument {
  titlePage: FountainTitlePage
  /** A TipTap document, written as a screenplay. */
  doc: PMJSON
}

/* ---------------- reading ---------------- */

const HEADING = /^(INT|EXT|EST|INT\.?\/EXT|I\/E)[. ]/i
const SCENE_NUMBER = /\s*#([\w.-]+)#\s*$/
const TRANSITION = /^[^a-z]*TO:$/
const HAS_LETTER = /\p{L}/u

const isUpperLine = (line: string): boolean => HAS_LETTER.test(line) && line === line.toUpperCase()

/** Text with Fountain's emphasis turned into marked text nodes. */
export const parseInline = (source: string): PMJSON[] => {
  const out: PMJSON[] = []
  const marks: string[] = []
  let text = ''
  const flush = () => {
    if (!text) return
    out.push({ type: 'text', text, ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}) })
    text = ''
  }
  const toggle = (mark: string) => {
    flush()
    const at = marks.indexOf(mark)
    if (at >= 0) marks.splice(at, 1)
    else marks.push(mark)
  }
  // A marker only counts when it has a partner later in the line: a lone "*" is a star.
  const closes = (from: number, marker: string) => source.indexOf(marker, from) >= 0
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i]
    if (c === '\\' && i + 1 < source.length) {
      text += source[i + 1]
      i += 1
    } else if (source.startsWith('***', i) && (marks.includes('bold') || closes(i + 3, '***'))) {
      toggle('bold')
      toggle('italic')
      i += 2
    } else if (source.startsWith('**', i) && (marks.includes('bold') || closes(i + 2, '**'))) {
      toggle('bold')
      i += 1
    } else if (c === '*' && (marks.includes('italic') || closes(i + 1, '*'))) {
      toggle('italic')
    } else if (c === '_' && (marks.includes('underline') || closes(i + 1, '_'))) {
      toggle('underline')
    } else if (c === '\n') {
      flush()
      out.push({ type: 'hardBreak' })
    } else {
      text += c
    }
  }
  flush()
  return out
}

const line = (element: ScriptElementType, text: string, attrs: Record<string, unknown> = {}): PMJSON => {
  const content = parseInline(text)
  return { type: SCRIPT_NODE, attrs: { element, ...attrs }, ...(content.length ? { content } : {}) }
}

const TITLE_KEYS: Record<string, string> = {
  title: 'title', credit: 'credit', author: 'author', authors: 'author', source: 'source',
  'draft date': 'draftDate', date: 'draftDate', contact: 'contact', notes: 'notes', copyright: 'copyright',
}

/** The title page block at the top, and where the script begins after it. */
const readTitlePage = (lines: string[]): { titlePage: FountainTitlePage; start: number } => {
  const titlePage: FountainTitlePage = {}
  // Only a known key starts one: a script may well open with "FADE IN:".
  const first = /^([A-Za-z][A-Za-z ]*):/.exec(lines[0] || '')
  if (!first || !TITLE_KEYS[first[1].toLowerCase()]) return { titlePage, start: 0 }
  let key: string | null = null
  let i = 0
  for (; i < lines.length && lines[i].trim(); i += 1) {
    const match = /^([A-Za-z][A-Za-z ]*):\s*(.*)$/.exec(lines[i])
    if (match && !/^\s/.test(lines[i])) {
      key = TITLE_KEYS[match[1].toLowerCase()] || match[1].toLowerCase()
      titlePage[key] = match[2].trim()
    } else if (key) {
      titlePage[key] = [titlePage[key], lines[i].trim()].filter(Boolean).join('\n')
    }
  }
  // Emphasis on a title page is decoration; the words are what is kept.
  for (const k of Object.keys(titlePage)) titlePage[k] = (titlePage[k] || '').replace(/[*_]/g, '')
  return { titlePage, start: i }
}

/** The text without notes and the boneyard. */
const stripScaffolding = (source: string): string => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\[\[[\s\S]*?\]\]/g, '')

export const parseFountain = (source: string): FountainDocument => {
  // Trailing spaces go (a removed note leaves them), but for the two-space line that
  // keeps a speech going.
  const lines = stripScaffolding(source.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, ''))
    .split('\n')
    .map((l) => (l === '  ' ? l : l.replace(/[ \t]+$/, '')))
  const { titlePage, start } = readTitlePage(lines)
  const content: PMJSON[] = []
  let numbered = false

  const blank = (i: number) => i < start || i >= lines.length || !lines[i].trim()

  for (let i = start; i < lines.length; i += 1) {
    const raw = lines[i]
    const text = raw.trim()
    if (!text) continue

    // Scaffolding and page breaks.
    if (/^#/.test(text) || (/^=(?!==)/.test(text))) continue
    if (/^={3,}$/.test(text)) {
      content.push({ type: 'pageBreak' })
      continue
    }

    // Centred, then forced transitions.
    if (/^>.*<$/.test(text)) {
      content.push(line('centered', text.slice(1, -1).trim()))
      continue
    }
    if (text.startsWith('>')) {
      content.push(line('transition', text.slice(1).trim()))
      continue
    }

    // Scene headings: forced with ".", or a heading word after a blank line. (The spec
    // wants one after it too; scripts in the wild often run straight into action.)
    const forcedHeading = text.startsWith('.') && !text.startsWith('..')
    if (forcedHeading || (HEADING.test(text) && blank(i - 1))) {
      let heading = forcedHeading ? text.slice(1).trim() : text
      const number = SCENE_NUMBER.exec(heading)
      if (number) heading = heading.slice(0, number.index).trim()
      if (number) numbered = true
      content.push(line('sceneHeading', heading, number ? { sceneNumber: number[1] } : {}))
      continue
    }

    if (text.startsWith('!')) {
      // Forced action keeps its lines as they were written.
      const block = [raw.replace(/^\s*!/, '')]
      while (!blank(i + 1)) block.push(lines[(i += 1)])
      content.push(line('action', block.join('\n')))
      continue
    }

    if (isUpperLine(text) && TRANSITION.test(text) && blank(i - 1) && blank(i + 1)) {
      content.push(line('transition', text))
      continue
    }

    // A character: forced with "@", or capitals with something under them.
    const forcedCharacter = text.startsWith('@')
    const name = forcedCharacter ? text.slice(1).trim() : text
    const bare = name.replace(/\s*\^$/, '').replace(/\([^)]*\)\s*$/, '')
    if ((forcedCharacter || isUpperLine(bare)) && blank(i - 1) && !blank(i + 1)) {
      const dual = /\^$/.test(name)
      content.push(line('character', name.replace(/\s*\^$/, ''), dual ? { dual: true } : {}))
      // The speech: parentheticals and dialogue until the blank line. A line of two
      // spaces is a blank line inside the speech.
      let speech: string[] = []
      const endSpeech = () => {
        if (speech.length) content.push(line('dialogue', speech.join('\n'), dual ? { dual: true } : {}))
        speech = []
      }
      while (i + 1 < lines.length && (lines[i + 1].trim() || lines[i + 1] === '  ')) {
        i += 1
        const said = lines[i].trim()
        if (/^\(.*\)$/.test(said)) {
          endSpeech()
          content.push(line('parenthetical', said, dual ? { dual: true } : {}))
        } else {
          speech.push(said.replace(/^~\s*/, ''))
        }
      }
      endSpeech()
      continue
    }

    // Everything else is action, a paragraph to the blank line.
    const block = [raw]
    while (!blank(i + 1)) block.push(lines[(i += 1)])
    content.push(line('action', block.map((l) => l.replace(/^\t/, '    ')).join('\n').replace(/^\s+/, '')))
  }

  const attrs: Record<string, unknown> = { writingFormat: 'screenplay' }
  if (numbered) attrs.sceneNumbers = 'locked'
  return { titlePage, doc: { type: 'doc', attrs, content: content.length ? content : [line('sceneHeading', '')] } }
}

/* ---------------- writing ---------------- */

const escapeText = (text: string): string => text.replace(/([\\*_])/g, '\\$1')

/** Marked text as Fountain emphasis. */
export const serializeInline = (nodes: PMJSON[] = []): string => {
  let out = ''
  for (const node of nodes) {
    if (node.type === 'hardBreak') {
      out += '\n'
      continue
    }
    if (node.type !== 'text') {
      out += serializeInline(node.content)
      continue
    }
    const types = new Set((node.marks || []).map((m) => m.type))
    let wrap = ''
    if (types.has('bold') && types.has('italic')) wrap = '***'
    else if (types.has('bold')) wrap = '**'
    else if (types.has('italic')) wrap = '*'
    const under = types.has('underline') ? '_' : ''
    out += `${under}${wrap}${escapeText(node.text || '')}${wrap}${under}`
  }
  return out
}

/** What Fountain would take a line for, on its own, between blank lines. */
const readsAs = (text: string, followed: boolean): string => {
  if (!text) return 'action'
  if (/^[.!@>~=#]/.test(text) || /^\[\[/.test(text)) return 'special'
  if (HEADING.test(text)) return 'sceneHeading'
  if (isUpperLine(text) && TRANSITION.test(text)) return 'transition'
  if (isUpperLine(text.split('\n')[0]) && followed) return 'character'
  return 'action'
}

export interface FountainWriteOptions {
  titlePage?: FountainTitlePage
}

const TITLE_ORDER: Array<[keyof FountainTitlePage, string]> = [
  ['title', 'Title'], ['credit', 'Credit'], ['author', 'Author'], ['source', 'Source'],
  ['draftDate', 'Draft date'], ['contact', 'Contact'],
]

const titleBlock = (page: FountainTitlePage = {}): string => TITLE_ORDER
  .filter(([key]) => page[key])
  .map(([key, label]) => {
    const [first, ...rest] = String(page[key]).split('\n')
    return rest.length ? `${label}:\n${[first, ...rest].map((l) => `   ${l}`).join('\n')}` : `${label}: ${first}`
  })
  .join('\n')

/** A script document as Fountain. */
export const serializeFountain = (doc: PMJSON, options: FountainWriteOptions = {}): string => {
  const blocks: string[] = []
  const nodes = doc.content || []
  const numbers = sceneNumbersOfJSON(doc)
  let speech: string[] | null = null
  const endSpeech = () => {
    if (speech) blocks.push(speech.join('\n'))
    speech = null
  }

  nodes.forEach((node, index) => {
    if (node.type === 'pageBreak') {
      endSpeech()
      blocks.push('===')
      return
    }
    const text = serializeInline(node.content)
    const plain = text.replace(/\\([\\*_])/g, '$1')
    if (node.type !== SCRIPT_NODE) {
      // Prose that found its way into a script: a heading is a forced scene heading,
      // anything else action.
      endSpeech()
      if (!plain.trim()) return
      if (node.type === 'heading') blocks.push(`.${plain.trim()}`)
      else blocks.push(readsAs(plain, false) === 'action' ? text : `!${text}`)
      return
    }
    const element = node.attrs?.element as ScriptElementType
    const next = nodes[index + 1]
    const speechFollows = next?.type === SCRIPT_NODE && ['dialogue', 'parenthetical', 'stageDialogue'].includes(String(next.attrs?.element))

    switch (element) {
      case 'character':
      case 'stageCharacter': {
        endSpeech()
        const name = plain.trim().toUpperCase()
        const forced = !isUpperLine(name.replace(/\([^)]*\)/g, '')) || readsAs(name, true) !== 'character'
        speech = [`${forced ? '@' : ''}${name}${node.attrs?.dual ? ' ^' : ''}`]
        return
      }
      case 'parenthetical':
      case 'dialogue':
      case 'stageDialogue': {
        const said = element === 'parenthetical' && !/^\(.*\)$/.test(plain.trim()) ? `(${text.trim()})` : text
        // A blank line inside a speech would end it; two spaces keep it going.
        const lines = said.split('\n').map((l) => (l.trim() ? l : '  '))
        if (speech) speech.push(...lines)
        else blocks.push(lines.join('\n'))
        return
      }
      default:
        break
    }
    endSpeech()
    if (!plain.trim()) return
    switch (element) {
      case 'sceneHeading': {
        const heading = plain.trim().toUpperCase()
        const number = numbers.has(node) ? ` #${numbers.get(node)}#` : ''
        blocks.push(`${HEADING.test(heading) ? '' : '.'}${heading}${number}`)
        return
      }
      case 'actHeading':
      case 'sceneTitle':
        blocks.push(`.${plain.trim().toUpperCase()}`)
        return
      case 'transition': {
        const upper = plain.trim().toUpperCase()
        blocks.push(TRANSITION.test(upper) ? upper : `>${upper}`)
        return
      }
      case 'centered':
        blocks.push(`>${text.trim()}<`)
        return
      case 'shot':
        blocks.push(`!${plain.trim().toUpperCase()}`)
        return
      default: {
        // Action, and a play's directions: forced when the words alone would read as
        // something else.
        const followedBySpeech = speechFollows
        blocks.push(readsAs(plain, followedBySpeech || plain.includes('\n')) === 'action' ? text : `!${text}`)
      }
    }
  })
  endSpeech()

  const title = titleBlock(options.titlePage)
  return `${[title, ...blocks].filter(Boolean).join('\n\n')}\n`
}

/**
 * reports.ts — a script broken down the way a production reads it: who speaks and
 * how much, every scene with its page and its length in eighths of a page, and every
 * place the story goes.
 *
 * A scene's length is counted in lines, the way breakdown software does: each line
 * set in its element's column (the plain-text export's, text.ts), a blank line before
 * the elements that open something, 55 lines to the page. The page a scene starts on
 * is the laid-out page when the script is on screen, and the count's page otherwise.
 *
 * Reports go out as a spreadsheet (CSV) or print on the script's own pages, as a
 * document of tables (`reportDocument`).
 */
import type { PMJSON } from '../print/export/portable'
import { SCRIPT_COLUMNS, wrapText } from '../print/export/text'
import { characterName, sceneLocation } from './elements'
import { labelScenes, readSceneNumbers } from './sceneNumbers'

const LINES_PER_PAGE = 55

const SCENE_ELEMENTS = new Set(['sceneHeading', 'sceneTitle'])
const SPEAKERS = new Set(['character', 'stageCharacter'])
const SPEECH = new Set(['dialogue', 'stageDialogue'])

export interface ReportScene {
  index: number
  number: string | null
  heading: string
  /** INT, EXT, INT/EXT — or '' for a play's scene, or a heading without one. */
  setting: string
  location: string
  time: string
  /** Where the heading is in the document. */
  pos: number
  page: number
  eighths: number
  cast: string[]
}

export interface ReportCharacter {
  name: string
  speeches: number
  words: number
  scenes: number
  firstScene: string
  firstPage: number
}

export interface ReportLocation {
  name: string
  settings: string[]
  scenes: string[]
  eighths: number
}

export interface ScriptBreakdown {
  scenes: ReportScene[]
  characters: ReportCharacter[]
  locations: ReportLocation[]
}

interface Block { node: PMJSON; pos: number }

const textOf = (node: PMJSON): string => (node.content || [])
  .map((child) => (child.type === 'text' ? child.text || '' : child.type === 'hardBreak' ? '\n' : textOf(child)))
  .join('')

/** A node's size in the document, for the positions of a document given as JSON. */
const sizeOf = (node: PMJSON): number => {
  if (node.type === 'text') return (node.text || '').length
  if (!node.content) return 1
  return node.content.reduce((n, child) => n + sizeOf(child), 0) + 2
}

type DocLike = PMJSON | { forEach: (f: (node: { toJSON: () => PMJSON }, pos: number) => void) => void; attrs?: Record<string, unknown> }

/** The top-level blocks with their positions, from an editor's document or its JSON. */
const blocksOf = (doc: DocLike): { blocks: Block[]; attrs: Record<string, unknown> } => {
  const blocks: Block[] = []
  if ('forEach' in doc && typeof doc.forEach === 'function') {
    doc.forEach((node, pos) => { blocks.push({ node: node.toJSON(), pos }) })
  } else {
    let pos = 0
    for (const node of (doc as PMJSON).content || []) {
      blocks.push({ node, pos })
      pos += sizeOf(node)
    }
  }
  return { blocks, attrs: (doc.attrs || {}) as Record<string, unknown> }
}

/** The lines a script line takes on the page, with the blank line before it. */
const linesOf = (node: PMJSON, first: boolean): number => {
  if (node.type !== 'scriptElement') return Math.max(1, Math.ceil(textOf(node).length / 60)) + (first ? 0 : 1)
  const spec = SCRIPT_COLUMNS[String(node.attrs?.element)] || SCRIPT_COLUMNS.action
  const lines = wrapText(textOf(node), spec.width).split('\n').length
  return lines + (spec.before && !first ? 1 : 0)
}

const SETTING = /^(INT\.?\/EXT|I\/E|INT|EXT|EST)[.\s]/i

const settingOf = (heading: string): string => {
  const match = SETTING.exec(heading.trim())
  if (!match) return ''
  const word = match[1].toUpperCase().replace('.', '')
  return word === 'I/E' || word === 'INT/EXT' ? 'INT/EXT' : word
}

const timeOf = (heading: string): string => {
  const match = /\s+-\s+([^-]+)$/.exec(heading.trim())
  return match ? match[1].trim().toUpperCase() : ''
}

const words = (text: string): number => (text.match(/[\p{L}\p{N}’']+/gu) || []).length

/**
 * The breakdown of a script. `pageAt(pos)` gives the laid-out page a position is on,
 * when there is a layout.
 */
export const breakdown = (doc: DocLike, pageAt?: (pos: number) => number): ScriptBreakdown => {
  const { blocks, attrs } = blocksOf(doc)
  const sceneBlocks = blocks.filter((b) => b.node.type === 'scriptElement' && SCENE_ELEMENTS.has(String(b.node.attrs?.element)))
  // Numbered as the page numbers them (sceneNumbers.ts): a screenplay's headings.
  const numbered = sceneBlocks.filter((b) => b.node.attrs?.element === 'sceneHeading')
  const numberLabels = labelScenes(readSceneNumbers({ attrs }), numbered.map((b) => (b.node.attrs?.sceneNumber as string) || null))
  const labelAt = new Map(numbered.map((b, i) => [b.pos, numberLabels[i]]))

  const scenes: ReportScene[] = []
  const characters = new Map<string, ReportCharacter & { sceneSet: Set<number> }>()
  let lines = 0
  let current: ReportScene | null = null
  let sceneLines = 0
  let speaker: string | null = null
  const finish = (scene: ReportScene | null) => {
    if (!scene) return
    scene.eighths = Math.max(1, Math.round((sceneLines * 8) / LINES_PER_PAGE))
    scenes.push(scene)
  }

  blocks.forEach(({ node, pos }, i) => {
    const element = node.type === 'scriptElement' ? String(node.attrs?.element) : ''
    const text = textOf(node).trim()
    const taken = linesOf(node, i === 0)
    const page = pageAt ? pageAt(pos) : Math.floor(lines / LINES_PER_PAGE) + 1
    if (SCENE_ELEMENTS.has(element)) {
      finish(current)
      sceneLines = 0
      const index = scenes.length
      const heading = text.toUpperCase()
      current = {
        index,
        number: labelAt.get(pos) ?? null,
        heading,
        setting: settingOf(heading),
        location: element === 'sceneHeading' ? sceneLocation(heading) : heading,
        time: element === 'sceneHeading' ? timeOf(heading) : '',
        pos,
        page,
        eighths: 0,
        cast: [],
      }
      speaker = null
    }
    sceneLines += taken
    lines += taken

    if (SPEAKERS.has(element)) {
      speaker = characterName(text)
      if (!speaker) return
      let entry = characters.get(speaker)
      if (!entry) {
        entry = { name: speaker, speeches: 0, words: 0, scenes: 0, firstScene: current?.number || current?.heading || '', firstPage: page, sceneSet: new Set() }
        characters.set(speaker, entry)
      }
      entry.speeches += 1
      if (current) {
        entry.sceneSet.add(current.index)
        if (!current.cast.includes(speaker)) current.cast.push(speaker)
      }
    } else if (SPEECH.has(element) && speaker) {
      characters.get(speaker)!.words += words(text)
    } else if (element !== 'parenthetical') {
      speaker = null
    }
  })
  finish(current)

  const castList = [...characters.values()]
    .map(({ sceneSet, ...c }) => ({ ...c, scenes: sceneSet.size }))
    .sort((a, b) => b.speeches - a.speeches || b.words - a.words || a.name.localeCompare(b.name))

  const places = new Map<string, ReportLocation>()
  for (const scene of scenes) {
    const name = scene.location || scene.heading
    const place = places.get(name) || { name, settings: [], scenes: [], eighths: 0 }
    if (scene.setting && !place.settings.includes(scene.setting)) place.settings.push(scene.setting)
    place.scenes.push(scene.number || String(scene.index + 1))
    place.eighths += scene.eighths
    places.set(name, place)
  }
  const locations = [...places.values()].sort((a, b) => b.eighths - a.eighths || a.name.localeCompare(b.name))

  return { scenes, characters: castList, locations }
}

/** Eighths of a page as a production writes them: "3/8", "1 2/8", "2". */
export const formatEighths = (eighths: number): string => {
  const whole = Math.floor(eighths / 8)
  const rest = eighths % 8
  if (!rest) return String(whole)
  return whole ? `${whole} ${rest}/8` : `${rest}/8`
}

export type ReportKind = 'characters' | 'scenes' | 'locations'

export const REPORT_TITLES: Record<ReportKind, string> = {
  characters: 'Character Report',
  scenes: 'Scene Report',
  locations: 'Location Report',
}

/** A report's rows, the first being its column headings. */
export const reportRows = (report: ReportKind, data: ScriptBreakdown): string[][] => {
  switch (report) {
    case 'characters':
      return [
        ['Character', 'Speeches', 'Words', 'Scenes', 'First Scene', 'First Page'],
        ...data.characters.map((c) => [c.name, String(c.speeches), String(c.words), String(c.scenes), c.firstScene, String(c.firstPage)]),
      ]
    case 'locations':
      return [
        ['Location', 'Setting', 'Scenes', 'Pages'],
        ...data.locations.map((l) => [l.name, l.settings.join(', '), l.scenes.join(', '), formatEighths(l.eighths)]),
      ]
    default:
      return [
        ['Scene', 'Heading', 'Page', 'Length', 'Cast'],
        ...data.scenes.map((s) => [s.number || String(s.index + 1), s.heading, String(s.page), formatEighths(s.eighths), s.cast.join(', ')]),
      ]
  }
}

const csvCell = (value: string): string => (/[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value)

/** A report as a spreadsheet file (RFC 4180; CRLF, as Excel expects). */
export const reportCsv = (report: ReportKind, data: ScriptBreakdown): string => (
  `${reportRows(report, data).map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`
)

const cell = (type: 'tableHeader' | 'tableCell', text: string): PMJSON => ({
  type,
  content: [{ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) }],
})

/** A report as a document — a heading and a table — to print on the script's pages. */
export const reportDocument = (report: ReportKind, data: ScriptBreakdown, title: string): PMJSON => {
  const [head, ...rows] = reportRows(report, data)
  return {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: `${REPORT_TITLES[report]}: ${title}` }] },
      {
        type: 'table',
        content: [
          { type: 'tableRow', content: head.map((h) => cell('tableHeader', h)) },
          ...rows.map((row) => ({ type: 'tableRow', content: row.map((v) => cell('tableCell', v)) })),
        ],
      },
    ],
  }
}

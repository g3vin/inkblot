/**
 * fdx.ts — a script as Final Draft's own file (.fdx), for a producer, a script
 * coordinator, or anyone whose software is Final Draft.
 *
 * FDX is XML: a `<Paragraph Type="…">` for each line of the script, its runs in
 * `<Text Style="Bold+Italic">`, scene numbers as the heading's `Number`, a page break
 * as `StartsNewPage` on what follows, and dual dialogue as the two speeches inside a
 * `<DualDialogue>`. Final Draft sets the page from its own template, so the elements
 * are all that needs to be right. A stage play's parts go to the elements Final
 * Draft's stage-play templates use.
 */
import { sceneNumbersOfJSON } from '../../script/sceneNumbers'
import type { PMJSON } from './portable'
import { escapeXml } from './xml'

const TYPES: Record<string, string> = {
  sceneHeading: 'Scene Heading',
  action: 'Action',
  character: 'Character',
  parenthetical: 'Parenthetical',
  dialogue: 'Dialogue',
  transition: 'Transition',
  shot: 'Shot',
  centered: 'Action',
  actHeading: 'New Act',
  sceneTitle: 'Scene Heading',
  stageDirection: 'Action',
  stageCharacter: 'Character',
  stageDialogue: 'Dialogue',
}

const SPEECH = new Set(['character', 'stageCharacter', 'parenthetical', 'dialogue', 'stageDialogue'])

const STYLE_MARKS: Array<[string, string]> = [['bold', 'Bold'], ['italic', 'Italic'], ['underline', 'Underline']]

const runs = (nodes: PMJSON[] = []): string => {
  const out: string[] = []
  const walk = (list: PMJSON[]) => {
    for (const node of list) {
      if (node.type === 'hardBreak') out.push('<Text>\n</Text>')
      else if (node.type === 'text') {
        const marks = new Set((node.marks || []).map((m) => m.type))
        const style = STYLE_MARKS.filter(([mark]) => marks.has(mark)).map(([, name]) => name).join('+')
        out.push(`<Text${style ? ` Style="${style}"` : ''}>${escapeXml(node.text || '')}</Text>`)
      } else walk(node.content || [])
    }
  }
  walk(nodes)
  return out.join('') || '<Text></Text>'
}

export interface FdxTitlePage {
  title?: string
  credit?: string
  author?: string
  contact?: string
  draftDate?: string
}

const centred = (text: string, spaceBefore = 0) => (
  `<Paragraph Type="General" Alignment="Center"${spaceBefore ? ` SpaceBefore="${spaceBefore}"` : ''}><Text>${escapeXml(text)}</Text></Paragraph>`
)

const titlePageXml = (page: FdxTitlePage | null | undefined): string => {
  if (!page?.title) return ''
  const lines: string[] = [centred(page.title.toUpperCase(), 216)]
  if (page.author) {
    lines.push(centred(page.credit || 'Written by', 24), centred(page.author, 12))
  }
  const left = [page.contact, page.draftDate].filter(Boolean).join('\n\n')
  if (left) {
    lines.push(...left.split('\n').map((l, i) => `<Paragraph Type="General"${i === 0 ? ' SpaceBefore="240"' : ''}><Text>${escapeXml(l)}</Text></Paragraph>`))
  }
  return `  <TitlePage>\n    <Content>\n      ${lines.join('\n      ')}\n    </Content>\n  </TitlePage>\n`
}

/** A script document as a Final Draft file. */
export const buildFdx = (doc: PMJSON, options: { titlePage?: FdxTitlePage | null } = {}): string => {
  const numbers = sceneNumbersOfJSON(doc)
  const nodes = doc.content || []
  const out: string[] = []
  let newPage = false

  const paragraph = (node: PMJSON): string => {
    const element = String(node.attrs?.element || 'action')
    const type = node.type === 'heading' ? 'Scene Heading' : (TYPES[element] || 'Action')
    const attrs = [`Type="${type}"`]
    if (numbers.has(node)) attrs.push(`Number="${escapeXml(numbers.get(node))}"`)
    if (element === 'centered') attrs.push('Alignment="Center"')
    if (newPage) attrs.push('StartsNewPage="Yes"')
    newPage = false
    return `<Paragraph ${attrs.join(' ')}>${runs(node.content)}</Paragraph>`
  }

  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i]
    if (node.type === 'pageBreak') {
      newPage = true
      continue
    }
    // Dual dialogue: the speech before, and the one marked as spoken with it.
    const element = String(node.attrs?.element)
    if (SPEECH.has(element) && (element === 'character' || element === 'stageCharacter')) {
      const speechEnd = (from: number) => {
        let j = from + 1
        while (j < nodes.length && SPEECH.has(String(nodes[j].attrs?.element)) && !String(nodes[j].attrs?.element).toLowerCase().includes('character')) j += 1
        return j
      }
      const end = speechEnd(i)
      const partner = nodes[end]
      if (partner?.attrs?.dual && String(partner.attrs.element).toLowerCase().includes('character')) {
        const partnerEnd = speechEnd(end)
        const inner = nodes.slice(i, partnerEnd).map(paragraph).join('')
        out.push(`<Paragraph><DualDialogue>${inner}</DualDialogue></Paragraph>`)
        i = partnerEnd - 1
        continue
      }
    }
    out.push(paragraph(node))
  }

  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="no" ?>',
    '<FinalDraft DocumentType="Script" Template="No" Version="5">',
    '  <Content>',
    ...out.map((p) => `    ${p}`),
    '  </Content>',
    titlePageXml(options.titlePage).replace(/\n$/, ''),
    '</FinalDraft>',
    '',
  ].filter((l, i, all) => l !== '' || i === all.length - 1).join('\n')
}

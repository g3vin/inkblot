/**
 * fontFile.ts — what a font file says about itself: its family, its style, and whether
 * its licence lets it be embedded in a PDF or an e-book.
 *
 * An OpenType or TrueType file is a table directory; the `name` table holds the family
 * and style names, and the `OS/2` table's `fsType` the embedding permission. A font
 * whose fsType says "restricted licence" may not be embedded — and a PDF sent to a
 * printer, or an EPUB sent to a store, must embed what it is set in. WOFF files are
 * compressed tables; for them only the file name is read.
 */

export interface FontInfo {
  family: string
  /** 400 regular, 700 bold, …, from the style name. */
  weight: number
  style: 'normal' | 'italic'
  /** False when the licence forbids embedding it. */
  embeddable: boolean
  format: 'truetype' | 'opentype' | 'woff' | 'woff2'
}

const tagAt = (view: DataView, at: number) => String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3))

/** The sfnt tables' offsets, by tag. */
const tablesOf = (view: DataView): Map<string, { offset: number; length: number }> => {
  const out = new Map<string, { offset: number; length: number }>()
  const count = view.getUint16(4)
  for (let i = 0; i < count; i += 1) {
    const at = 12 + i * 16
    if (at + 16 > view.byteLength) break
    out.set(tagAt(view, at), { offset: view.getUint32(at + 8), length: view.getUint32(at + 12) })
  }
  return out
}

/** A `name` table's string, preferring Windows Unicode, then Mac Roman. */
const nameOf = (view: DataView, table: { offset: number }, ids: number[]): string | null => {
  const base = table.offset
  const count = view.getUint16(base + 2)
  const strings = base + view.getUint16(base + 4)
  const found: Record<string, string> = {}
  for (let i = 0; i < count; i += 1) {
    const at = base + 6 + i * 12
    if (at + 12 > view.byteLength) break
    const platform = view.getUint16(at)
    const nameId = view.getUint16(at + 6)
    const length = view.getUint16(at + 8)
    const offset = strings + view.getUint16(at + 10)
    if (!ids.includes(nameId) || offset + length > view.byteLength) continue
    let text = ''
    if (platform === 3 || platform === 0) {
      for (let j = 0; j + 1 < length; j += 2) text += String.fromCharCode(view.getUint16(offset + j))
    } else if (platform === 1) {
      for (let j = 0; j < length; j += 1) text += String.fromCharCode(view.getUint8(offset + j))
    } else continue
    const key = `${nameId}:${platform === 1 ? 'mac' : 'win'}`
    if (text && !found[key]) found[key] = text
  }
  for (const id of ids) {
    const text = found[`${id}:win`] || found[`${id}:mac`]
    if (text) return text.trim()
  }
  return null
}

const WEIGHTS: Array<[RegExp, number]> = [
  [/thin|hairline/i, 100],
  [/extra ?light|ultra ?light/i, 200],
  [/light/i, 300],
  [/medium/i, 500],
  [/semi ?bold|demi ?bold/i, 600],
  [/extra ?bold|ultra ?bold/i, 800],
  [/black|heavy/i, 900],
  [/bold/i, 700],
]

/** A style name's weight and slant: "Semibold Italic" → 600, italic. */
export const styleFromName = (name: string): { weight: number; style: 'normal' | 'italic' } => ({
  weight: WEIGHTS.find(([re]) => re.test(name))?.[1] ?? 400,
  style: /italic|oblique/i.test(name) ? 'italic' : 'normal',
})

/** The family a file name suggests: "EBGaramond-BoldItalic.otf" → "EBGaramond". */
export const familyFromFileName = (fileName: string): string => (
  fileName.replace(/\.[^.]+$/, '').replace(/[-_](thin|light|regular|book|medium|semibold|bold|black|heavy|italic|oblique|extralight|extrabold|[a-z]*italic)+$/i, '').trim() || fileName
)

/** Read a font file's family, style and embedding permission. */
export const readFontInfo = (bytes: Uint8Array, fileName = ''): FontInfo => {
  const fromName = { family: familyFromFileName(fileName), ...styleFromName(fileName.replace(/\.[^.]+$/, '')) }
  if (bytes.byteLength < 12) return { ...fromName, embeddable: true, format: 'opentype' }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const magic = tagAt(view, 0)
  if (magic === 'wOFF') return { ...fromName, embeddable: true, format: 'woff' }
  if (magic === 'wOF2') return { ...fromName, embeddable: true, format: 'woff2' }
  const format = magic === 'OTTO' ? 'opentype' : 'truetype'
  let family = fromName.family
  let styled = { weight: fromName.weight, style: fromName.style }
  let embeddable = true
  try {
    const tables = tablesOf(view)
    const name = tables.get('name')
    if (name) {
      // The typographic family groups a family's weights under one name; the legacy one
      // may be "Garamond Semibold".
      family = nameOf(view, name, [16, 1]) || family
      const sub = nameOf(view, name, [17, 2])
      if (sub) styled = styleFromName(sub)
    }
    const os2 = tables.get('OS/2')
    if (os2 && os2.offset + 10 <= view.byteLength) {
      const weightClass = view.getUint16(os2.offset + 4)
      if (weightClass >= 100 && weightClass <= 1000) styled.weight = weightClass
      const fsType = view.getUint16(os2.offset + 8)
      // Bits 0–3 are the usage permission; 2 is "restricted licence": not to be embedded.
      embeddable = (fsType & 0x000f) !== 0x0002
    }
  } catch {
    // A file too broken to read: its name is all there is.
  }
  return { family, ...styled, embeddable, format }
}

/** The CSS `format()` and MIME type of a font file, by extension. */
export const fontFileType = (path: string): { format: string; mime: string } | null => {
  const ext = path.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'otf': return { format: 'opentype', mime: 'font/otf' }
    case 'ttf': return { format: 'truetype', mime: 'font/ttf' }
    case 'woff': return { format: 'woff', mime: 'font/woff' }
    case 'woff2': return { format: 'woff2', mime: 'font/woff2' }
    default: return null
  }
}

/**
 * sceneNumbers.ts — how a script's scenes are numbered, apart from the editor, so the
 * page (DocWritingFormat.js) and every export number them alike.
 */

export type SceneNumbering = 'off' | 'on' | 'locked'

/** How a document's scenes are numbered: not at all, as they stand, or locked. */
export const readSceneNumbers = (doc: { attrs?: Record<string, unknown> } | null | undefined): SceneNumbering => {
  const mode = doc?.attrs?.sceneNumbers
  return mode === 'on' || mode === 'locked' ? mode : 'off'
}

/** The elements that carry a number. */
export const NUMBERED_ELEMENTS = new Set(['sceneHeading'])

/** "12" → "12A" → "12B"…; "12Z" → "12ZA". */
export const nextLetter = (label: string): string => {
  const m = /^(\d+)([A-Z]*)$/.exec(label)
  if (!m) return `${label}A`
  const letters = m[2]
  if (!letters) return `${m[1]}A`
  const last = letters[letters.length - 1]
  return last === 'Z' ? `${m[1]}${letters}A` : `${m[1]}${letters.slice(0, -1)}${String.fromCharCode(last.charCodeAt(0) + 1)}`
}

/**
 * The labels for a script's scene headings, in order, given the numbers each was
 * locked with (null where none). Numbered in order; once locked, a heading keeps the
 * number it was given, and a scene added since takes the one before it with a letter —
 * 12A between 12 and 13 — as a shooting script's are.
 */
export const labelScenes = (mode: SceneNumbering, locked: Array<string | null>): Array<string | null> => {
  if (mode === 'off') return locked.map(() => null)
  let previous = '0'
  return locked.map((number, i) => {
    const label = mode === 'on' ? String(i + 1) : (number || nextLetter(previous))
    previous = label
    return label
  })
}

interface JSONNode { type: string; attrs?: Record<string, unknown>; content?: JSONNode[] }

/** A document as JSON (an export's): each numbered heading → its label. */
export const sceneNumbersOfJSON = (doc: JSONNode): Map<JSONNode, string> => {
  const headings = (doc.content || []).filter((n) => n.type === 'scriptElement' && NUMBERED_ELEMENTS.has(String(n.attrs?.element)))
  const labels = labelScenes(readSceneNumbers(doc), headings.map((n) => (n.attrs?.sceneNumber as string) || null))
  const out = new Map<JSONNode, string>()
  headings.forEach((n, i) => { if (labels[i]) out.set(n, labels[i] as string) })
  return out
}

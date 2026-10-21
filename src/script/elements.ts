/**
 * elements.ts — the parts a script is made of, and how the keys move between them.
 *
 * A screenplay is written one element at a time — a scene heading, action, a
 * character's name, what they say — and the writer never sets an indent: Enter moves
 * on to the element that usually comes next, and Tab to the one that often does.
 * These are Final Draft's tables, which is what screenwriters' fingers know. A stage
 * play is the same idea with the stage's own parts.
 */

export type WritingFormat = 'prose' | 'screenplay' | 'stageplay'

export type ScriptElementType =
  | 'sceneHeading' | 'action' | 'character' | 'parenthetical' | 'dialogue' | 'transition' | 'shot' | 'centered'
  | 'actHeading' | 'sceneTitle' | 'stageDirection' | 'stageCharacter' | 'stageDialogue'

export interface ElementSpec {
  id: ScriptElementType
  label: string
  /** Set in capitals on the page (the text itself keeps what was typed). */
  upper: boolean
}

export const SCREENPLAY_ELEMENTS: ElementSpec[] = [
  { id: 'sceneHeading', label: 'Scene heading', upper: true },
  { id: 'action', label: 'Action', upper: false },
  { id: 'character', label: 'Character', upper: true },
  { id: 'parenthetical', label: 'Parenthetical', upper: false },
  { id: 'dialogue', label: 'Dialogue', upper: false },
  { id: 'transition', label: 'Transition', upper: true },
  { id: 'shot', label: 'Shot', upper: true },
  { id: 'centered', label: 'Centered', upper: false },
]

export const STAGEPLAY_ELEMENTS: ElementSpec[] = [
  { id: 'actHeading', label: 'Act', upper: true },
  { id: 'sceneTitle', label: 'Scene', upper: true },
  { id: 'stageDirection', label: 'Stage direction', upper: false },
  { id: 'stageCharacter', label: 'Character', upper: true },
  { id: 'parenthetical', label: 'Parenthetical', upper: false },
  { id: 'stageDialogue', label: 'Dialogue', upper: false },
]

export const ALL_ELEMENTS: ElementSpec[] = [
  ...SCREENPLAY_ELEMENTS,
  ...STAGEPLAY_ELEMENTS.filter((e) => !SCREENPLAY_ELEMENTS.some((s) => s.id === e.id)),
]

export const elementsFor = (format: WritingFormat): ElementSpec[] => (
  format === 'stageplay' ? STAGEPLAY_ELEMENTS : format === 'screenplay' ? SCREENPLAY_ELEMENTS : []
)

export const isElement = (value: unknown): value is ScriptElementType => ALL_ELEMENTS.some((e) => e.id === value)

/** The element a new script starts with, and the one prose paragraphs become. */
export const BODY_ELEMENT: Record<Exclude<WritingFormat, 'prose'>, ScriptElementType> = {
  screenplay: 'action',
  stageplay: 'stageDirection',
}

/* ---------------- Enter ---------------- */

const ENTER: Partial<Record<ScriptElementType, ScriptElementType>> = {
  sceneHeading: 'action',
  action: 'action',
  character: 'dialogue',
  parenthetical: 'dialogue',
  dialogue: 'action',
  transition: 'sceneHeading',
  shot: 'action',
  centered: 'action',
  actHeading: 'sceneTitle',
  sceneTitle: 'stageDirection',
  stageDirection: 'stageCharacter',
  stageCharacter: 'stageDialogue',
  stageDialogue: 'stageCharacter',
}

/** Enter on an empty line changes the line instead of adding one. */
const ENTER_WHEN_EMPTY: Partial<Record<ScriptElementType, ScriptElementType>> = {
  // The line after a speech is action; a second Enter makes it the next speaker.
  action: 'character',
  character: 'sceneHeading',
  sceneHeading: 'action',
  dialogue: 'action',
  parenthetical: 'dialogue',
  transition: 'sceneHeading',
  stageDirection: 'stageCharacter',
  stageCharacter: 'stageDirection',
  stageDialogue: 'stageDirection',
}

/** The element Enter makes next, after a line of `element` holding `text`. */
export const nextOnEnter = (element: ScriptElementType, text: string): { change?: ScriptElementType; next?: ScriptElementType } => {
  if (!text.trim()) return { change: ENTER_WHEN_EMPTY[element] || element }
  // Written as action in capitals and ending "TO:", it was a transition all along.
  if (element === 'action' && /^[^a-z]*TO:$/.test(text.trim())) return { change: 'transition', next: 'sceneHeading' }
  return { next: ENTER[element] || element }
}

/* ---------------- Tab ---------------- */

const TAB: Partial<Record<ScriptElementType, ScriptElementType>> = {
  action: 'character',
  character: 'transition',
  transition: 'action',
  sceneHeading: 'action',
  dialogue: 'parenthetical',
  parenthetical: 'dialogue',
  shot: 'action',
  centered: 'action',
  actHeading: 'sceneTitle',
  sceneTitle: 'stageDirection',
  stageDirection: 'stageCharacter',
  stageCharacter: 'stageDirection',
  stageDialogue: 'parenthetical',
}

const SHIFT_TAB: Partial<Record<ScriptElementType, ScriptElementType>> = {
  character: 'action',
  transition: 'character',
  action: 'sceneHeading',
  dialogue: 'character',
  parenthetical: 'dialogue',
  shot: 'sceneHeading',
  sceneTitle: 'actHeading',
  stageDirection: 'sceneTitle',
  stageCharacter: 'stageDirection',
  stageDialogue: 'stageCharacter',
}

/** The element Tab (or Shift-Tab) turns the line into. In a stage play, a parenthetical
 * goes back to the stage's dialogue. */
export const nextOnTab = (element: ScriptElementType, back = false, format: WritingFormat = 'screenplay'): ScriptElementType => {
  if (element === 'parenthetical' && format === 'stageplay' && !back) return 'stageDialogue'
  return (back ? SHIFT_TAB : TAB)[element] || element
}

/* ---------------- recognising what was typed ---------------- */

/** A scene heading's opening: INT., EXT., INT./EXT., I/E, EST. */
export const SCENE_HEADING = /^(INT|EXT|EST|INT\.?\/EXT|I\/E)[.\s]/i

/** What a line typed as action turns out to be, from its first characters. */
export const recognise = (element: ScriptElementType, text: string): ScriptElementType | null => {
  if (element === 'action' && SCENE_HEADING.test(text)) return 'sceneHeading'
  return null
}

/** A character's name without an extension: "MARY (V.O.)" → "MARY"; "MARY (CONT'D)" too. */
export const characterName = (text: string): string => text.replace(/\s*\(.*\)\s*$/, '').replace(/\^$/, '').trim().toUpperCase()

/** A scene heading's location: "INT. KITCHEN - NIGHT" → "KITCHEN". */
export const sceneLocation = (text: string): string => text
  .replace(SCENE_HEADING, '')
  .replace(/\s+-\s+[^-]*$/, '')
  .replace(/^\.\s*/, '')
  .trim()
  .toUpperCase()

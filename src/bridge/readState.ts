/**
 * readState.ts — turning a live editor into the two structs the shell renders from.
 *
 * Chrome never holds an editor. The toolbar (the page's and the native menu bar's
 * Format menu alike) renders a `ToolbarState` pushed over the bridge, and this is
 * where that state is read off the active editor.
 *
 * The functions are pure reads — they take an editor and return a value, touching
 * nothing. That is what lets them serve both a pushed event and a request: the context
 * menu asks for `SelectionContext` at the moment of the right-click, and the same
 * function has already been answering the pushed one on every selection change.
 */
import { Alignment, BlockType, WritingFormat } from '../types'
import type { ActiveMarks, SelectionContext, ToolbarState, EditorTarget } from '../types'
import { isEditorReady } from '../lib/editorUtils'
import { DEFAULT_HIGHLIGHT_COLOR, DEFAULT_TEXT_COLOR } from '../lib/palette'
import { fromCssFontFamily } from '../lib/systemFonts'
import { readSelectionAnchor } from './anchors'

/** What `readToolbarState` falls back to, spelled once. */
export const TOOLBAR_DEFAULTS = {
  color: DEFAULT_TEXT_COLOR,
  highlight: DEFAULT_HIGHLIGHT_COLOR,
  font: 'Literata',
  fontSize: '18px',
} as const

/* TipTap is not typed in this project, so the editor arrives as `unknown` and the
   shapes actually read are declared here. Narrow on purpose: this is the list of
   everything the bridge touches on a live editor, and it is short. */
interface PmNode {
  isText?: boolean
  text?: string
  type?: { name?: string }
  attrs?: Record<string, unknown>
  marks?: Array<{ type: unknown }>
}

interface PmEditor {
  state: {
    schema: { marks: Record<string, unknown> }
    selection: {
      from: number
      to: number
      empty: boolean
      node?: PmNode | null
      $from: {
        parent: {
          childAfter(offset: number): { node?: PmNode | null }
          childBefore(offset: number): { node?: PmNode | null }
        }
        parentOffset: number
      }
    }
    doc: {
      attrs?: Record<string, unknown>
      rangeHasMark(from: number, to: number, type: unknown): boolean
      nodesBetween(from: number, to: number, f: (node: PmNode) => boolean | void): void
    }
  }
  getAttributes(name: string): Record<string, unknown>
  isActive(name: string, attrs?: Record<string, unknown>): boolean
  can?(): { undo?(): boolean; redo?(): boolean }
}

const asEditor = (editor: unknown) => editor as PmEditor

/** A stored alignment string, narrowed to the three the protocol has. */
const toAlignment = (value: unknown): Alignment => {
  if (value === Alignment.Center) return Alignment.Center
  if (value === Alignment.Right) return Alignment.Right
  return Alignment.Left
}

/**
 * Is this mark on at the selection?
 *
 * The collapsed case is the interesting one and is transcribed rather than
 * reinvented: with no selection there is no range to ask about, so the answer comes
 * from the text node beside the caret — after it if there is one, otherwise before it.
 * That is what makes the bold button light up when the caret is inside a bold word.
 */
const isMarkActive = (editor: PmEditor, markName: string): boolean => {
  const { state } = editor
  const markType = state.schema.marks[markName]
  if (!markType) return false

  const { from, to, empty, $from } = state.selection
  if (!empty) return state.doc.rangeHasMark(from, to, markType)

  const parent = $from.parent
  const offset = $from.parentOffset
  const afterNode = parent.childAfter(offset).node
  const beforeNode = parent.childBefore(offset).node
  const pickNode = (afterNode?.isText && afterNode) || (beforeNode?.isText && beforeNode)
  const marks = (pickNode ? pickNode.marks : null) || []
  return marks.some((mark) => mark.type === markType)
}

/** The marks and nodes at the selection the toolbar shows as on; all off with no live editor. */
export function readActiveMarks(editor: unknown): ActiveMarks {
  if (!isEditorReady(editor)) {
    return {
      bold: false, italic: false, underline: false, strike: false, table: false,
      bulletList: false, orderedList: false,
    }
  }
  const live = asEditor(editor)

  return {
    bold: isMarkActive(live, 'bold'),
    italic: isMarkActive(live, 'italic'),
    underline: isMarkActive(live, 'underline'),
    strike: isMarkActive(live, 'strike'),
    table: live.isActive('table'),
    bulletList: live.isActive('bulletList'),
    orderedList: live.isActive('orderedList'),
  }
}

/** The Paragraph Style menu's current entry. Headings past 3 read as the nearest it has. */
export function readBlockType(editor: unknown): BlockType {
  if (!isEditorReady(editor)) return BlockType.Paragraph
  const live = asEditor(editor)
  if (live.isActive('scriptElement')) {
    const element = live.getAttributes('scriptElement').element
    if (Object.values(BlockType).includes(element as BlockType)) return element as BlockType
  }
  if (live.isActive('heading', { level: 1 })) return BlockType.Heading1
  if (live.isActive('heading', { level: 2 })) return BlockType.Heading2
  if (live.isActive('heading')) return BlockType.Heading3
  return BlockType.Paragraph
}

/** What the document is written as, from its doc node (DocWritingFormat.js). */
export function readWritingFormat(editor: unknown): WritingFormat {
  if (!isEditorReady(editor)) return WritingFormat.Prose
  const format = asEditor(editor).state.doc.attrs?.writingFormat
  return format === WritingFormat.Screenplay || format === WritingFormat.Stageplay ? format : WritingFormat.Prose
}

/** Whether the editor's own history can step back or forward. */
const readHistory = (live: PmEditor) => {
  const can = live.can?.()
  return { canUndo: !!can?.undo?.(), canRedo: !!can?.redo?.() }
}

export interface ReadToolbarOptions {
  target: EditorTarget | null
  /**
   * The remembered highlight color: the last one applied, which `setHighlight` sets
   * and the editor's context menu reuses.
   *
   * It is also the fallback for `highlight` when the selection carries no highlight
   * mark. The remembered color, not whatever a color picker is currently showing mid-
   * drag, because it is the one value both sides of the bridge agree on.
   */
  lastHighlightColor: string
}

/** The formatting at the selection — what a native toolbar renders. */
export function readToolbarState(
  editor: unknown,
  { target, lastHighlightColor }: ReadToolbarOptions
): ToolbarState {
  const remembered = lastHighlightColor || TOOLBAR_DEFAULTS.highlight

  if (!isEditorReady(editor)) {
    // A disabled toolbar rather than a stale one. `target: undefined` is the signal.
    return {
      target: undefined,
      color: TOOLBAR_DEFAULTS.color,
      highlight: remembered,
      font: TOOLBAR_DEFAULTS.font,
      fontSize: TOOLBAR_DEFAULTS.fontSize,
      alignment: Alignment.Left,
      blockType: BlockType.Paragraph,
      writingFormat: WritingFormat.Prose,
      activeMarks: readActiveMarks(null),
      canUndo: false,
      canRedo: false,
      lastHighlightColor: remembered,
    }
  }

  const live = asEditor(editor)
  const attrs = live.getAttributes('textStyle') || {}
  const selectedNode = live.state.selection.node
  const selectedName = selectedNode?.type?.name

  // A selected conversation tile or image carries its own alignment; only when neither
  // is selected does the block's text alignment apply.
  const nodeAlignment = selectedName === 'conversationTile' || selectedName === 'image'
    ? (selectedNode?.attrs?.align ?? Alignment.Left)
    : null

  return {
    target: target ?? undefined,
    color: (attrs.color as string) || TOOLBAR_DEFAULTS.color,
    highlight: (live.getAttributes('highlight').color as string) || remembered,
    font: fromCssFontFamily(attrs.fontFamily) || TOOLBAR_DEFAULTS.font,
    fontSize: (attrs.fontSize as string) || TOOLBAR_DEFAULTS.fontSize,
    alignment: toAlignment(
      nodeAlignment ?? live.getAttributes('paragraph').textAlign ?? Alignment.Left
    ),
    blockType: readBlockType(editor),
    writingFormat: readWritingFormat(editor),
    activeMarks: readActiveMarks(editor),
    ...readHistory(live),
    lastHighlightColor: remembered,
  }
}

/**
 * Does the selection overlap a highlight mark?
 *
 * Transcribed from `editorMenu.js`'s `selectionTouchesHighlight`, which is what decides
 * whether the menu offers "Highlight" or "Remove Highlight". `nodesBetween` rather than
 * `rangeHasMark` because the menu's rule is *touches*, not *covers*: a selection
 * overlapping the edge of a highlight offers to remove it.
 */
export function selectionTouchesHighlight(editor: unknown): boolean {
  if (!isEditorReady(editor)) return false
  const live = asEditor(editor)
  const highlightMark = live.state.schema.marks.highlight
  if (!highlightMark) return false

  const { from, to } = live.state.selection
  let found = false
  live.state.doc.nodesBetween(from, to, (node) => {
    if (node.marks?.some((mark) => mark.type === highlightMark)) {
      found = true
      return false
    }
  })
  return found
}

export interface ReadSelectionOptions {
  target: EditorTarget | null
  docPath: string | null
  isCanvas?: boolean
}

/** Everything a context menu needs, read in one pass. */
export function readSelectionContext(
  editor: unknown,
  { target, docPath, isCanvas = false }: ReadSelectionOptions
): SelectionContext | null {
  const anchor = readSelectionAnchor(editor)
  if (!anchor) return null

  return {
    target: target ?? undefined,
    docPath: docPath ?? undefined,
    anchor,
    empty: anchor.from === anchor.to,
    touchesHighlight: selectionTouchesHighlight(editor),
    isCanvas,
  }
}

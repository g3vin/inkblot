/**
 * commands.ts — running a `NativeCommand` against a live editor.
 *
 * The mirror of `readState.ts`: formatting, alignment, tables, selection and text
 * insertion, each driven by a command struct off the bridge rather than by a click
 * next to the editor. Every toolbar and menu — the page's and the native shell's —
 * reaches the editor through these.
 *
 * Each function takes the resolved editor, because resolving a target is the registry's
 * job and doing it twice is how the two disagree.
 */
import { Alignment, BlockType, HistoryAction, ListKind, MarkKind } from '../types'
import type {
  ApplyMarkCommand,
  EditorHistoryCommand,
  SetBlockTypeCommand,
  SetWritingFormatCommand,
  ToggleListCommand,
  InsertCitationCommand,
  InsertPlainTextCommand,
  InsertTableCommand,
  JumpToAnchorCommand,
  ReplaceRangesCommand,
  SetAlignmentCommand,
  SetCaretAtDocPosCommand,
  SetColorCommand,
  SetFontFamilyCommand,
  SetFontSizeCommand,
  SetHighlightCommand,
  SetSelectionCommand,
} from '../types'
import { isEditorReady } from '../lib/editorUtils'
import { toCssFontFamily } from '../lib/systemFonts'
import { resolveAnchor } from './anchors'

/* The editor's command surface, as far as this file reaches. TipTap is untyped here. */
interface Chain {
  focus(): Chain
  run(): boolean
  toggleBold(): Chain
  toggleItalic(): Chain
  toggleUnderline(): Chain
  toggleStrike(): Chain
  setColor(color: string): Chain
  setHighlight(attrs: { color: string }): Chain
  setFontFamily(family: string): Chain
  setMark(name: string, attrs: Record<string, unknown>): Chain
  setTextAlign(align: string): Chain
  updateAttributes(name: string, attrs: Record<string, unknown>): Chain
  insertTable(attrs: { rows: number; cols: number; withHeaderRow: boolean }): Chain
  insertConversationTile(): Chain
  insertCitation(options: { refIds: string[]; locator?: string }): Chain
  insertBibliography(): Chain
  setTextSelection(range: { from: number; to: number } | number): Chain
  insertContent(content: string): Chain
  scrollIntoView(): Chain
  setParagraph(): Chain
  setHeading(attrs: { level: 1 | 2 | 3 }): Chain
  setScriptElement(element: string): Chain
  setWritingFormat(format: string): Chain
  toggleBulletList(): Chain
  toggleOrderedList(): Chain
  undo(): Chain
  redo(): Chain
}

interface CommandEditor {
  chain(): Chain
  state: {
    selection: { node?: { type?: { name?: string }; attrs?: Record<string, unknown> } | null }
    doc: { content: { size: number } }
  }
}

const asEditor = (editor: unknown) => editor as CommandEditor

/** Every command goes through here, so "is it still alive" is asked exactly once. */
const run = (editor: unknown, body: (chain: Chain, live: CommandEditor) => void): boolean => {
  if (!isEditorReady(editor)) return false
  const live = asEditor(editor)
  body(live.chain(), live)
  return true
}

export function applyMark(editor: unknown, { mark }: ApplyMarkCommand): boolean {
  return run(editor, (chain) => {
    switch (mark) {
      case MarkKind.Bold: chain.focus().toggleBold().run(); break
      case MarkKind.Italic: chain.focus().toggleItalic().run(); break
      case MarkKind.Underline: chain.focus().toggleUnderline().run(); break
      case MarkKind.Strike: chain.focus().toggleStrike().run(); break
    }
  })
}

export function setColor(editor: unknown, { color }: SetColorCommand): boolean {
  return run(editor, (chain) => { chain.focus().setColor(color).run() })
}

export function setHighlight(editor: unknown, { color }: SetHighlightCommand): boolean {
  // `remember` is not applied here: it is state about the *toolbar*, not about the
  // document, and it is the surface's job to fold it into the next `ToolbarState`.
  return run(editor, (chain) => { chain.focus().setHighlight({ color }).run() })
}

export function setFontFamily(editor: unknown, { family }: SetFontFamilyCommand): boolean {
  // The command carries a family name; CSS quoting is a detail of this side of the seam.
  return run(editor, (chain) => { chain.focus().setFontFamily(toCssFontFamily(family)).run() })
}

export function setFontSize(editor: unknown, { size }: SetFontSizeCommand): boolean {
  return run(editor, (chain) => { chain.focus().setMark('textStyle', { fontSize: size }).run() })
}

/**
 * Alignment, which is three different edits wearing one name.
 *
 * Transcribed from `Toolbar.applyAlignment`, including the `try`/`catch` around
 * `setTextAlign`: the command is contributed by an extension that a card editor does
 * not load, so on a canvas card it throws and the paragraph attribute is set directly.
 * The image case additionally drops a wrap layout, because an aligned image that is
 * still wrapping text renders somewhere neither setting asked for.
 */
export function setAlignment(editor: unknown, { alignment }: SetAlignmentCommand): boolean {
  return run(editor, (chain, live) => {
    const selected = live.state.selection.node
    const name = selected?.type?.name

    if (name === 'conversationTile') {
      chain.focus().updateAttributes('conversationTile', { align: alignment }).run()
      return
    }

    if (name === 'image') {
      const layout = (selected?.attrs?.layout as string) || 'inline'
      chain
        .focus()
        .updateAttributes('image', {
          align: alignment,
          layout: layout.startsWith('wrap-') ? 'block' : layout,
        })
        .run()
      return
    }

    try {
      chain.focus().setTextAlign(alignment).run()
    } catch {
      live.chain().focus().updateAttributes('paragraph', { textAlign: alignment }).run()
    }
  })
}

export function insertTable(
  editor: unknown,
  { rows, cols, withHeaderRow }: InsertTableCommand
): boolean {
  return run(editor, (chain) => {
    chain.focus().insertTable({ rows, cols, withHeaderRow }).run()
  })
}

/** The Paragraph Style menu. A native toolbar's; the page has only markdown input rules. */
export function setBlockType(editor: unknown, { block }: SetBlockTypeCommand): boolean {
  return run(editor, (chain) => {
    switch (block) {
      case BlockType.Paragraph: chain.focus().setParagraph().run(); break
      case BlockType.Heading1: chain.focus().setHeading({ level: 1 }).run(); break
      case BlockType.Heading2: chain.focus().setHeading({ level: 2 }).run(); break
      case BlockType.Heading3: chain.focus().setHeading({ level: 3 }).run(); break
      // A script's elements share their names with the node's `element` attribute.
      default: chain.focus().setScriptElement(block).run(); break
    }
  })
}

/** Write the document as prose, a screenplay or a play (DocWritingFormat.js). */
export function setWritingFormat(editor: unknown, { format }: SetWritingFormatCommand): boolean {
  return run(editor, (chain) => { chain.focus().setWritingFormat(format).run() })
}

export function toggleList(editor: unknown, { list }: ToggleListCommand): boolean {
  return run(editor, (chain) => {
    switch (list) {
      case ListKind.Bullet: chain.focus().toggleBulletList().run(); break
      case ListKind.Ordered: chain.focus().toggleOrderedList().run(); break
    }
  })
}

/** A document's undo and redo — the editor's own history, not the canvas's. */
export function editorHistory(editor: unknown, { action }: EditorHistoryCommand): boolean {
  return run(editor, (chain) => {
    if (action === HistoryAction.Undo) chain.focus().undo().run()
    else chain.focus().redo().run()
  })
}

export function insertConversationTile(editor: unknown): boolean {
  return run(editor, (chain) => { chain.focus().insertConversationTile().run() })
}

/** Cite sources at the caret (`extensions/Citation.js`). */
export function insertCitation(editor: unknown, { refIds, locator }: InsertCitationCommand): boolean {
  if (!refIds.length) return false
  return run(editor, (chain) => { chain.focus().insertCitation({ refIds, locator: locator || '' }).run() })
}

/** Put the bibliography at the end of the document, or move it there. */
export function insertBibliography(editor: unknown): boolean {
  return run(editor, (chain) => { chain.focus().insertBibliography().run() })
}

export function setSelection(
  editor: unknown,
  { anchor, scrollIntoView, focus }: SetSelectionCommand
): boolean {
  const range = resolveAnchor(editor, anchor, { preferPositions: true })
  if (!range) return false

  return run(editor, (chain) => {
    let next = chain
    if (focus) next = next.focus()
    next = next.setTextSelection(range)
    if (scrollIntoView) next = next.scrollIntoView()
    next.run()
  })
}

/**
 * Put the selection on some text, re-finding it if the positions have gone stale.
 *
 * This is what `EditorLayout.jumpToText` and `Workbench.selectTileWord` become. It
 * returns false rather than guessing when the text is gone — a note whose words were
 * deleted has genuinely lost what it was about, and moving the caret somewhere
 * plausible is worse than doing nothing.
 */
export function jumpToAnchor(
  editor: unknown,
  { anchor, preferPositions }: JumpToAnchorCommand
): boolean {
  const range = resolveAnchor(editor, anchor, { preferPositions })
  if (!range) return false

  return run(editor, (chain) => {
    chain.focus().setTextSelection(range).scrollIntoView().run()
  })
}

/**
 * Apply a batch of edits.
 *
 * Applied last-first. Every edit's positions were resolved against one document state,
 * and applying in document order invalidates the positions of everything after the
 * first — working backwards leaves the untouched earlier ranges where they were. An
 * edit whose anchor no longer resolves is skipped, not guessed at, and the count
 * returned says how many landed.
 */
export function replaceRanges(editor: unknown, { edits }: ReplaceRangesCommand): number {
  if (!isEditorReady(editor)) return 0

  const resolved = edits
    .map((edit) => {
      const range = resolveAnchor(editor, edit.anchor, { preferPositions: true })
      return range ? { range, text: edit.text } : null
    })
    .filter((entry): entry is { range: { from: number; to: number }; text: string } => entry !== null)
    .sort((left, right) => right.range.from - left.range.from)

  let applied = 0
  for (const { range, text } of resolved) {
    const ok = run(editor, (chain) => {
      chain.focus().setTextSelection(range).insertContent(text).run()
    })
    if (ok) applied += 1
  }
  return applied
}

export function setCaretAtDocPos(editor: unknown, { pos }: SetCaretAtDocPosCommand): boolean {
  if (!isEditorReady(editor)) return false
  const size = asEditor(editor).state.doc.content.size
  const clamped = Math.max(0, Math.min(pos, size))

  return run(editor, (chain) => {
    chain.focus().setTextSelection({ from: clamped, to: clamped }).scrollIntoView().run()
  })
}

/**
 * Paste and Match Style: the shell's plain text, through the editor's own paste path.
 *
 * `pasteText` rather than `insertText` so a multi-line paste becomes paragraphs the way
 * a ⌘V of plain text does, and rather than `insertContent` because that one parses a
 * string that looks like HTML *as* HTML — a paste of `<b>` would come out bold, which
 * is the one thing this command exists to prevent.
 */
export function insertPlainText(editor: unknown, { text }: InsertPlainTextCommand): boolean {
  if (!isEditorReady(editor) || !text) return false
  const view = (editor as { view?: {
    focus(): void
    pasteText?(text: string): boolean
    state: { tr: { insertText(text: string): unknown } }
    dispatch(tr: unknown): void
  } }).view
  if (!view) return false

  view.focus()
  if (typeof view.pasteText === 'function') return view.pasteText(text)
  view.dispatch(view.state.tr.insertText(text))
  return true
}

export { Alignment, MarkKind }

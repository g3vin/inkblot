/**
 * selectionTools.js — what the selection wheel can do to selected text.
 *
 * Each tool says how it is drawn (`label`, `icon`), whether it is already on the
 * selection (`isActive`, which fills its icon), whether it can act on this selection at
 * all (`available`; one that can't keeps its place on the wheel, dimmed), and `run`.
 * Highlight has `options`: its inks, chosen by resting on it.
 *
 * `ctx` is what the editor's surroundings lend: the bubble sessions, the highlight
 * colour the toolbar remembers, the notes and the Workbench.
 */
import { INKS, inkVar, resolveInkHex } from './palette'
import { HIDDEN_TEXT } from '../extensions/HiddenText'
import { selectionForBubble } from '../hooks/useBubbleSessions'

const selectedText = (editor) => {
  const { from, to } = editor.state.selection
  return editor.state.doc.textBetween(from, to, ' ').trim()
}
const wordCount = (editor) => selectedText(editor).split(/\s+/).filter(Boolean).length
const has = (editor, mark) => Boolean(editor.state.schema.marks[mark])

/** A mark the editor's own toggle commands take on and off. */
const markTool = (id, label, icon, mark, toggle) => ({
  id,
  label,
  icon,
  isActive: (editor) => editor.isActive(mark),
  available: (editor) => has(editor, mark),
  run: (editor) => { editor.chain().focus()[toggle]().run() },
})

export const SELECTION_TOOLS = [
  {
    id: 'highlight',
    label: 'Highlight',
    icon: 'highlight',
    isActive: (editor) => editor.isActive('highlight'),
    available: (editor) => has(editor, 'highlight'),
    options: () => [
      ...INKS.map((ink) => ({ id: ink.id, label: ink.label, color: inkVar(ink.id) })),
      { id: 'none', label: 'Remove highlight', icon: 'delete' },
    ],
    run: (editor, ctx, option) => {
      if (option === 'none') { editor.chain().focus().unsetHighlight().run(); return }
      const color = option ? resolveInkHex(option, '') : ctx.lastHighlightColor?.()
      if (color) ctx.setHighlight(color, Boolean(option))
    },
  },
  {
    id: 'hide',
    label: 'Hide',
    icon: 'hide',
    labelFor: (editor) => (editor.isActive(HIDDEN_TEXT) ? 'Show' : 'Hide'),
    isActive: (editor) => editor.isActive(HIDDEN_TEXT),
    available: (editor) => has(editor, HIDDEN_TEXT),
    run: (editor) => {
      if (editor.isActive(HIDDEN_TEXT)) editor.chain().focus().unsetHiddenText().run()
      else editor.chain().focus().setHiddenText().run()
    },
  },
  {
    id: 'bubble',
    label: 'Bubble',
    icon: 'chats',
    available: (editor, ctx) => Boolean(ctx.bubbles && selectionForBubble(editor)),
    run: (editor, ctx) => ctx.bubbles.openFromSelection(editor),
  },
  markTool('bold', 'Bold', 'bold', 'bold', 'toggleBold'),
  markTool('italic', 'Italic', 'italic', 'italic', 'toggleItalic'),
  markTool('strike', 'Strikethrough', 'strikethrough', 'strike', 'toggleStrike'),
  markTool('underline', 'Underline', 'underline', 'underline', 'toggleUnderline'),
  {
    id: 'note',
    label: 'Add note',
    icon: 'note',
    available: (_editor, ctx) => Boolean(ctx.addNote),
    run: (_editor, ctx) => ctx.addNote(),
  },
  {
    id: 'define',
    label: 'Define word',
    icon: 'dictionary',
    available: (editor, ctx) => Boolean(ctx.workbench) && wordCount(editor) === 1,
    run: (_editor, ctx) => ctx.workbench('definition'),
  },
  {
    id: 'synonyms',
    label: 'Find synonyms',
    icon: 'book',
    available: (editor, ctx) => Boolean(ctx.workbench) && wordCount(editor) <= 2,
    run: (_editor, ctx) => ctx.workbench('synonym'),
  },
  {
    id: 'clear',
    label: 'Clear formatting',
    icon: 'text-style',
    available: () => true,
    // The writer's styling only: a note's anchor, a bubble session or hidden text stay.
    run: (editor) => {
      const chain = editor.chain().focus()
      ;['bold', 'italic', 'strike', 'underline', 'highlight', 'textStyle', 'code']
        .filter((mark) => has(editor, mark))
        .forEach((mark) => chain.unsetMark(mark))
      chain.run()
    },
  },
]

const BY_ID = new Map(SELECTION_TOOLS.map((tool) => [tool.id, tool]))

export const selectionTool = (id) => BY_ID.get(id) ?? null

/** The wheel as it opens on this selection: each chosen tool, drawn as it is right now. */
export function wheelItems(editor, ctx, ids) {
  return ids.map(selectionTool).filter(Boolean).map((tool) => ({
    id: tool.id,
    label: tool.labelFor?.(editor) ?? tool.label,
    icon: tool.icon,
    active: tool.isActive ? Boolean(tool.isActive(editor)) : undefined,
    disabled: !tool.available(editor, ctx),
    submenu: tool.options?.(editor),
  }))
}

/** Run a tool the wheel took, with the option chosen under it (an ink), if any. */
export function runSelectionTool(editor, ctx, id, option) {
  const tool = selectionTool(id)
  if (!tool || !tool.available(editor, ctx)) return false
  tool.run(editor, ctx, option)
  return true
}

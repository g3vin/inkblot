/**
 * The document toolbar's items: formatting, inserting, history and the view.
 *
 * None touches the editor. Each renders the pushed `ToolbarState` and sends a command
 * naming the editor that state came from, so a state drawn a frame ago cannot apply
 * itself to an editor elected since. The voice controls are the exception, and keep
 * the live editor (see DictationControl, ReadAloudControl).
 */
import { runCommand } from '../../../lib/commands'
import { useEffect, useState } from 'react'
import DictationControl from '../../DictationControl'
import ReadAloudControl from '../../ReadAloudControl'
import { Alignment, BlockType, HistoryAction, ListKind, MarkKind, WritingFormat } from '../../../types'
import {
  buildFontSections,
  loadPinnedFonts,
  loadRecentFonts,
  loadSystemFonts,
  rememberRecentFont,
  toCssFontFamily,
  togglePinnedFont,
} from '../../../lib/systemFonts'
import Icon from '../../../ui/Icon.jsx'
import { ChoiceButton, Glyph, ItemFrame, MenuButton, ToolButton } from '../ToolbarControls'
import InkPicker from '../../../ui/InkPicker.jsx'
import { INKS, resolveInkHex } from '../../../lib/palette'
import { blockOptions } from './blockOptions'

const sendTo = (ctx, type, payload = {}) => {
  const target = ctx.toolbar.target
  if (target) ctx.send(type, { target, ...payload })
}

export function FontItem({ ctx, spec }) {
  const { toolbar } = ctx
  const [systemFonts, setSystemFonts] = useState([])
  const [pinnedFonts, setPinnedFonts] = useState(loadPinnedFonts)
  const [recentFonts, setRecentFonts] = useState(loadRecentFonts)
  useEffect(() => {
    let cancelled = false
    loadSystemFonts().then((fonts) => { if (!cancelled) setSystemFonts(fonts) })
    return () => { cancelled = true }
  }, [])

  const { sections, missingCurrentFont } = buildFontSections({ systemFonts, pinnedFonts, recentFonts, currentFont: toolbar.font })
  const pinned = pinnedFonts.includes(toolbar.font)
  const choose = (family) => {
    setRecentFonts(rememberRecentFont(family))
    sendTo(ctx, 'setFontFamily', { family })
  }
  const fontItem = (font) => ({
    text: font,
    style: { fontFamily: toCssFontFamily(font) },
    checked: font === toolbar.font,
    action: () => choose(font),
  })
  // Pin first, for the font in use; then each section, set apart. The document's font
  // may not be installed here: it is listed anyway, so the row can show what is in use.
  const items = [
    { icon: pinned ? 'unpin' : 'pin', text: pinned ? `Unpin ${toolbar.font}` : `Pin ${toolbar.font}`, keepOpen: true, action: () => setPinnedFonts(togglePinnedFont(toolbar.font)) },
    ...(missingCurrentFont ? [{ separator: true }, fontItem(toolbar.font)] : []),
    ...sections.flatMap(({ fonts }) => [{ separator: true }, ...fonts.map(fontItem)]),
  ]
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <MenuButton label={`Font: ${toolbar.font}`} display={ctx.display} disabled={!toolbar.target} items={items} rowClassName="tb-strip">
        <span className="tb-text tb-value tb-value-font" style={{ fontFamily: toCssFontFamily(toolbar.font) }}>{toolbar.font}</span>
      </MenuButton>
    </ItemFrame>
  )
}

const FONT_SIZES = ['14px', '16px', '18px', '20px', '24px', '28px', '32px', '36px']

/** The size a step from `size` along FONT_SIZES: the next one past it either way. */
const stepSize = (size, by) => {
  const now = parseFloat(size) || 18
  const sizes = by > 0 ? FONT_SIZES : [...FONT_SIZES].reverse()
  return sizes.find((option) => (by > 0 ? parseFloat(option) > now : parseFloat(option) < now)) ?? null
}

export function FontSizeItem({ ctx, spec }) {
  const { toolbar } = ctx
  const smaller = stepSize(toolbar.fontSize, -1)
  const larger = stepSize(toolbar.fontSize, 1)
  const items = [
    { icon: 'subtract', text: 'Smaller', enabled: Boolean(smaller), keepOpen: true, action: () => sendTo(ctx, 'setFontSize', { size: smaller }) },
    { icon: 'add', text: 'Larger', enabled: Boolean(larger), keepOpen: true, action: () => sendTo(ctx, 'setFontSize', { size: larger }) },
    { separator: true },
    ...FONT_SIZES.map((size) => ({ text: String(parseInt(size, 10)), checked: size === toolbar.fontSize, action: () => sendTo(ctx, 'setFontSize', { size }) })),
  ]
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <MenuButton label={`Font size: ${parseInt(toolbar.fontSize, 10) || ''}`} display={ctx.display} disabled={!toolbar.target} items={items}>
        <span className="tb-text tb-value tb-value-size">{parseInt(toolbar.fontSize, 10) || '–'}</span>
      </MenuButton>
    </ItemFrame>
  )
}

const MARKS = [
  { mark: MarkKind.Bold, key: 'bold', icon: 'bold', label: 'Bold' },
  { mark: MarkKind.Italic, key: 'italic', icon: 'italic', label: 'Italic' },
  { mark: MarkKind.Underline, key: 'underline', icon: 'underline', label: 'Underline' },
  { mark: MarkKind.Strike, key: 'strike', icon: 'strikethrough', label: 'Strikethrough' },
]

export function TextStyleItem({ ctx, spec }) {
  const { toolbar } = ctx
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      {MARKS.map(({ mark, key, icon, label }) => (
        <ToolButton
          key={key}
          icon={icon}
          label={label}
          display={ctx.display}
          active={Boolean(toolbar.activeMarks?.[key])}
          disabled={!toolbar.target}
          onClick={() => sendTo(ctx, 'applyMark', { mark })}
        />
      ))}
    </ItemFrame>
  )
}

/** The ink a literal colour is, when it is one as picked here. */
const inkOf = (hex) => INKS.find((ink) => resolveInkHex(ink.id, '').toLowerCase() === String(hex).toLowerCase())?.id ?? null

/**
 * The text colour and the highlighter: the inks, as the colour each shows as now (the
 * document keeps literal colours), and any other colour from the system picker.
 */
function ColorChoice({ ctx, spec, value, glyph, onPick }) {
  const disabled = !ctx.toolbar.target
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <ChoiceButton
        label={spec.label}
        disabled={disabled}
        className="toolbar-color"
        glyph={(
          <>
            {ctx.display === 'label'
              ? <span className="tb-text">{spec.label}</span>
              : <span className={`toolbar-color-glyph${glyph === 'A' ? ' toolbar-color-glyph-text' : ''}`} aria-hidden="true">{glyph === 'A' ? 'A' : <Icon name={glyph} />}</span>}
            <span className="toolbar-color-bar" style={{ background: value }} aria-hidden="true" />
          </>
        )}
      >
        {(close) => (
          <div className="tb-color-row">
            <InkPicker label={spec.label} value={inkOf(value)} onChange={(id) => { onPick(resolveInkHex(id)); close() }} />
            <span className="toolbar-group-divider" aria-hidden="true" />
            <label className="tb-color-custom" title="Another colour">
              <Icon name="palette" />
              <input type="color" value={value} onChange={(e) => onPick(e.target.value)} aria-label="Another colour" />
            </label>
          </div>
        )}
      </ChoiceButton>
    </ItemFrame>
  )
}

export function TextColorItem({ ctx, spec }) {
  return <ColorChoice ctx={ctx} spec={spec} value={ctx.toolbar.color} glyph="A" onPick={(color) => sendTo(ctx, 'setColor', { color })} />
}

export function HighlightItem({ ctx, spec }) {
  return <ColorChoice ctx={ctx} spec={spec} value={ctx.toolbar.highlight} glyph="highlight" onPick={(color) => sendTo(ctx, 'setHighlight', { color, remember: true })} />
}

const ALIGNMENTS = [
  { value: Alignment.Left, icon: 'align-left', label: 'Align left' },
  { value: Alignment.Center, icon: 'align-center', label: 'Align center' },
  { value: Alignment.Right, icon: 'align-right', label: 'Align right' },
]

export function AlignmentItem({ ctx, spec }) {
  const { toolbar } = ctx
  const active = ALIGNMENTS.find((option) => option.value === toolbar.alignment) || ALIGNMENTS[0]
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <MenuButton
        icon={active.icon}
        label={`Alignment: ${active.label}`}
        display={ctx.display}
        disabled={!toolbar.target}
        items={ALIGNMENTS.map((option) => ({
          icon: option.icon,
          text: option.label,
          checked: option.value === toolbar.alignment,
          action: () => sendTo(ctx, 'setAlignment', { alignment: option.value }),
        }))}
      >
        {ctx.display === 'label' ? <span className="tb-text">Alignment</span> : <Icon name={active.icon} />}
      </MenuButton>
    </ItemFrame>
  )
}

export function ParagraphStyleItem({ ctx, spec }) {
  const { toolbar } = ctx
  const format = toolbar.writingFormat || WritingFormat.Prose
  const options = blockOptions(format)
  const prose = format === WritingFormat.Prose
  const block = toolbar.blockType || BlockType.Paragraph
  const current = options.find(([value]) => value === block)?.[1] ?? options[0][1]
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <MenuButton
        label={`${prose ? 'Paragraph style' : 'Script element'}: ${current}`}
        display={ctx.display}
        disabled={!toolbar.target}
        items={options.map(([value, label], index) => ({
          text: label,
          title: prose ? label : `${label} (⌥⌘${index + 1})`,
          checked: value === block,
          action: () => sendTo(ctx, 'setBlockType', { block: value }),
        }))}
      >
        <span className="tb-text tb-value">{current}</span>
      </MenuButton>
    </ItemFrame>
  )
}

function ListItem({ ctx, spec, list, markKey }) {
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <ToolButton
        icon={spec.icon}
        label={spec.label}
        display={ctx.display}
        active={Boolean(ctx.toolbar.activeMarks?.[markKey])}
        disabled={!ctx.toolbar.target}
        onClick={() => sendTo(ctx, 'toggleList', { list })}
      />
    </ItemFrame>
  )
}
export const BulletedListItem = (props) => <ListItem {...props} list={ListKind.Bullet} markKey="bulletList" />
export const NumberedListItem = (props) => <ListItem {...props} list={ListKind.Ordered} markKey="orderedList" />

export function TableItem({ ctx, spec }) {
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <ToolButton
        icon="table"
        label="Insert table"
        display={ctx.display}
        active={Boolean(ctx.toolbar.activeMarks?.table)}
        disabled={!ctx.toolbar.target}
        onClick={() => sendTo(ctx, 'insertTable', { rows: 3, cols: 3, withHeaderRow: true })}
      />
    </ItemFrame>
  )
}

export function ConversationItem({ ctx, spec }) {
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <ToolButton icon="chat" label="Insert conversation" display={ctx.display} disabled={!ctx.toolbar.target} onClick={() => sendTo(ctx, 'insertConversationTile')} />
    </ItemFrame>
  )
}

/** Runs the `notes.add` command (EditorLayout), as ⌥⌘N and the palette do. */
export function AddNoteItem({ ctx, spec }) {
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <ToolButton icon="note" label="Add note" title="Add a note (⌥⌘N)" display={ctx.display} disabled={!ctx.toolbar.target} onClick={() => { void runCommand('notes.add') }} />
    </ItemFrame>
  )
}

export function UndoRedoItem({ ctx, spec }) {
  const { toolbar } = ctx
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <ToolButton icon="undo" label="Undo" title="Undo (⌘Z)" display={ctx.display} disabled={!toolbar.target || !toolbar.canUndo} onClick={() => sendTo(ctx, 'editorHistory', { action: HistoryAction.Undo })} />
      <ToolButton icon="redo" label="Redo" title="Redo (⇧⌘Z)" display={ctx.display} disabled={!toolbar.target || !toolbar.canRedo} onClick={() => sendTo(ctx, 'editorHistory', { action: HistoryAction.Redo })} />
    </ItemFrame>
  )
}

export function PasteAndMatchStyleItem({ ctx, spec }) {
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <ToolButton
        icon={spec.icon}
        label={spec.label}
        title="Paste and match style (⌥⇧⌘V)"
        display={ctx.display}
        disabled={!ctx.toolbar.target}
        onClick={async () => {
          try {
            const text = await navigator.clipboard.readText()
            if (text) sendTo(ctx, 'insertPlainText', { text })
          } catch {
            // Nothing readable on the clipboard.
          }
        }}
      />
    </ItemFrame>
  )
}

export function FocusModeItem({ ctx, spec }) {
  const on = Boolean(ctx.view.focusMode)
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <ToolButton icon="crosshair" label={spec.label} title={on ? 'Leave focus mode' : 'Focus mode'} display={ctx.display} active={on} disabled={!ctx.toolbar.target && !on} onClick={() => ctx.send('setFocusMode', { open: !on })} />
    </ItemFrame>
  )
}

export function WordCountItem({ ctx, spec }) {
  const on = ctx.view.wordCountVisible !== false
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <ToolButton icon="number" label={spec.label} title={on ? 'Hide the word count' : 'Show the word count'} display={ctx.display} active={on} onClick={() => ctx.send('setWordCountVisible', { visible: !on })} />
    </ItemFrame>
  )
}

export function DictationItem({ ctx, spec }) {
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      {ctx.editor ? <DictationControl editor={ctx.editor} /> : <ToolButton icon="dictate" label={spec.label} display={ctx.display} disabled />}
    </ItemFrame>
  )
}

export function ReadAloudItem({ ctx, spec }) {
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      {ctx.editor ? <ReadAloudControl editor={ctx.editor} /> : <ToolButton icon="read-aloud" label={spec.label} display={ctx.display} disabled />}
    </ItemFrame>
  )
}

/** Write's page view: the prose on the pages it will print on, still written in Write. */
export function PageViewItem({ ctx, spec }) {
  const shown = Boolean(ctx.layout?.enabled)
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <ToolButton
        icon={spec.icon}
        label={spec.label}
        title={shown ? 'Write in the continuous editor (⌥⌘P)' : 'Write on the pages (⌥⌘P)'}
        display={ctx.display}
        active={shown}
        disabled={!ctx.editor}
        onClick={() => ctx.send('setPrintLayout', { enabled: !shown })}
      />
    </ItemFrame>
  )
}

/** Write | Typeset, for the whole window. */
export function EditorModeItem({ ctx, spec }) {
  const mode = ctx.layout?.mode || 'write'
  const disabled = !ctx.hasProject
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      {[['write', 'Write', 'write'], ['typeset', 'Typeset', 'type-style']].map(([value, label, icon]) => (
        <button
          key={value}
          type="button"
          className={mode === value ? 'active' : ''}
          aria-pressed={mode === value}
          title={label}
          disabled={disabled}
          onClick={() => ctx.send('setEditorMode', { mode: value })}
        >
          <Glyph icon={icon} label={label} display={ctx.display} />
        </button>
      ))}
    </ItemFrame>
  )
}

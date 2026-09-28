/**
 * The document toolbar's items: formatting, inserting, history and the view.
 *
 * None touches the editor. Each renders the pushed `ToolbarState` and sends a command
 * naming the editor that state came from, so a state drawn a frame ago cannot apply
 * itself to an editor elected since. The voice controls are the exception, and keep
 * the live editor (see DictationControl, ReadAloudControl).
 */
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
import SFIcon from '../../SFIcon'
import { Glyph, ItemFrame, MenuButton, ToolButton } from '../ToolbarControls'
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
  const disabled = !toolbar.target
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <select
        className="toolbar-select toolbar-select-font"
        value={toolbar.font}
        disabled={disabled}
        onChange={(e) => {
          setRecentFonts(rememberRecentFont(e.target.value))
          sendTo(ctx, 'setFontFamily', { family: e.target.value })
        }}
        aria-label="Font"
        title={`Font: ${toolbar.font}`}
      >
        {/* The document's font may not be installed here. Keep it selectable so
            opening the picker does not silently reassign it. */}
        {missingCurrentFont && <option value={toolbar.font}>{toolbar.font}</option>}
        {sections.map(({ label, fonts }) => (
          <optgroup key={label} label={label}>
            {fonts.map((font) => (
              <option key={font} value={font} style={{ fontFamily: toCssFontFamily(font) }}>{font}</option>
            ))}
          </optgroup>
        ))}
      </select>
      <button
        type="button"
        className={pinned ? 'active' : ''}
        disabled={disabled}
        onClick={() => setPinnedFonts(togglePinnedFont(toolbar.font))}
        aria-pressed={pinned}
        aria-label={pinned ? `Unpin ${toolbar.font}` : `Pin ${toolbar.font}`}
        title={pinned ? `Unpin ${toolbar.font}` : `Pin ${toolbar.font}`}
      >
        <SFIcon name="pin" filled={pinned} />
      </button>
    </ItemFrame>
  )
}

const FONT_SIZES = ['14px', '16px', '18px', '20px', '24px', '28px', '32px', '36px']

export function FontSizeItem({ ctx, spec }) {
  const { toolbar } = ctx
  const sizes = FONT_SIZES.includes(toolbar.fontSize) ? FONT_SIZES : [toolbar.fontSize, ...FONT_SIZES]
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <select
        className="toolbar-select toolbar-select-size"
        value={toolbar.fontSize}
        disabled={!toolbar.target}
        onChange={(e) => sendTo(ctx, 'setFontSize', { size: e.target.value })}
        aria-label="Font size"
        title="Font size"
      >
        {sizes.map((size) => <option key={size} value={size}>{parseInt(size, 10)}</option>)}
      </select>
    </ItemFrame>
  )
}

const MARKS = [
  { mark: MarkKind.Bold, key: 'bold', symbol: 'bold', label: 'Bold' },
  { mark: MarkKind.Italic, key: 'italic', symbol: 'italic', label: 'Italic' },
  { mark: MarkKind.Underline, key: 'underline', symbol: 'underline', label: 'Underline' },
  { mark: MarkKind.Strike, key: 'strike', symbol: 'strikethrough', label: 'Strikethrough' },
]

export function TextStyleItem({ ctx, spec }) {
  const { toolbar } = ctx
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      {MARKS.map(({ mark, key, symbol, label }) => (
        <ToolButton
          key={key}
          symbol={symbol}
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

function ColorWell({ ctx, spec, value, glyph, onChange, onBlur }) {
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <label className="toolbar-color" title={spec.label} aria-disabled={!ctx.toolbar.target}>
        {ctx.display === 'label'
          ? <span className="tb-text">{spec.label}</span>
          : <span className={`toolbar-color-glyph${glyph === 'A' ? ' toolbar-color-glyph-text' : ''}`} aria-hidden="true">{glyph === 'A' ? 'A' : <SFIcon name={glyph} />}</span>}
        <span className="toolbar-color-bar" style={{ background: value }} aria-hidden="true" />
        <input type="color" value={value} disabled={!ctx.toolbar.target} onChange={onChange} onBlur={onBlur} aria-label={spec.label} />
      </label>
    </ItemFrame>
  )
}

export function TextColorItem({ ctx, spec }) {
  return <ColorWell ctx={ctx} spec={spec} value={ctx.toolbar.color} glyph="A" onChange={(e) => sendTo(ctx, 'setColor', { color: e.target.value })} />
}

export function HighlightItem({ ctx, spec }) {
  // The picker's value mid-drag: a pushed state arriving then would yank the swatch
  // back and fight the picker, so while this is set it wins.
  const [draft, setDraft] = useState(null)
  return (
    <ColorWell
      ctx={ctx}
      spec={spec}
      value={draft ?? ctx.toolbar.highlight}
      glyph="highlighter"
      onBlur={() => setDraft(null)}
      onChange={(e) => {
        setDraft(e.target.value)
        sendTo(ctx, 'setHighlight', { color: e.target.value, remember: true })
      }}
    />
  )
}

const ALIGNMENTS = [
  { value: Alignment.Left, symbol: 'text.alignleft', label: 'Align Left' },
  { value: Alignment.Center, symbol: 'text.aligncenter', label: 'Align Center' },
  { value: Alignment.Right, symbol: 'text.alignright', label: 'Align Right' },
]

export function AlignmentItem({ ctx, spec }) {
  const { toolbar } = ctx
  const active = ALIGNMENTS.find((option) => option.value === toolbar.alignment) || ALIGNMENTS[0]
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <MenuButton
        symbol={active.symbol}
        label={`Alignment: ${active.label}`}
        display={ctx.display}
        disabled={!toolbar.target}
        items={ALIGNMENTS.map((option) => ({
          text: option.label,
          checked: option.value === toolbar.alignment,
          action: () => sendTo(ctx, 'setAlignment', { alignment: option.value }),
        }))}
      >
        {ctx.display === 'label' ? <span className="tb-text">Alignment</span> : <SFIcon name={active.symbol} />}
      </MenuButton>
    </ItemFrame>
  )
}

export function ParagraphStyleItem({ ctx, spec }) {
  const { toolbar } = ctx
  const format = toolbar.writingFormat || WritingFormat.Prose
  const options = blockOptions(format)
  const title = format === WritingFormat.Prose ? 'Paragraph Style' : 'Script Element'
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <select
        className="toolbar-select"
        value={toolbar.blockType || BlockType.Paragraph}
        disabled={!toolbar.target}
        onChange={(e) => sendTo(ctx, 'setBlockType', { block: e.target.value })}
        aria-label={title}
        title={title}
      >
        {options.map(([block, label], index) => (
          <option key={block} value={block}>{format === WritingFormat.Prose ? label : `${label}  ⌥⌘${index + 1}`}</option>
        ))}
      </select>
    </ItemFrame>
  )
}

function ListItem({ ctx, spec, list, markKey }) {
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <ToolButton
        symbol={spec.symbol}
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
        symbol="table.grid"
        label="Insert Table"
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
      <ToolButton symbol="speech" label="Insert Conversation" display={ctx.display} disabled={!ctx.toolbar.target} onClick={() => sendTo(ctx, 'insertConversationTile')} />
    </ItemFrame>
  )
}

export function UndoRedoItem({ ctx, spec }) {
  const { toolbar } = ctx
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <ToolButton symbol="arrow.uturn.backward" label="Undo" title="Undo (⌘Z)" display={ctx.display} disabled={!toolbar.target || !toolbar.canUndo} onClick={() => sendTo(ctx, 'editorHistory', { action: HistoryAction.Undo })} />
      <ToolButton symbol="arrow.uturn.forward" label="Redo" title="Redo (⇧⌘Z)" display={ctx.display} disabled={!toolbar.target || !toolbar.canRedo} onClick={() => sendTo(ctx, 'editorHistory', { action: HistoryAction.Redo })} />
    </ItemFrame>
  )
}

export function PasteAndMatchStyleItem({ ctx, spec }) {
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <ToolButton
        symbol={spec.symbol}
        label={spec.label}
        title="Paste and Match Style (⌥⇧⌘V)"
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
      <ToolButton symbol="scope" label={spec.label} title={on ? 'Leave Focus Mode' : 'Focus Mode'} display={ctx.display} active={on} disabled={!ctx.toolbar.target && !on} onClick={() => ctx.send('setFocusMode', { open: !on })} />
    </ItemFrame>
  )
}

export function WordCountItem({ ctx, spec }) {
  const on = ctx.view.wordCountVisible !== false
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <ToolButton symbol="number" label={spec.label} title={on ? 'Hide the word count' : 'Show the word count'} display={ctx.display} active={on} onClick={() => ctx.send('setWordCountVisible', { visible: !on })} />
    </ItemFrame>
  )
}

export function DictationItem({ ctx, spec }) {
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      {ctx.editor ? <DictationControl editor={ctx.editor} /> : <ToolButton symbol="mic" label={spec.label} display={ctx.display} disabled />}
    </ItemFrame>
  )
}

export function ReadAloudItem({ ctx, spec }) {
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      {ctx.editor ? <ReadAloudControl editor={ctx.editor} /> : <ToolButton symbol="read.aloud" label={spec.label} display={ctx.display} disabled />}
    </ItemFrame>
  )
}

/** Write | Typeset, for the whole window. */
export function EditorModeItem({ ctx, spec }) {
  const mode = ctx.layout?.mode || 'write'
  const disabled = !ctx.hasProject
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      {[['write', 'Write', 'pencil.line'], ['typeset', 'Typeset', 'textformat']].map(([value, label, symbol]) => (
        <button
          key={value}
          type="button"
          className={mode === value ? 'active' : ''}
          aria-pressed={mode === value}
          title={`${label} (⌥⌘P)`}
          disabled={disabled}
          onClick={() => ctx.send('setEditorMode', { mode: value })}
        >
          <Glyph symbol={symbol} label={label} display={ctx.display} />
        </button>
      ))}
    </ItemFrame>
  )
}

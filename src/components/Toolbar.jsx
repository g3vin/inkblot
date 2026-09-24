/**
 * Toolbar.jsx — formatting toolbar rendered in the titlebar.
 *
 * Mirrors the active editor's formatting at the current selection (marks,
 * colors, font, size, alignment) and applies changes back through the bridge.
 * Also hosts the table/conversation-tile inserters and the dictation and
 * read-aloud controls.
 *
 * **This component used to hold the editor, and no longer does.** It read about
 * ten facts out of a live TipTap instance on every `selectionUpdate` and called
 * `editor.chain()` on every click. Both directions now go through the bridge
 * protocol: it renders a pushed `ToolbarState` and sends `NativeCommand`s. That is
 * sharp edge #1 of Phase 4, and the point of it is that this file is now written
 * the way an `NSToolbar` will have to be written — it cannot ask the document a
 * question, because in Phase 5 it will not be able to.
 *
 * The reading did not disappear, it moved: `bridge/readState.ts` does it, and
 * `bridge/useSurfacePublisher.ts` decides when. The frame coalescing that used to
 * live here as a `requestAnimationFrame` ref is `bridge/coalesce.ts`.
 *
 * What is still local is what is genuinely about this control and not about the
 * document: which fonts are pinned or recent, whether the alignment menu is open,
 * and the highlight picker's in-progress value. Controls are batched into segmented
 * groups that share one background (marks, colors, insert) to keep the titlebar
 * compact. Alignment collapses to the active option and reveals the rest in a hover
 * menu, which is portaled out because the titlebar clips overflow.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './Toolbar.css'
import SFIcon from './SFIcon'
import DictationControl from './DictationControl'
import ReadAloudControl from './ReadAloudControl'
import { isEditorReady } from '../lib/editorUtils'
import { shellBridge, useBridgeState } from '../bridge'
import { Alignment, MarkKind } from '../types'
import {
  buildFontSections,
  loadPinnedFonts,
  loadRecentFonts,
  loadSystemFonts,
  rememberRecentFont,
  toCssFontFamily,
  togglePinnedFont,
} from '../lib/systemFonts'

/**
 * What the toolbar shows before the first state arrives.
 *
 * `target: undefined` is the protocol's way of saying "no live editor", so this is
 * also what it shows when there is nothing to format — which is the same thing, and
 * used to be two different code paths.
 */
const DEFAULT_TOOLBAR_STATE = {
  target: undefined,
  color: '#000000',
  highlight: '#ffff00',
  font: 'Georgia',
  fontSize: '18px',
  alignment: Alignment.Left,
  activeMarks: {
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    table: false,
  },
  lastHighlightColor: '#ffff00',
}

const ALIGNMENTS = [
  { value: Alignment.Left, icon: 'text.alignleft', label: 'Align left' },
  { value: Alignment.Center, icon: 'text.aligncenter', label: 'Align center' },
  { value: Alignment.Right, icon: 'text.alignright', label: 'Align right' },
]

// Grace period so the pointer can travel from the trigger to the menu without
// the menu closing underneath it.
const ALIGN_MENU_CLOSE_DELAY_MS = 160

export default function Toolbar({ editor }) {
  const toolbarState = useBridgeState('toolbarState', DEFAULT_TOOLBAR_STATE)

  // The highlight picker's value while the user is dragging inside it. A pushed
  // state arriving mid-drag would yank the swatch back to the document's colour and
  // fight the picker, which is the same reason the old `userSelectingHighlight`
  // guard existed — it is only expressed as an override now instead of by
  // suppressing part of an incoming update.
  const [highlightDraft, setHighlightDraft] = useState(null)
  const [alignMenuAnchor, setAlignMenuAnchor] = useState(null)
  const [systemFonts, setSystemFonts] = useState([])
  const [pinnedFonts, setPinnedFonts] = useState(loadPinnedFonts)
  const [recentFonts, setRecentFonts] = useState(loadRecentFonts)
  const alignTriggerRef = useRef(null)
  const alignCloseTimerRef = useRef(null)

  useEffect(() => {
    let cancelled = false

    loadSystemFonts().then((fonts) => {
      if (!cancelled) setSystemFonts(fonts)
    })

    return () => { cancelled = true }
  }, [])

  /* ---------------- sending ---------------- */

  // Every command names the editor the state came from rather than "the active one",
  // so a state rendered a frame ago cannot apply itself to an editor elected since.
  const target = toolbarState.target
  const send = useCallback((type, payload) => {
    if (!target) return
    shellBridge.send(type, { target, ...payload })
  }, [target])

  const applyMark = (mark) => send('applyMark', { mark })
  const applyColor = (color) => send('setColor', { color })

  const applyHighlight = (color) => {
    setHighlightDraft(color)
    send('setHighlight', { color, remember: true })
  }

  const applyFont = (font) => {
    setRecentFonts(rememberRecentFont(font))
    send('setFontFamily', { family: font })
  }

  const applyFontSize = (size) => send('setFontSize', { size })
  const applyAlignment = (alignment) => send('setAlignment', { alignment })

  const insertTable = () => send('insertTable', { rows: 3, cols: 3, withHeaderRow: true })
  const insertConversationTile = () => send('insertConversationTile', {})

  const toggleCurrentFontPin = () => {
    setPinnedFonts(togglePinnedFont(toolbarState.font))
  }

  /* ---------------- the alignment menu ---------------- */

  const cancelAlignMenuClose = useCallback(() => {
    if (!alignCloseTimerRef.current) return
    clearTimeout(alignCloseTimerRef.current)
    alignCloseTimerRef.current = null
  }, [])

  // Anchor the portaled menu under the trigger; the titlebar clips overflow so
  // it cannot simply be absolutely positioned inside the toolbar.
  const openAlignMenu = useCallback(() => {
    cancelAlignMenuClose()
    const rect = alignTriggerRef.current?.getBoundingClientRect()
    if (!rect) return
    setAlignMenuAnchor({ top: rect.bottom + 6, left: rect.left })
  }, [cancelAlignMenuClose])

  const closeAlignMenu = useCallback(() => {
    cancelAlignMenuClose()
    setAlignMenuAnchor(null)
  }, [cancelAlignMenuClose])

  const scheduleAlignMenuClose = useCallback(() => {
    cancelAlignMenuClose()
    alignCloseTimerRef.current = setTimeout(() => {
      alignCloseTimerRef.current = null
      setAlignMenuAnchor(null)
    }, ALIGN_MENU_CLOSE_DELAY_MS)
  }, [cancelAlignMenuClose])

  useEffect(() => () => cancelAlignMenuClose(), [cancelAlignMenuClose])

  useEffect(() => {
    if (!alignMenuAnchor) return undefined

    const onKeyDown = (event) => {
      if (event.key === 'Escape') closeAlignMenu()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [alignMenuAnchor, closeAlignMenu])

  // The voice controls keep the editor: the dictation draft state machine is a
  // read-modify-write at speaking rate and stays on this side of the seam
  // (sharp edge #2), and Read Aloud's highlight scheduler maps audio time to
  // ProseMirror positions, which cannot cross it at all.
  if (!isEditorReady(editor)) return null

  const selectAlignment = (alignment) => {
    applyAlignment(alignment)
    closeAlignMenu()
  }

  const activeAlignment = ALIGNMENTS.find(option => option.value === toolbarState.alignment) || ALIGNMENTS[0]
  const highlightValue = highlightDraft ?? toolbarState.highlight

  const { sections: fontSections, missingCurrentFont } = buildFontSections({
    systemFonts,
    pinnedFonts,
    recentFonts,
    currentFont: toolbarState.font,
  })
  const isCurrentFontPinned = pinnedFonts.includes(toolbarState.font)

  const alignMenu = alignMenuAnchor ? createPortal(
    <div
      className="toolbar-align-menu"
      style={{
        '--align-menu-top': `${alignMenuAnchor.top}px`,
        '--align-menu-left': `${alignMenuAnchor.left}px`,
      }}
      onPointerEnter={cancelAlignMenuClose}
      onPointerLeave={scheduleAlignMenuClose}
      role="menu"
      aria-label="Alignment"
    >
      {ALIGNMENTS.map(option => (
        <button
          key={option.value}
          type="button"
          role="menuitemradio"
          aria-checked={option.value === toolbarState.alignment}
          className={option.value === toolbarState.alignment ? 'active' : ''}
          onClick={() => selectAlignment(option.value)}
          title={option.label}
          aria-label={option.label}
        >
          <SFIcon name={option.icon} />
        </button>
      ))}
    </div>,
    document.body,
  ) : null

  return (
    <div className="toolbar-wrapper">
      <div className="toolbar">
        <div className="toolbar-group toolbar-group-text">
          <select
            className="toolbar-select toolbar-select-font"
            value={toolbarState.font}
            onChange={(e) => applyFont(e.target.value)}
            aria-label="Font"
            title={`Font: ${toolbarState.font}`}
          >
            {/* The document's font may not be installed on this machine (a note
                written elsewhere). Keep it selectable so opening the picker
                doesn't silently reassign it. */}
            {missingCurrentFont && (
              <option value={toolbarState.font}>{toolbarState.font}</option>
            )}
            {fontSections.map(({ label, fonts }) => (
              <optgroup key={label} label={label}>
                {fonts.map(font => (
                  <option key={font} value={font} style={{ fontFamily: toCssFontFamily(font) }}>
                    {font}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {/* Pins the font that is currently selected. A native menu cannot host
              controls inside its own options, so the pin toggle lives beside it. */}
          <button
            type="button"
            className={isCurrentFontPinned ? 'active' : ''}
            onClick={toggleCurrentFontPin}
            aria-pressed={isCurrentFontPinned}
            aria-label={isCurrentFontPinned ? `Unpin ${toolbarState.font}` : `Pin ${toolbarState.font}`}
            title={isCurrentFontPinned ? `Unpin ${toolbarState.font}` : `Pin ${toolbarState.font}`}
          >
            <SFIcon name="pin" filled={isCurrentFontPinned} />
          </button>
          <span className="toolbar-group-divider" />
          <select
            className="toolbar-select toolbar-select-size"
            value={toolbarState.fontSize}
            onChange={(e) => applyFontSize(e.target.value)}
            aria-label="Font size"
            title="Font size"
          >
            {['14px', '16px', '18px', '20px', '24px', '28px', '32px', '36px'].map(size => (
              <option key={size} value={size}>{parseInt(size, 10)}</option>
            ))}
          </select>
        </div>

        {/* Marks share one background but stay individually toggleable. */}
        <div className="toolbar-group toolbar-group-marks">
          <button
            type="button"
            className={toolbarState.activeMarks.bold ? 'active' : ''}
            onClick={() => applyMark(MarkKind.Bold)}
            aria-label="Bold"
            aria-pressed={toolbarState.activeMarks.bold}
            title="Bold"
          >
            <SFIcon name="bold" filled={toolbarState.activeMarks.bold} />
          </button>
          <button
            type="button"
            className={toolbarState.activeMarks.italic ? 'active' : ''}
            onClick={() => applyMark(MarkKind.Italic)}
            aria-label="Italic"
            aria-pressed={toolbarState.activeMarks.italic}
            title="Italic"
          >
            <SFIcon name="italic" filled={toolbarState.activeMarks.italic} />
          </button>
          <button
            type="button"
            className={toolbarState.activeMarks.underline ? 'active' : ''}
            onClick={() => applyMark(MarkKind.Underline)}
            aria-label="Underline"
            aria-pressed={toolbarState.activeMarks.underline}
            title="Underline"
          >
            <SFIcon name="underline" filled={toolbarState.activeMarks.underline} />
          </button>
          <button
            type="button"
            className={toolbarState.activeMarks.strike ? 'active' : ''}
            onClick={() => applyMark(MarkKind.Strike)}
            aria-label="Strikethrough"
            aria-pressed={toolbarState.activeMarks.strike}
            title="Strikethrough"
          >
            <SFIcon name="strikethrough" filled={toolbarState.activeMarks.strike} />
          </button>
        </div>

        {/* The native swatch fills the control, so the glyph reads as the button. */}
        <div className="toolbar-group toolbar-group-colors">
          <label className="toolbar-color" title="Text color">
            <span className="toolbar-color-glyph toolbar-color-glyph-text" aria-hidden="true">A</span>
            <span className="toolbar-color-bar" style={{ background: toolbarState.color }} aria-hidden="true" />
            <input
              type="color"
              value={toolbarState.color}
              onChange={(e) => applyColor(e.target.value)}
              aria-label="Text color"
            />
          </label>
          <label className="toolbar-color" title="Highlight color">
            <span className="toolbar-color-glyph" aria-hidden="true">
              <SFIcon name="paintpalette" />
            </span>
            <span className="toolbar-color-bar" style={{ background: highlightValue }} aria-hidden="true" />
            <input
              type="color"
              value={highlightValue}
              onBlur={() => setHighlightDraft(null)}
              onChange={(e) => applyHighlight(e.target.value)}
              aria-label="Highlight color"
            />
          </label>
        </div>

        {/* Collapsed to the active alignment; hover or click reveals the rest. */}
        <div
          className="toolbar-align"
          onPointerEnter={openAlignMenu}
          onPointerLeave={scheduleAlignMenuClose}
        >
          <button
            type="button"
            ref={alignTriggerRef}
            className={`toolbar-align-trigger ${alignMenuAnchor ? 'open' : ''}`}
            onClick={() => (alignMenuAnchor ? closeAlignMenu() : openAlignMenu())}
            onFocus={openAlignMenu}
            aria-haspopup="menu"
            aria-expanded={Boolean(alignMenuAnchor)}
            aria-label={`Alignment: ${activeAlignment.label}`}
            title={`Alignment: ${activeAlignment.label}`}
          >
            <SFIcon name={activeAlignment.icon} />
            <SFIcon name="chevron.down" size={10} className="toolbar-align-caret" />
          </button>
        </div>

        <div className="toolbar-group toolbar-group-insert">
          <button
            type="button"
            className={toolbarState.activeMarks.table ? 'active' : ''}
            onClick={insertTable}
            aria-label="Insert table"
            title="Insert table"
          >
            <SFIcon name="table.grid" />
          </button>
          <button
            type="button"
            onClick={insertConversationTile}
            aria-label="Insert text conversation"
            title="Insert text conversation"
          >
            <SFIcon name="speech" />
          </button>
        </div>

        <div className="toolbar-group toolbar-group-voice">
          <DictationControl editor={editor} />
          <ReadAloudControl editor={editor} />
        </div>
      </div>
      {alignMenu}
    </div>
  )
}

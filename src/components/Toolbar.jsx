/**
 * Toolbar.jsx — formatting toolbar rendered in the titlebar.
 *
 * Mirrors the active editor's formatting at the current selection (marks,
 * colors, font, size, alignment) and applies changes back through TipTap
 * commands. Also hosts the table/conversation-tile inserters and the
 * dictation and read-aloud controls.
 *
 * Controls are batched into segmented groups that share one background
 * (marks, colors, insert) to keep the titlebar compact. Alignment collapses
 * to the active option and reveals the rest in a hover menu, which is
 * portaled out because the titlebar clips overflow.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './Toolbar.css'
import SFIcon from './SFIcon'
import DictationControl from './DictationControl'
import ReadAloudControl from './ReadAloudControl'
import { isEditorReady } from '../lib/editorUtils'
import {
  buildFontSections,
  fromCssFontFamily,
  loadPinnedFonts,
  loadRecentFonts,
  loadSystemFonts,
  rememberRecentFont,
  toCssFontFamily,
  togglePinnedFont,
} from '../lib/systemFonts'

const DEFAULT_TOOLBAR_STATE = {
  color: '#000000',
  highlight: '#ffff00',
  font: 'Georgia',
  fontSize: '18px',
  alignment: 'left',
  activeMarks: {
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    table: false,
  },
}

const ALIGNMENTS = [
  { value: 'left', icon: 'text.alignleft', label: 'Align left' },
  { value: 'center', icon: 'text.aligncenter', label: 'Align center' },
  { value: 'right', icon: 'text.alignright', label: 'Align right' },
]

// Grace period so the pointer can travel from the trigger to the menu without
// the menu closing underneath it.
const ALIGN_MENU_CLOSE_DELAY_MS = 160

const areActiveMarksEqual = (left, right) => (
  left.bold === right.bold &&
  left.italic === right.italic &&
  left.underline === right.underline &&
  left.strike === right.strike &&
  left.table === right.table
)

const areToolbarStatesEqual = (left, right) => (
  left.color === right.color &&
  left.highlight === right.highlight &&
  left.font === right.font &&
  left.fontSize === right.fontSize &&
  left.alignment === right.alignment &&
  areActiveMarksEqual(left.activeMarks, right.activeMarks)
)

export default function Toolbar({ editor }) {
  const [userSelectingHighlight, setUserSelectingHighlight] = useState(false)
  const [toolbarState, setToolbarState] = useState(DEFAULT_TOOLBAR_STATE)
  const [alignMenuAnchor, setAlignMenuAnchor] = useState(null)
  const [systemFonts, setSystemFonts] = useState([])
  const [pinnedFonts, setPinnedFonts] = useState(loadPinnedFonts)
  const [recentFonts, setRecentFonts] = useState(loadRecentFonts)
  const frameRef = useRef(null)
  const userSelectingHighlightRef = useRef(false)
  const alignTriggerRef = useRef(null)
  const alignCloseTimerRef = useRef(null)

  useEffect(() => {
    userSelectingHighlightRef.current = userSelectingHighlight
  }, [userSelectingHighlight])

  useEffect(() => {
    let cancelled = false

    loadSystemFonts().then((fonts) => {
      if (!cancelled) setSystemFonts(fonts)
    })

    return () => { cancelled = true }
  }, [])

  // Snapshot the formatting at the current selection into toolbar state.
  // For collapsed selections, mark state comes from the adjacent text node.
  const readToolbarState = useCallback(() => {
    if (!isEditorReady(editor)) return null

    const attrs = editor.getAttributes('textStyle') || {}
    const { state } = editor
    const { from, to, empty, $from } = state.selection
    const selectedNode = state.selection.node
    const selectedConversationAlign = selectedNode?.type?.name === 'conversationTile'
      ? selectedNode.attrs.align || 'left'
      : null
    const selectedImageAlign = selectedNode?.type?.name === 'image'
      ? selectedNode.attrs.align || 'left'
      : null
    const getMarkActive = (markName) => {
      const markType = state.schema.marks[markName]
      if (!markType) return false
      if (!empty) {
        return state.doc.rangeHasMark(from, to, markType)
      }

      const parent = $from.parent
      const offset = $from.parentOffset
      const afterNode = parent.childAfter(offset).node
      const beforeNode = parent.childBefore(offset).node
      const pickNode = (afterNode?.isText && afterNode) || (beforeNode?.isText && beforeNode)
      const marks = pickNode?.marks || []
      return marks.some(mark => mark.type === markType)
    }

    return {
      color: attrs.color || '#000000',
      highlight: editor.getAttributes('highlight').color || toolbarState.highlight,
      font: fromCssFontFamily(attrs.fontFamily) || 'Georgia',
      fontSize: attrs.fontSize || '18px',
      alignment: selectedConversationAlign || selectedImageAlign || editor.getAttributes('paragraph').textAlign || 'left',
      activeMarks: {
        bold: getMarkActive('bold'),
        italic: getMarkActive('italic'),
        underline: getMarkActive('underline'),
        strike: getMarkActive('strike'),
        table: editor.isActive('table'),
      },
    }
  }, [editor, toolbarState.highlight])

  // Refresh toolbar state at most once per animation frame. While the user is
  // interacting with the highlight color input, its value is left alone so the
  // picker doesn't fight the selection.
  const updateToolbar = useCallback(() => {
    if (frameRef.current) return

    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null
      const next = readToolbarState()
      if (!next) return

      setToolbarState((current) => {
        const normalizedNext = userSelectingHighlightRef.current
          ? { ...next, highlight: current.highlight }
          : next
        return areToolbarStatesEqual(current, normalizedNext) ? current : normalizedNext
      })
    })
  }, [readToolbarState])

  useEffect(() => {
    if (!isEditorReady(editor)) return undefined

    editor.on('selectionUpdate', updateToolbar)
    updateToolbar()

    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
      if (!editor.isDestroyed) {
        editor.off('selectionUpdate', updateToolbar)
      }
    }
  }, [editor, updateToolbar])

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

  if (!isEditorReady(editor)) return null

  const runEditorCommand = (command) => {
    if (!isEditorReady(editor)) return
    command(editor)
    updateToolbar()
  }

  const applyColor = (c) => {
    setToolbarState(current => ({ ...current, color: c }))
    runEditorCommand(currentEditor => currentEditor.chain().focus().setColor(c).run())
  }

  const applyHighlight = (c) => {
    setToolbarState(current => ({ ...current, highlight: c }))
    if (editor.storage) Reflect.set(editor.storage, 'lastHighlightColor', c)
    runEditorCommand(currentEditor => currentEditor.chain().focus().setHighlight({ color: c }).run())
  }

  const applyFont = (f) => {
    setToolbarState(current => ({ ...current, font: f }))
    setRecentFonts(rememberRecentFont(f))
    runEditorCommand(currentEditor => currentEditor.chain().focus().setFontFamily(toCssFontFamily(f)).run())
  }

  const toggleCurrentFontPin = () => {
    setPinnedFonts(togglePinnedFont(toolbarState.font))
  }

  const applyFontSize = (size) => {
    setToolbarState(current => ({ ...current, fontSize: size }))
    runEditorCommand(currentEditor => currentEditor.chain().focus().setMark('textStyle', { fontSize: size }).run())
  }

  // Alignment applies to the selected conversation tile or image node when one
  // is selected; otherwise it sets text alignment on the current block.
  const applyAlignment = (align) => {
    setToolbarState(current => ({ ...current, alignment: align }))
    runEditorCommand(currentEditor => {
      if (currentEditor.state.selection.node?.type?.name === 'conversationTile') {
        currentEditor.chain().focus().updateAttributes('conversationTile', { align }).run()
        return
      }

      if (currentEditor.state.selection.node?.type?.name === 'image') {
        const layout = currentEditor.state.selection.node.attrs.layout || 'inline'
        currentEditor
          .chain()
          .focus()
          .updateAttributes('image', {
            align,
            layout: layout.startsWith('wrap-') ? 'block' : layout,
          })
          .run()
        return
      }

      try {
        currentEditor.chain().focus().setTextAlign(align).run()
      } catch {
        currentEditor.chain().focus().updateAttributes('paragraph', { textAlign: align }).run()
      }
    })
  }

  const selectAlignment = (align) => {
    applyAlignment(align)
    closeAlignMenu()
  }

  const insertTable = () => {
    runEditorCommand(currentEditor => {
      currentEditor
        .chain()
        .focus()
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run()
    })
  }

  const insertConversationTile = () => {
    runEditorCommand(currentEditor => {
      currentEditor
        .chain()
        .focus()
        .insertConversationTile()
        .run()
    })
  }

  const activeAlignment = ALIGNMENTS.find(option => option.value === toolbarState.alignment) || ALIGNMENTS[0]

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
            onClick={() => runEditorCommand(currentEditor => currentEditor.chain().focus().toggleBold().run())}
            aria-label="Bold"
            aria-pressed={toolbarState.activeMarks.bold}
            title="Bold"
          >
            <SFIcon name="bold" filled={toolbarState.activeMarks.bold} />
          </button>
          <button
            type="button"
            className={toolbarState.activeMarks.italic ? 'active' : ''}
            onClick={() => runEditorCommand(currentEditor => currentEditor.chain().focus().toggleItalic().run())}
            aria-label="Italic"
            aria-pressed={toolbarState.activeMarks.italic}
            title="Italic"
          >
            <SFIcon name="italic" filled={toolbarState.activeMarks.italic} />
          </button>
          <button
            type="button"
            className={toolbarState.activeMarks.underline ? 'active' : ''}
            onClick={() => runEditorCommand(currentEditor => currentEditor.chain().focus().toggleUnderline().run())}
            aria-label="Underline"
            aria-pressed={toolbarState.activeMarks.underline}
            title="Underline"
          >
            <SFIcon name="underline" filled={toolbarState.activeMarks.underline} />
          </button>
          <button
            type="button"
            className={toolbarState.activeMarks.strike ? 'active' : ''}
            onClick={() => runEditorCommand(currentEditor => currentEditor.chain().focus().toggleStrike().run())}
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
            <span className="toolbar-color-bar" style={{ background: toolbarState.highlight }} aria-hidden="true" />
            <input
              type="color"
              value={toolbarState.highlight}
              onFocus={() => setUserSelectingHighlight(true)}
              onBlur={() => setUserSelectingHighlight(false)}
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

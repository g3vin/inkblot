import React, { useState, useEffect } from 'react'
import './Toolbar.css'
import { openPinterest } from './openPinterest'
import SFIcon from './SFIcon'

export default function Toolbar({ editor }) {
  const [color, setColor] = useState('#000000')
  const [highlight, setHighlight] = useState('#ffff00')
  const [userSelectingHighlight, setUserSelectingHighlight] = useState(false)

  const [font, setFont] = useState('Georgia')
  const [fontSize, setFontSize] = useState('18px')
  const [alignment, setAlignment] = useState('left')
  const [activeMarks, setActiveMarks] = useState({
    bold: false,
    italic: false,
    underline: false,
    strike: false,
  })

  if (!editor) return null

  /* ---------------- Update Toolbar When Cursor Moves ---------------- */
  useEffect(() => {
    const updateToolbar = () => {
      const attrs = editor.getAttributes('textStyle') || {}
      const colorAttr = attrs.color || '#000000'
      const fontAttr = attrs.fontFamily || 'Georgia'
      const fontSizeAttr = attrs.fontSize || '18px'
      const alignAttr = editor.getAttributes('paragraph').textAlign || 'left'
      const highlightAttr = editor.getAttributes('highlight').color || highlight

      setColor(colorAttr)
      setFont(fontAttr)
      setFontSize(fontSizeAttr)
      setAlignment(alignAttr)

      const { state } = editor
      const { from, to, empty, $from } = state.selection
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

      setActiveMarks({
        bold: getMarkActive('bold'),
        italic: getMarkActive('italic'),
        underline: getMarkActive('underline'),
        strike: getMarkActive('strike'),
      })

      // ✅ only update highlight color if the user isn’t currently picking one
      if (!userSelectingHighlight) {
        setHighlight(highlightAttr)
      }
    }

    editor.on('selectionUpdate', updateToolbar)
    editor.on('transaction', updateToolbar)
    updateToolbar()

    return () => {
      editor.off('selectionUpdate', updateToolbar)
      editor.off('transaction', updateToolbar)
    }
  }, [editor, userSelectingHighlight, highlight])

  /* ---------------- Apply Formatting Actions ---------------- */
  const applyColor = (c) => {
    setColor(c)
    editor.chain().focus().setColor(c).run()
  }

  const applyHighlight = (c) => {
    setHighlight(c)
    // ✅ persist this color globally for context-menu use
    if (editor.storage) editor.storage.lastHighlightColor = c
    editor.chain().focus().setHighlight({ color: c }).run()
  }

  const applyFont = (f) => {
    setFont(f)
    editor.chain().focus().setFontFamily(f).run()
  }

  const applyFontSize = (size) => {
    setFontSize(size)
    editor.chain().focus().setMark('textStyle', { fontSize: size }).run()
  }

  const applyAlignment = (align) => {
    setAlignment(align)
    try {
      editor.chain().focus().setTextAlign(align).run()
    } catch {
      editor.chain().focus().updateAttributes('paragraph', { textAlign: align }).run()
    }
  }

  /* ---------------- Render Toolbar ---------------- */
  return (
    <div className="toolbar-wrapper">
      <div className="toolbar">
        {/* Text Style Buttons */}
        <button
          className={activeMarks.bold ? 'active' : ''}
          onClick={() => editor.chain().focus().toggleBold().run()}
          aria-label="Bold"
          title="Bold"
        >
          <SFIcon name="bold" filled={activeMarks.bold} />
        </button>
        <button
          className={activeMarks.italic ? 'active' : ''}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          aria-label="Italic"
          title="Italic"
        >
          <SFIcon name="italic" filled={activeMarks.italic} />
        </button>
        <button
          className={activeMarks.underline ? 'active' : ''}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          aria-label="Underline"
          title="Underline"
        >
          <SFIcon name="underline" filled={activeMarks.underline} />
        </button>
        <button
          className={activeMarks.strike ? 'active' : ''}
          onClick={() => editor.chain().focus().toggleStrike().run()}
          aria-label="Strikethrough"
          title="Strikethrough"
        >
          <SFIcon name="strikethrough" filled={activeMarks.strike} />
        </button>

        {/* Text Color */}
        <input
          type="color"
          value={color}
          onChange={(e) => applyColor(e.target.value)}
          title="Text Color"
        />

        {/* ✅ Highlight Color */}
        <input
          type="color"
          value={highlight}
          onFocus={() => setUserSelectingHighlight(true)}
          onBlur={() => setUserSelectingHighlight(false)}
          onChange={(e) => applyHighlight(e.target.value)} // ✅ only call applyHighlight
          title="Highlight Color"
        />

        {/* Font Family */}
        <select value={font} onChange={(e) => applyFont(e.target.value)}>
          <option value="Georgia">Georgia</option>
          <option value="Arial">Arial</option>
          <option value="Times New Roman">Times New Roman</option>
          <option value="Courier New">Courier New</option>
          <option value="Verdana">Verdana</option>
        </select>

        {/* Font Size */}
        <select value={fontSize} onChange={(e) => applyFontSize(e.target.value)}>
          <option value="14px">14px</option>
          <option value="16px">16px</option>
          <option value="18px">18px</option>
          <option value="20px">20px</option>
          <option value="24px">24px</option>
          <option value="28px">28px</option>
        </select>

        <div className="separator" />

        {/* Alignment */}
        <button
          className={alignment === 'left' ? 'active' : ''}
          onClick={() => applyAlignment('left')}
          aria-label="Align left"
          title="Align left"
        >
          <SFIcon name="text.alignleft" />
        </button>
        <button
          className={alignment === 'center' ? 'active' : ''}
          onClick={() => applyAlignment('center')}
          aria-label="Align center"
          title="Align center"
        >
          <SFIcon name="text.aligncenter" />
        </button>
        <button
          className={alignment === 'right' ? 'active' : ''}
          onClick={() => applyAlignment('right')}
          aria-label="Align right"
          title="Align right"
        >
          <SFIcon name="text.alignright" />
        </button>
      </div>
    </div>
  )
}
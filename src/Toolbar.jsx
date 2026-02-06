import React, { useState, useEffect } from 'react'
import './Toolbar.css'
import { openPinterest } from './openPinterest'

export default function Toolbar({ editor }) {
  const [color, setColor] = useState('#000000')
  const [highlight, setHighlight] = useState('#ffff00')
  const [userSelectingHighlight, setUserSelectingHighlight] = useState(false)

  const [font, setFont] = useState('Georgia')
  const [fontSize, setFontSize] = useState('18px')
  const [alignment, setAlignment] = useState('left')

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
          className={editor.isActive('bold') ? 'active' : ''}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          B
        </button>
        <button
          className={editor.isActive('italic') ? 'active' : ''}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          I
        </button>
        <button
          className={editor.isActive('strike') ? 'active' : ''}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        >
          S
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
        >
          ⬅
        </button>
        <button
          className={alignment === 'center' ? 'active' : ''}
          onClick={() => applyAlignment('center')}
        >
          ⬍
        </button>
        <button
          className={alignment === 'right' ? 'active' : ''}
          onClick={() => applyAlignment('right')}
        >
          ➡
        </button>

        <div className="separator" />

        <button
          onClick={() => openPinterest('landscapes')}
          title="Open Pinterest"
        >
          P
        </button>
      </div>
    </div>
  )
}
import React, { useState } from 'react'
import './Toolbar.css'
import { openPinterest } from './openPinterest'

export default function Toolbar({ editor }) {
  const [color, setColor] = useState('#000000')
  const [font, setFont] = useState('Georgia')
  const [fontSize, setFontSize] = useState('18px')

  if (!editor) return null

  const applyColor = (c) => {
    setColor(c)
    editor.chain().focus().setColor(c).run()
  }

  const applyFont = (f) => {
    setFont(f)
    editor.chain().focus().setFontFamily(f).run()
  }

  const applyFontSize = (size) => {
    setFontSize(size)
    editor.chain().focus().setMark('textStyle', { fontSize: size }).run()
  }

  return (
    <div className="toolbar-wrapper">
      <div className="toolbar">
        <button onClick={() => editor.chain().focus().toggleBold().run()}>B</button>
        <button onClick={() => editor.chain().focus().toggleItalic().run()}>I</button>
        <button onClick={() => editor.chain().focus().toggleStrike().run()}>S</button>

        <input
          type="color"
          value={color}
          onChange={(e) => applyColor(e.target.value)}
          title="Text Color"
        />

        <select value={font} onChange={(e) => applyFont(e.target.value)}>
          <option value="Georgia">Georgia</option>
          <option value="Arial">Arial</option>
          <option value="Times New Roman">Times New Roman</option>
          <option value="Courier New">Courier New</option>
          <option value="Verdana">Verdana</option>
        </select>

        <select value={fontSize} onChange={(e) => applyFontSize(e.target.value)}>
          <option value="14px">14px</option>
          <option value="16px">16px</option>
          <option value="18px">18px</option>
          <option value="20px">20px</option>
          <option value="24px">24px</option>
          <option value="28px">28px</option>
        </select>

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

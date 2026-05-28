import { useState, useEffect } from 'react'
import './Toolbar.css'
import SFIcon from './SFIcon'
import DictationControl from './DictationControl'
import ReadAloudControl from './ReadAloudControl'

const isEditorReady = (editor) => Boolean(
  editor &&
  !editor.isDestroyed &&
  editor.state?.schema?.nodes &&
  editor.view &&
  !editor.view.isDestroyed &&
  editor.commands &&
  typeof editor.chain === 'function'
)

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
    table: false,
  })

  useEffect(() => {
    if (!isEditorReady(editor)) return undefined

    const updateToolbar = () => {
      if (!isEditorReady(editor)) return

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
        table: editor.isActive('table'),
      })

      if (!userSelectingHighlight) {
        setHighlight(highlightAttr)
      }
    }

    editor.on('selectionUpdate', updateToolbar)
    editor.on('transaction', updateToolbar)
    updateToolbar()

    return () => {
      if (!editor.isDestroyed) {
        editor.off('selectionUpdate', updateToolbar)
        editor.off('transaction', updateToolbar)
      }
    }
  }, [editor, userSelectingHighlight, highlight])

  if (!isEditorReady(editor)) return null

  const runEditorCommand = (command) => {
    if (!isEditorReady(editor)) return
    command(editor)
  }

  const applyColor = (c) => {
    setColor(c)
    runEditorCommand(currentEditor => currentEditor.chain().focus().setColor(c).run())
  }

  const applyHighlight = (c) => {
    setHighlight(c)
    if (editor.storage) Reflect.set(editor.storage, 'lastHighlightColor', c)
    runEditorCommand(currentEditor => currentEditor.chain().focus().setHighlight({ color: c }).run())
  }

  const applyFont = (f) => {
    setFont(f)
    runEditorCommand(currentEditor => currentEditor.chain().focus().setFontFamily(f).run())
  }

  const applyFontSize = (size) => {
    setFontSize(size)
    runEditorCommand(currentEditor => currentEditor.chain().focus().setMark('textStyle', { fontSize: size }).run())
  }

  const applyAlignment = (align) => {
    setAlignment(align)
    runEditorCommand(currentEditor => {
      try {
        currentEditor.chain().focus().setTextAlign(align).run()
      } catch {
        currentEditor.chain().focus().updateAttributes('paragraph', { textAlign: align }).run()
      }
    })
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

  return (
    <div className="toolbar-wrapper">
      <div className="toolbar">
        <button
          className={activeMarks.bold ? 'active' : ''}
          onClick={() => runEditorCommand(currentEditor => currentEditor.chain().focus().toggleBold().run())}
          aria-label="Bold"
          title="Bold"
        >
          <SFIcon name="bold" filled={activeMarks.bold} />
        </button>
        <button
          className={activeMarks.italic ? 'active' : ''}
          onClick={() => runEditorCommand(currentEditor => currentEditor.chain().focus().toggleItalic().run())}
          aria-label="Italic"
          title="Italic"
        >
          <SFIcon name="italic" filled={activeMarks.italic} />
        </button>
        <button
          className={activeMarks.underline ? 'active' : ''}
          onClick={() => runEditorCommand(currentEditor => currentEditor.chain().focus().toggleUnderline().run())}
          aria-label="Underline"
          title="Underline"
        >
          <SFIcon name="underline" filled={activeMarks.underline} />
        </button>
        <button
          className={activeMarks.strike ? 'active' : ''}
          onClick={() => runEditorCommand(currentEditor => currentEditor.chain().focus().toggleStrike().run())}
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

        <input
          type="color"
          value={highlight}
          onFocus={() => setUserSelectingHighlight(true)}
          onBlur={() => setUserSelectingHighlight(false)}
          onChange={(e) => applyHighlight(e.target.value)}
          title="Highlight Color"
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
          <option value="32px">32px</option>
          <option value="36px">36px</option>
        </select>

        <div className="separator" />

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

        <div className="separator" />

        <button
          className={activeMarks.table ? 'active' : ''}
          onClick={insertTable}
          aria-label="Insert table"
          title="Insert table"
        >
          <SFIcon name="table.grid" />
        </button>

        <div className="separator" />

        <DictationControl editor={editor} />
        <ReadAloudControl editor={editor} />
      </div>
    </div>
  )
}

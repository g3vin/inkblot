import { useEffect, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { StarterKit } from '@tiptap/starter-kit'
import { Color } from '@tiptap/extension-color'
import { FontFamily } from '@tiptap/extension-font-family'
import { TextAlign } from '@tiptap/extension-text-align'
import { Highlight } from '@tiptap/extension-highlight'
import { debounce } from 'lodash'

import Toolbar from './Toolbar'
import { CustomTextStyle } from './extensions/CustomTextStyle'
import { NoteAnnotation } from './extensions/NoteAnnotation'
import TabIndent from './extensions/TabIndent'
import { saveDocument, loadDocument } from './FileSystem'

export default function EditorCanvas({
  setEditor,
  projectName,
  currentDoc,
  splitView,
  setSplitView,
  secondaryDoc,
  notes,
  setNotes,
}) {

  const [, forceNoteRender] = useState(0)

  /* ---------------- Primary Editor ---------------- */

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        bulletList: { keepMarks: true },
        orderedList: { keepMarks: true },
      }),
      CustomTextStyle,
      Color,
      FontFamily,
      NoteAnnotation,
      TabIndent,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      Highlight.configure({
        multicolor: true,
      }),
    ],
    content: '',
  })

  /* ---------------- Secondary Editor ---------------- */

  const secondaryEditor = useEditor({
    extensions: [
      StarterKit,
      CustomTextStyle,
      Color,
      FontFamily,
      TabIndent,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      Highlight.configure({ multicolor: true }),
    ],
    content: '',
  })

  /* ---------------- Expose Editor ---------------- */

  useEffect(() => {
    if (editor) setEditor(editor)
  }, [editor, setEditor])

  /* ---------------- Load Primary Doc ---------------- */

  useEffect(() => {
    if (!editor || !currentDoc) return

    const load = async () => {
      const doc = await loadDocument(projectName, currentDoc)

      if (!doc) {
        editor.commands.setContent('<p></p>')
        setNotes([])
        return
      }

      editor.commands.setContent(doc.content || '<p></p>')
      setNotes(doc.notes || [])
    }

    load()
  }, [editor, currentDoc, projectName, setNotes])

  /* ---------------- Load Secondary Doc ---------------- */

  useEffect(() => {
    if (!secondaryEditor || splitView !== 'editor' || !secondaryDoc) return

    const load = async () => {
      const doc = await loadDocument(projectName, secondaryDoc)

      if (!doc) {
        secondaryEditor.commands.setContent('<p></p>')
        return
      }

      secondaryEditor.commands.setContent(doc.content || '<p></p>')
    }

    load()
  }, [secondaryEditor, secondaryDoc, splitView, projectName])

  /* ---------------- Sync Notes → Editor Storage ---------------- */

  useEffect(() => {
    if (!editor) return
    editor.storage.noteAnnotation.notes = notes || []
    forceNoteRender(v => v + 1)
  }, [editor, notes])

  /* ---------------- Autosave ---------------- */

  useEffect(() => {
    if (!editor || !currentDoc) return

    const handler = debounce(async () => {
      await saveDocument(projectName, currentDoc, {
        content: editor.getJSON(),
        notes: notes || [],
      })
    }, 800)

    editor.on('update', handler)

    return () => {
      editor.off('update', handler)
      handler.cancel()
    }
  }, [editor, currentDoc, projectName, notes])

  /* ---------------- Autosave Notes ---------------- */

  useEffect(() => {
    if (!editor || !currentDoc) return

    const handler = debounce(async () => {
      await saveDocument(projectName, currentDoc, {
        content: editor.getJSON(),
        notes: notes || [],
      })
    }, 800)

    handler()

    return () => {
      handler.cancel()
    }
  }, [editor, currentDoc, projectName, notes])

  /* ---------------- Anchor Remapping ---------------- */

  useEffect(() => {
    if (!editor) return

    const handler = ({ transaction }) => {
      if (!transaction.docChanged) return

      const mapping = transaction.mapping

      const updated = (notes || [])
        .map(note => {
          if (note.type !== 'quote') return note

          const newFrom = mapping.map(note.from)
          const newTo = mapping.map(note.to)

          if (newFrom >= newTo) return null

          return {
            ...note,
            from: newFrom,
            to: newTo,
            anchor: editor.state.doc.textBetween(newFrom, newTo),
          }
        })
        .filter(Boolean)

      setNotes(updated)
    }

    editor.on('transaction', handler)
    return () => editor.off('transaction', handler)

  }, [editor, notes, setNotes])

  /* ---------------- Render ---------------- */

  return (
    <div className="middle-section">
      {editor && (
        <Toolbar
          editor={editor}
          splitView={splitView}
          setSplitView={setSplitView}
        />
      )}

      <div className={`editor-container ${splitView ? 'split-active' : ''}`}>

        <div className="pane primary-pane">
          <div className="pane-header">
            Editing: {currentDoc}
          </div>
          <EditorContent editor={editor} className="editor" />
        </div>

        {splitView === 'editor' && (
          <div className="pane secondary-pane">
            <div className="pane-header split-header">
              <span>Reference: {secondaryDoc}</span>
              <button onClick={() => setSplitView(null)}>×</button>
            </div>
            <EditorContent editor={secondaryEditor} className="editor" />
          </div>
        )}
      </div>
    </div>
  )
}
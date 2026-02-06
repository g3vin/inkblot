import { useEffect, useCallback, useRef } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { StarterKit } from '@tiptap/starter-kit'
import { Color } from '@tiptap/extension-color'
import { FontFamily } from '@tiptap/extension-font-family'
import Toolbar from './Toolbar'
import { CustomTextStyle } from './extensions/CustomTextStyle'
import { NoteAnnotation } from './extensions/NoteAnnotation'
import TabIndent from './extensions/TabIndent'
import { debounce } from 'lodash'
import { TextAlign } from '@tiptap/extension-text-align'
import {Highlight} from '@tiptap/extension-highlight'

// dynamic import of Tauri window API (avoids bundler/export issues)

export default function EditorCanvas({
  setEditor,
  notes,
  debouncedSave,
  loadDocument,
  projectName,
  currentDoc,
  versions,
  setVersions,
  splitView,       // 'editor' | null
  setSplitView,
  secondaryDoc,
  refreshFiles,   // ✅ add this
  onSelectDoc,
}) {
  /* ---------- Editors ---------- */

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

  const secondaryEditor = useEditor({
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

  const lastSavedText = useRef('')

  /* ---------- Close Pinterest when app closes ---------- */

  useEffect(() => {
    let cleanup = null
    ;(async () => {
      try {
          const mod = await import('@tauri-apps/api/window')
          const getWindow = mod.getWindow
          const getCurrent = mod.getCurrent

          if (typeof getCurrent === 'function') {
            const unlisten = getCurrent().onCloseRequested(async () => {
              const pinterest = typeof getWindow === 'function' ? getWindow('pinterest') : null
              await pinterest?.close()
            })
            cleanup = () => Promise.resolve(unlisten).then(f => f && f())
          } else if (typeof getWindow === 'function') {
            // Fallback: use browser unload to attempt closing pinterest webview
            const handler = async () => {
              const pinterest = getWindow('pinterest')
              await pinterest?.close()
            }
            window.addEventListener('beforeunload', handler)
            cleanup = () => window.removeEventListener('beforeunload', handler)
          }
        } catch (err) {
          // ignore if Tauri window API is not available in this environment
          console.warn('Tauri window API not available:', err)
        }
    })()

    return () => {
      if (cleanup) cleanup()
    }
  }, [])

  /* ---------- Editor Wiring ---------- */

  useEffect(() => {
    if (editor) setEditor(editor)
  }, [editor, setEditor])

  useEffect(() => {
    if (!editor) return
    loadDocument(projectName, currentDoc).then(doc =>
      editor.commands.setContent(doc || '<p></p>')
    )
  }, [editor, currentDoc, projectName, loadDocument])

  useEffect(() => {
    if (!secondaryEditor || splitView !== 'editor') return
    loadDocument(projectName, secondaryDoc).then(doc =>
      secondaryEditor.commands.setContent(doc || '<p></p>')
    )
  }, [secondaryEditor, secondaryDoc, splitView, loadDocument])

  useEffect(() => {
    if (!editor) return
    editor.storage.noteAnnotation.notes = notes
    editor.view.dispatch(editor.state.tr)
  }, [notes, editor])

  /* ---------- Autosave ---------- */

  const saveVersionDebounced = useCallback(
    debounce(() => {
      if (!editor) return
      const text = editor.getText()
      if (text === lastSavedText.current) return

      setVersions(prev => [
        { timestamp: new Date().toLocaleTimeString(), content: editor.getHTML() },
        ...prev.slice(0, 49),
      ])

      lastSavedText.current = text
    }, 10000),
    [editor, setVersions]
  )

  useEffect(() => {
    if (!editor) return
    const handler = () => {
      debouncedSave(editor.getJSON())
      saveVersionDebounced()
    }
    editor.on('update', handler)
    return () => editor.off('update', handler)
  }, [editor, debouncedSave, saveVersionDebounced])

  /* ---------- Render ---------- */

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

        {/* LEFT: Primary Editor */}
        <div className="pane primary-pane">
          <div className="pane-header">Editing: {currentDoc}</div>
          <EditorContent editor={editor} className="editor" />
        </div>

        {/* RIGHT: Secondary Editor (only split mode now) */}
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

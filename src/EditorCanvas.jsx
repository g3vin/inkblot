import { useEffect, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { StarterKit } from '@tiptap/starter-kit'
import { Color } from '@tiptap/extension-color'
import { FontFamily } from '@tiptap/extension-font-family'
import { TextAlign } from '@tiptap/extension-text-align'
import { Highlight } from '@tiptap/extension-highlight'
import { Underline } from '@tiptap/extension-underline'
import { Fragment } from '@tiptap/pm/model'
import ResizableImage from './extensions/ResizableImage'
import { debounce } from 'lodash'

import Toolbar from './Toolbar'
import { CustomTextStyle } from './extensions/CustomTextStyle'
import { NoteAnnotation } from './extensions/NoteAnnotation'
import PinterestBoard, { normalizePinterestBoardUrl } from './extensions/PinterestBoard'
import TabIndent from './extensions/TabIndent'
import { saveDocument, loadDocument, appendVersion, getVersions } from './FileSystem'
import SFIcon from './SFIcon'

export default function EditorCanvas({
  setEditor,
  setSecondaryEditor,
  setActiveEditor,
  projectName,
  currentDoc,
  setCurrentDoc,
  splitView,
  setSplitView,
  secondaryDoc,
  setSecondaryDoc,
  notesByDoc,
  setNotesForDoc,
  activeDoc,
  setActiveDoc,
  setVersions,
}) {
  const hasActiveDoc = Boolean(projectName && currentDoc)

  const [, forceNoteRender] = useState(0)

  const createPasteHandler = () => {
    return (view, event) => {
      const items = event.clipboardData?.items

      const imageItem = items
        ? Array.from(items).find(item => item.type.startsWith('image/'))
        : null

      if (imageItem) {
        const file = imageItem.getAsFile()
        if (!file) return false

        const reader = new FileReader()
        reader.onload = () => {
          const src = reader.result
          if (typeof src !== 'string') return

          const { schema, tr } = view.state
          const imageNode = schema.nodes.image?.create({ src })
          if (!imageNode) return
          view.dispatch(tr.replaceSelectionWith(imageNode))
        }
        reader.readAsDataURL(file)
        return true
      }

      // Pinterest board auto-embed when pasting a board URL.
      const pastedText = event.clipboardData?.getData('text/plain')
      const boardUrl = normalizePinterestBoardUrl(pastedText)
      if (boardUrl) {
        const { schema, tr, selection } = view.state
        const boardNode = schema.nodes.pinterestBoard?.create({ url: boardUrl })
        if (!boardNode) return false

        const paragraph = schema.nodes.paragraph?.create()
        const fragment = paragraph
          ? Fragment.fromArray([boardNode, paragraph])
          : Fragment.fromArray([boardNode])

        view.dispatch(
          tr
            .replaceRange(selection.from, selection.to, fragment)
            .scrollIntoView()
        )
        return true
      }

      // If a plain-paste was explicitly requested elsewhere (e.g. Cmd+Shift+V handler),
      // handle it here by inserting plain text only. Otherwise, let default paste proceed
      // so normal Cmd+V preserves formatting.
      if (window.__inkblot_forcePlainPaste) {
        try { event.preventDefault(); } catch (e) {}

        const plainTextFromClipboard = event.clipboardData?.getData('text/plain') || ''
        const { tr, selection } = view.state
        tr.insertText(plainTextFromClipboard, selection.from, selection.to)
        view.dispatch(tr.scrollIntoView())
        // reset the flag so subsequent pastes behave normally
        try { window.__inkblot_forcePlainPaste = false } catch (e) {}
        return true
      }

      // Not a forced plain paste — return false to allow TipTap's default paste handling
      return false
    }
  }
  const [primaryWordCount, setPrimaryWordCount] = useState(0)
  const [secondaryWordCount, setSecondaryWordCount] = useState(0)

  const countWords = (text = '') => {
    const trimmed = text.trim()
    if (!trimmed) return 0
    return trimmed.split(/\s+/).length
  }

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
      PinterestBoard,
      TabIndent,
      Underline,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      Highlight.configure({
        multicolor: true,
      }),
      ResizableImage.configure({
        inline: true,
        allowBase64: true,
      }),
    ],
    content: '',
    editorProps: {
      handlePaste: createPasteHandler(),
    },
  })

  /* ---------------- Secondary Editor ---------------- */

  const secondaryEditor = useEditor({
    extensions: [
      StarterKit,
      CustomTextStyle,
      Color,
      FontFamily,
      PinterestBoard,
      TabIndent,
      Underline,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      Highlight.configure({ multicolor: true }),
      ResizableImage.configure({
        inline: true,
        allowBase64: true,
      }),
    ],
    content: '',
    editorProps: {
      handlePaste: createPasteHandler(),
    },
  })

  /* ---------------- Expose Editor ---------------- */

  useEffect(() => {
    if (editor) setEditor(editor)
  }, [editor, setEditor])

  useEffect(() => {
    if (secondaryEditor) setSecondaryEditor?.(secondaryEditor)
  }, [secondaryEditor, setSecondaryEditor])

  /* ---------------- Load Primary Doc ---------------- */

  useEffect(() => {
    if (!editor || !currentDoc) return

    const load = async () => {
      const doc = await loadDocument(projectName, currentDoc)

      if (!doc) {
        editor.commands.setContent('<p></p>')
        setNotesForDoc(currentDoc, [])
        editor.commands.focus('start')
        return
      }

      editor.commands.setContent(doc.content || '<p></p>')
      setNotesForDoc(currentDoc, doc.notes || [])
      if (!doc.content || doc.content?.content?.length === 0) {
        editor.commands.focus('start')
      }

      // load versions for the right sidebar
      try {
        const vs = await getVersions(projectName, currentDoc)
        setVersions?.(currentDoc, vs)
      } catch (e) {
        console.error('Failed to load versions:', e)
        setVersions?.(currentDoc, [])
      }
    }

    load()
  }, [editor, currentDoc, projectName, setNotesForDoc])

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
      setNotesForDoc(secondaryDoc, doc.notes || [])
    }

    load()
  }, [secondaryEditor, secondaryDoc, splitView, projectName, setNotesForDoc])

  /* ---------------- Sync Notes → Editor Storage ---------------- */

  useEffect(() => {
    if (!editor) return
    editor.storage.noteAnnotation.notes = (notesByDoc?.[currentDoc] || [])
    forceNoteRender(v => v + 1)
  }, [editor, notesByDoc, currentDoc])

  /* ---------------- Autosave ---------------- */

  useEffect(() => {
    if (!editor || !currentDoc) return
    console.debug('[autosave] effect init', { projectName, currentDoc })
    const handler = debounce(async () => {
      try { console.debug('[autosave] handler fired', { projectName, currentDoc }) } catch (e) {}
      const contentJson = editor.getJSON()
      const contentHtml = editor.getHTML()

      console.debug('[autosave] saving', { projectName, currentDoc, contentLength: contentHtml?.length })

      await saveDocument(projectName, currentDoc, {
        content: contentJson,
        notes: notesByDoc?.[currentDoc] || [],
        _appendVersion: true,
        _version: {
          contentHtml,
          contentJson,
        },
      })

      try {
        console.debug('[autosave] calling appendVersion', { projectName, currentDoc })
        await appendVersion(projectName, currentDoc, { contentHtml, contentJson })
        console.debug('[autosave] appendVersion done', { projectName, currentDoc })
      } catch (e) {
        console.error('[autosave] appendVersion failed', e)
      }

      try {
        console.debug('[autosave] about to getVersions', { projectName, currentDoc })
        const vs = await getVersions(projectName, currentDoc)
        console.debug('[autosave] getVersions returned', { projectName, currentDoc, count: Array.isArray(vs) ? vs.length : 0 })
        setVersions?.(currentDoc, vs)
        console.debug('[autosave] setVersions called', { projectName, currentDoc })
      } catch (e) {
        console.error('Failed to refresh versions:', e)
      }
    }, 800)

    editor.on('update', handler)
    console.debug('[autosave] handler attached', { projectName, currentDoc })

    return () => {
      editor.off('update', handler)
      console.debug('[autosave] handler detached', { projectName, currentDoc })
      handler.cancel()
    }
  }, [editor, currentDoc, projectName, notesByDoc])

  /* ---------------- Word Count ---------------- */

  useEffect(() => {
    if (!editor) return

    const update = () => {
      setPrimaryWordCount(countWords(editor.getText()))
    }

    editor.on('update', update)
    update()

    return () => editor.off('update', update)
  }, [editor])

  useEffect(() => {
    if (!secondaryEditor || splitView !== 'editor' || !secondaryDoc) return

    const handler = debounce(async () => {
      await saveDocument(projectName, secondaryDoc, {
        content: secondaryEditor.getJSON(),
        notes: notesByDoc?.[secondaryDoc] || [],
      })
    }, 800)

    secondaryEditor.on('update', handler)

    return () => {
      secondaryEditor.off('update', handler)
      handler.cancel()
    }
  }, [secondaryEditor, secondaryDoc, splitView, projectName, notesByDoc])

  useEffect(() => {
    if (!secondaryEditor || splitView !== 'editor') return

    const update = () => {
      setSecondaryWordCount(countWords(secondaryEditor.getText()))
    }

    secondaryEditor.on('update', update)
    update()

    return () => secondaryEditor.off('update', update)
  }, [secondaryEditor, splitView])

  /* ---------------- Autosave Notes ---------------- */

  useEffect(() => {
    if (!activeDoc) return

    const getEditorForDoc = (docName) => {
      if (docName === currentDoc) return editor
      if (docName === secondaryDoc) return secondaryEditor
      return null
    }

    const targetEditor = getEditorForDoc(activeDoc)
    if (!targetEditor) return

    const handler = debounce(async () => {
      const contentJson = targetEditor.getJSON()
      const contentHtml = targetEditor.getHTML && targetEditor.getHTML()
      await saveDocument(projectName, activeDoc, {
        content: contentJson,
        notes: notesByDoc?.[activeDoc] || [],
        _appendVersion: true,
        _version: { contentHtml, contentJson },
      })
    }, 800)

    // run once to persist notes immediately, include version snapshot to avoid overwriting versions
    try { handler() } catch (e) {}

    return () => {
      handler.cancel()
    }
  }, [editor, secondaryEditor, activeDoc, currentDoc, secondaryDoc, projectName, notesByDoc])

  /* ---------------- Anchor Remapping ---------------- */

  useEffect(() => {
    if (!editor) return

    const handler = ({ transaction }) => {
      if (!transaction.docChanged) return

      const mapping = transaction.mapping

      const updated = (notesByDoc?.[currentDoc] || [])
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

      setNotesForDoc(currentDoc, updated)
    }

    editor.on('transaction', handler)
    return () => editor.off('transaction', handler)

  }, [editor, notesByDoc, currentDoc, setNotesForDoc])

  /* ---------------- Render ---------------- */

  const closeSecondary = () => {
    setSecondaryDoc?.(null)
    setSplitView?.(null)
  }

  const closePrimary = () => {
    if (secondaryDoc) {
      setCurrentDoc?.(secondaryDoc)
    }
    closeSecondary()
  }

  const focusEditor = (target) => {
    if (!target) return
    if (target.isEmpty) {
      target.commands.focus('start')
      return
    }
    target.chain().focus().run()
  }

  if (!hasActiveDoc) {
    return (
      <div className="middle-section">
        <div className="empty-state">
          <div className="empty-state-content">
            {projectName ? 'Create a new document to begin.' : 'Select a project to begin.'}
            {projectName && (
              <button
                className="empty-state-action"
                onClick={() => {
                  window.dispatchEvent(
                    new CustomEvent('filetree:new-entry', {
                      detail: { type: 'file', parent: '' },
                    })
                  )
                }}
                aria-label="Create new document"
                title="Create new document"
              >
                <SFIcon name="plus" />
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

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

        <div
          className="pane primary-pane"
          onFocus={() => setActiveDoc(currentDoc)}
          onMouseEnter={() => setActiveDoc(currentDoc)}
          onWheel={() => setActiveDoc(currentDoc)}
          onMouseDown={() => focusEditor(editor)}
          onClick={() => focusEditor(editor)}
          onMouseMove={() => setActiveEditor?.(editor)}
        >
          <div className="pane-scroll">
            {splitView === 'editor' && (
              <div className="pane-header pane-header-centered">
                <span>{currentDoc}</span>
                <button onClick={closePrimary}>×</button>
              </div>
            )}
            <EditorContent editor={editor} className="editor" />
          </div>
          <div className="word-count">{primaryWordCount} words</div>
        </div>

        {splitView === 'editor' && (
          <div
            className="pane secondary-pane"
            onFocus={() => setActiveDoc(secondaryDoc)}
            onMouseEnter={() => setActiveDoc(secondaryDoc)}
            onWheel={() => setActiveDoc(secondaryDoc)}
            onMouseDown={() => focusEditor(secondaryEditor)}
            onClick={() => focusEditor(secondaryEditor)}
            onMouseMove={() => setActiveEditor?.(secondaryEditor)}
          >
            <div className="pane-scroll">
              <div className="pane-header split-header pane-header-centered">
                <span>{secondaryDoc}</span>
                <button onClick={closeSecondary}>×</button>
              </div>
              <EditorContent editor={secondaryEditor} className="editor" />
            </div>
            <div className="word-count">{secondaryWordCount} words</div>
          </div>
        )}
      </div>
    </div>
  )
}
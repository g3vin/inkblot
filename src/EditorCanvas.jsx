import { useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { StarterKit } from '@tiptap/starter-kit'
import { Color } from '@tiptap/extension-color'
import { Dropcursor } from '@tiptap/extension-dropcursor'
import { FontFamily } from '@tiptap/extension-font-family'
import { TextAlign } from '@tiptap/extension-text-align'
import { Highlight } from '@tiptap/extension-highlight'
import { Underline } from '@tiptap/extension-underline'
import { Fragment } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
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
  onMoveClipboardEntryToEditor,
}) {
  const hasActiveDoc = Boolean(projectName && currentDoc)
  const primaryPaneRef = useRef(null)
  const secondaryPaneRef = useRef(null)
  const [dragCaret, setDragCaret] = useState(null)

  const [, forceNoteRender] = useState(0)

  const getMountedEditorView = (instance) => {
    if (!instance || instance.isDestroyed) return null
    const view = instance.editorView
    if (!view || view.isDestroyed) return null
    return view
  }

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

  const getDraggedClipboardPayload = (event) => {
    const transfer = event?.dataTransfer
    const globalDragged = window.__inkblot_draggedClipboardEntry
    const globalDraggedEditorSelection = window.__inkblot_draggedEditorSelection
    const raw = transfer?.getData('application/x-inkblot-clipboard-entry')
    const plainText = transfer?.getData('text/plain') || ''
    if (!raw && !globalDragged?.text && !plainText) return null
    if (!raw && !globalDragged?.text && globalDraggedEditorSelection) return null

    let parsed = null
    if (raw) {
      try { parsed = JSON.parse(raw) } catch (e) {}
    }

    const text = parsed?.text || globalDragged?.text || plainText
    const id = parsed?.id || globalDragged?.id || ''
    if (!String(text).trim()) return null
    return { id, text: String(text) }
  }

  const emitDnDDebug = (phase, status = {}, info = '', transient = false) => {
    try {
      window.dispatchEvent(new CustomEvent('inkblot:dnd-debug', {
        detail: { phase, status, info, transient },
      }))
    } catch (e) {}
  }

  const clearDragGlobals = () => {
    try { window.__inkblot_draggedClipboardEntry = null } catch (e) {}
    try { window.__inkblot_draggedEditorSelection = null } catch (e) {}
    try { window.__inkblot_dragPoint = null } catch (e) {}
    try { window.__inkblot_dropHandled = false } catch (e) {}
    emitDnDDebug('drag-globals-cleared', {
      source: 'none',
      over: 'none',
      dropHandled: false,
      editorSelection: false,
      clipboardPayload: false,
    }, '', true)
  }

  const isPointInRect = (x, y, rect) => {
    if (!rect) return false
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
  }

  const getTargetEditorAtPoint = (x, y) => {
    if (x == null || y == null) return null

    const primaryRect = primaryPaneRef.current?.getBoundingClientRect?.()
    if (editor && isPointInRect(x, y, primaryRect)) return editor

    const secondaryRect = secondaryPaneRef.current?.getBoundingClientRect?.()
    if (splitView === 'editor' && secondaryEditor && isPointInRect(x, y, secondaryRect)) {
      return secondaryEditor
    }

    return null
  }

  const updateDropCaret = (targetEditor, event) => {
    const view = getMountedEditorView(targetEditor)
    if (!view) return
    const coords = view.posAtCoords({ left: event.clientX, top: event.clientY })
    if (!coords?.pos) return

    const nextSelection = TextSelection.create(view.state.doc, coords.pos)
    const samePos =
      view.state.selection.from === nextSelection.from &&
      view.state.selection.to === nextSelection.to

    if (!samePos) {
      view.dispatch(view.state.tr.setSelection(nextSelection))
    }

    const caretCoords = view.coordsAtPos(coords.pos)
    const paneEl =
      targetEditor === secondaryEditor ? secondaryPaneRef.current : primaryPaneRef.current
    const paneRect = paneEl?.getBoundingClientRect?.()
    if (!paneRect || !caretCoords) return

    setDragCaret({
      pane: targetEditor === secondaryEditor ? 'secondary' : 'primary',
      left: Math.max(0, caretCoords.left - paneRect.left),
      top: Math.max(0, caretCoords.top - paneRect.top),
      height: Math.max(18, caretCoords.bottom - caretCoords.top),
    })
  }

  const handlePaneDragStart = (event, targetEditor, source, docName) => {
    const { selection, doc } = targetEditor?.state || {}
    if (!selection || selection.empty) return

    const text = doc.textBetween(selection.from, selection.to, '\n')
    if (!text.trim()) return

    const payload = {
      from: selection.from,
      to: selection.to,
      text,
      source,
      docName: docName || '',
    }

    try { window.__inkblot_draggedEditorSelection = payload } catch (e) {}
    try { window.__inkblot_dropHandled = false } catch (e) {}
    emitDnDDebug('editor-dragstart', {
      source: 'editor',
      over: 'none',
      dropHandled: false,
      editorSelection: true,
      clipboardPayload: false,
    }, `${source}:${docName || ''} len=${text.length}`)
    try {
      event.dataTransfer?.setData('application/x-inkblot-editor-selection', JSON.stringify(payload))
      if (!event.dataTransfer?.getData('text/plain')) {
        event.dataTransfer?.setData('text/plain', text)
      }
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move'
      }
    } catch (e) {}
  }

  const handlePaneDragOver = (event, targetEditor) => {
    const payload = getDraggedClipboardPayload(event)
    if (!payload) return
    event.preventDefault()
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move'
    }
    updateDropCaret(targetEditor, event)
    emitDnDDebug('editor-dragover', {
      over: 'editor',
      clipboardPayload: true,
    }, '', true)
  }

  const handlePaneDrop = (event, targetEditor) => {
    const payload = getDraggedClipboardPayload(event)
    const view = getMountedEditorView(targetEditor)
    if (!payload || !view) return

    event.preventDefault()
    event.stopPropagation()

    const coords = view.posAtCoords({ left: event.clientX, top: event.clientY })
    const insertPos = coords?.pos ?? view.state.selection.from
    const tr = view.state.tr.insertText(payload.text, insertPos, insertPos)
    view.dispatch(tr.scrollIntoView())
    view.focus()

    onMoveClipboardEntryToEditor?.(payload.id)
    try { window.__inkblot_dropHandled = true } catch (e) {}
    setDragCaret(null)
    emitDnDDebug('editor-drop', {
      source: 'clipboard',
      over: 'editor',
      dropHandled: true,
      clipboardPayload: true,
    }, `id=${payload.id || 'none'} len=${payload.text.length}`)
  }

  const insertClipboardPayloadAtPoint = (payload, targetEditor, x, y) => {
    const view = getMountedEditorView(targetEditor)
    if (!payload || !view) return false
    const coords = view.posAtCoords({ left: x, top: y })
    const insertPos = coords?.pos ?? view.state.selection.from
    const tr = view.state.tr.insertText(payload.text, insertPos, insertPos)
    view.dispatch(tr.scrollIntoView())
    view.focus()
    onMoveClipboardEntryToEditor?.(payload.id)
    try { window.__inkblot_dropHandled = true } catch (e) {}
    setDragCaret(null)
    emitDnDDebug('editor-fallback-insert-on-dragend', {
      source: 'clipboard',
      over: 'editor',
      dropHandled: true,
      clipboardPayload: true,
    }, `id=${payload.id || 'none'} len=${payload.text.length}`)
    return true
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
      Dropcursor.configure({
        color: 'rgba(84, 165, 255, 0.95)',
        width: 2,
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
      Dropcursor.configure({
        color: 'rgba(84, 165, 255, 0.95)',
        width: 2,
      }),
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

  useEffect(() => {
    const attachDragMeta = (instance, source, docName) => {
      const dom = getMountedEditorView(instance)?.dom
      if (!dom || !instance?.state) return () => {}

      const onDragStart = (event) => {
        const { selection, doc } = instance.state
        if (!selection || selection.empty) return

        const text = doc.textBetween(selection.from, selection.to, '\n')
        if (!text.trim()) return

        const payload = {
          from: selection.from,
          to: selection.to,
          text,
          source,
          docName: docName || '',
        }

        try { window.__inkblot_draggedEditorSelection = payload } catch (e) {}
        emitDnDDebug('editor-dom-dragstart', {
          source: 'editor',
          editorSelection: true,
          dropHandled: false,
        }, `${source}:${docName || ''} len=${text.length}`)
        try {
          event.dataTransfer?.setData('application/x-inkblot-editor-selection', JSON.stringify(payload))
          event.dataTransfer?.setData('text/plain', text)
          if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move'
          }
        } catch (e) {}
      }

      const onDragEnd = () => {
        emitDnDDebug('editor-dom-dragend', {
          source: 'editor',
          editorSelection: Boolean(window.__inkblot_draggedEditorSelection),
        })
      }

      dom.addEventListener('dragstart', onDragStart, true)
      dom.addEventListener('dragend', onDragEnd, true)
      return () => {
        dom.removeEventListener('dragstart', onDragStart, true)
        dom.removeEventListener('dragend', onDragEnd, true)
      }
    }

    const offPrimary = attachDragMeta(editor, 'primary', currentDoc)
    const offSecondary = attachDragMeta(secondaryEditor, 'secondary', secondaryDoc)
    return () => {
      offPrimary()
      offSecondary()
    }
  }, [editor, secondaryEditor, currentDoc, secondaryDoc])

  useEffect(() => {
    const pane = primaryPaneRef.current
    if (!pane || !editor) return

    const onDragStart = (event) => handlePaneDragStart(event, editor, 'primary', currentDoc)
    const onDragEnd = () => {
      emitDnDDebug('primary-pane-dragend', {
        source: 'editor',
        editorSelection: Boolean(window.__inkblot_draggedEditorSelection),
        clipboardPayload: Boolean(window.__inkblot_draggedClipboardEntry),
      }, '', true)
    }
    const onDragOver = (event) => handlePaneDragOver(event, editor)
    const onDrop = (event) => handlePaneDrop(event, editor)

    pane.addEventListener('dragstart', onDragStart, true)
    pane.addEventListener('dragend', onDragEnd, true)
    pane.addEventListener('dragover', onDragOver, true)
    pane.addEventListener('drop', onDrop, true)

    return () => {
      pane.removeEventListener('dragstart', onDragStart, true)
      pane.removeEventListener('dragend', onDragEnd, true)
      pane.removeEventListener('dragover', onDragOver, true)
      pane.removeEventListener('drop', onDrop, true)
    }
  }, [editor, currentDoc])

  useEffect(() => {
    const pane = secondaryPaneRef.current
    if (!pane || !secondaryEditor || splitView !== 'editor') return

    const onDragStart = (event) => handlePaneDragStart(event, secondaryEditor, 'secondary', secondaryDoc)
    const onDragEnd = () => {
      emitDnDDebug('secondary-pane-dragend', {
        source: 'editor',
        editorSelection: Boolean(window.__inkblot_draggedEditorSelection),
        clipboardPayload: Boolean(window.__inkblot_draggedClipboardEntry),
      }, '', true)
    }
    const onDragOver = (event) => handlePaneDragOver(event, secondaryEditor)
    const onDrop = (event) => handlePaneDrop(event, secondaryEditor)

    pane.addEventListener('dragstart', onDragStart, true)
    pane.addEventListener('dragend', onDragEnd, true)
    pane.addEventListener('dragover', onDragOver, true)
    pane.addEventListener('drop', onDrop, true)

    return () => {
      pane.removeEventListener('dragstart', onDragStart, true)
      pane.removeEventListener('dragend', onDragEnd, true)
      pane.removeEventListener('dragover', onDragOver, true)
      pane.removeEventListener('drop', onDrop, true)
    }
  }, [secondaryEditor, secondaryDoc, splitView])

  useEffect(() => {
    const onWindowDragOver = (event) => {
      try { window.__inkblot_dragPoint = { x: event.clientX, y: event.clientY } } catch (e) {}
      const payload = getDraggedClipboardPayload(event)
      if (!payload) {
        setDragCaret(null)
        return
      }

      const targetEditor = getTargetEditorAtPoint(event.clientX, event.clientY)
      if (!targetEditor) {
        setDragCaret(null)
        return
      }

      event.preventDefault()
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move'
      }
      updateDropCaret(targetEditor, event)
      emitDnDDebug('window-dragover-editor-target', {
        over: 'editor',
        clipboardPayload: true,
      }, '', true)
    }

    const onWindowDrag = (event) => {
      try { window.__inkblot_dragPoint = { x: event.clientX, y: event.clientY } } catch (e) {}
      const payload = window.__inkblot_draggedClipboardEntry || null
      if (!payload?.text) {
        setDragCaret(null)
        return
      }

      const targetEditor = getTargetEditorAtPoint(event.clientX, event.clientY)
      if (!targetEditor) {
        setDragCaret(null)
        return
      }

      updateDropCaret(targetEditor, event)
      emitDnDDebug('window-drag-editor-target', {
        over: 'editor',
        clipboardPayload: true,
      }, '', true)
    }

    const onWindowDrop = (event) => {
      const payload = getDraggedClipboardPayload(event)
      if (!payload) return

      const targetEditor = getTargetEditorAtPoint(event.clientX, event.clientY)
      if (!targetEditor) return

      handlePaneDrop(event, targetEditor)
      emitDnDDebug('window-drop-editor-target', {
        over: 'editor',
        dropHandled: true,
      })
    }

    const onWindowDragEnd = (event) => {
      if (!window.__inkblot_dragPoint && (event?.clientX || event?.clientY)) {
        try { window.__inkblot_dragPoint = { x: event.clientX, y: event.clientY } } catch (e) {}
      }
      setDragCaret(null)
      emitDnDDebug('window-dragend', {
        dropHandled: Boolean(window.__inkblot_dropHandled),
        clipboardPayload: Boolean(window.__inkblot_draggedClipboardEntry),
        editorSelection: Boolean(window.__inkblot_draggedEditorSelection),
      }, `x=${String(event?.clientX ?? window.__inkblot_dragPoint?.x ?? null)} y=${String(event?.clientY ?? window.__inkblot_dragPoint?.y ?? null)}`)
    }

    window.addEventListener('drag', onWindowDrag, true)
    window.addEventListener('dragover', onWindowDragOver, true)
    window.addEventListener('drop', onWindowDrop, true)
    window.addEventListener('dragend', onWindowDragEnd, true)

    return () => {
      window.removeEventListener('drag', onWindowDrag, true)
      window.removeEventListener('dragover', onWindowDragOver, true)
      window.removeEventListener('drop', onWindowDrop, true)
      window.removeEventListener('dragend', onWindowDragEnd, true)
    }
  }, [editor, secondaryEditor, splitView])

  useEffect(() => {
    const onClipboardDragEndDrop = (event) => {
      const detail = event?.detail || {}
      const point = {
        x: detail.x ?? window.__inkblot_dragPoint?.x ?? null,
        y: detail.y ?? window.__inkblot_dragPoint?.y ?? null,
      }
      const payload = {
        id: detail.id || '',
        text: detail.text || '',
      }

      if (window.__inkblot_dropHandled) {
        emitDnDDebug('clipboard-dragend-drop-skipped', {
          source: 'clipboard',
          dropHandled: true,
        }, `id=${payload.id || 'none'}`)
        setDragCaret(null)
        clearDragGlobals()
        return
      }

      const targetEditor = getTargetEditorAtPoint(point.x, point.y)
      if (targetEditor && payload.text) {
        insertClipboardPayloadAtPoint(payload, targetEditor, point.x, point.y)
      } else {
        emitDnDDebug('clipboard-dragend-drop-miss', {
          source: 'clipboard',
          over: 'none',
          clipboardPayload: Boolean(payload.text),
        }, `x=${String(point.x)} y=${String(point.y)}`)
      }

      setDragCaret(null)
      clearDragGlobals()
    }

    window.addEventListener('inkblot:clipboard-dragend-drop', onClipboardDragEndDrop)
    return () => {
      window.removeEventListener('inkblot:clipboard-dragend-drop', onClipboardDragEndDrop)
    }
  }, [editor, secondaryEditor, splitView])

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
          ref={primaryPaneRef}
          className="pane primary-pane"
          onFocus={() => setActiveDoc(currentDoc)}
          onMouseEnter={() => setActiveDoc(currentDoc)}
          onWheel={() => setActiveDoc(currentDoc)}
          onMouseDown={() => focusEditor(editor)}
          onClick={() => focusEditor(editor)}
          onMouseMove={() => setActiveEditor?.(editor)}
        >
          {dragCaret?.pane === 'primary' ? (
            <div
              className="drag-drop-caret"
              style={{
                left: `${dragCaret.left}px`,
                top: `${dragCaret.top}px`,
                height: `${dragCaret.height}px`,
              }}
            />
          ) : null}
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
            ref={secondaryPaneRef}
            className="pane secondary-pane"
            onFocus={() => setActiveDoc(secondaryDoc)}
            onMouseEnter={() => setActiveDoc(secondaryDoc)}
            onWheel={() => setActiveDoc(secondaryDoc)}
            onMouseDown={() => focusEditor(secondaryEditor)}
            onClick={() => focusEditor(secondaryEditor)}
            onMouseMove={() => setActiveEditor?.(secondaryEditor)}
          >
            {dragCaret?.pane === 'secondary' ? (
              <div
                className="drag-drop-caret"
                style={{
                  left: `${dragCaret.left}px`,
                  top: `${dragCaret.top}px`,
                  height: `${dragCaret.height}px`,
                }}
              />
            ) : null}
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

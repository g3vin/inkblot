/**
 * NoteAnnotation.js — renders note markers (colored dots) in the editor.
 *
 * A ProseMirror decoration plugin places a widget dot at the end of every
 * quote note's anchored range. Hovering/clicking a dot emits the
 * NOTE_PREVIEW_* window events consumed by NoteHoverPreview. React pushes
 * note lists into the plugin via syncEditorNotes (EditorCanvas calls it
 * whenever a doc's notes change); decorations are only rebuilt when the
 * note signature actually changes.
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

const NOTE_ANNOTATION_PLUGIN_KEY = new PluginKey('noteAnnotation')
const pendingSyncByEditor = new WeakMap()
export const NOTE_PREVIEW_ENTER_EVENT = 'inkblot:note-preview-enter'
export const NOTE_PREVIEW_LEAVE_EVENT = 'inkblot:note-preview-leave'
export const NOTE_PREVIEW_PIN_EVENT = 'inkblot:note-preview-pin'

const EMPTY_STATE = {
  docName: null,
  notes: [],
  signature: '',
  decorations: DecorationSet.empty,
}

const getViewFromTarget = (target) => {
  if (!target) return null
  if (target.state && target.dispatch) return target
  if (target.isDestroyed) return null

  try {
    if (target.editorView?.state && target.editorView?.dispatch) {
      return target.editorView
    }
  } catch {
    // TipTap can throw while the editor view is still mounting.
  }

  try {
    if (target.view?.state && target.view?.dispatch) {
      return target.view
    }
  } catch {
    // Some editor wrappers expose view lazily.
  }

  return null
}

const getPluginState = (target) => {
  const view = getViewFromTarget(target)
  if (!view?.state) return EMPTY_STATE
  return NOTE_ANNOTATION_PLUGIN_KEY.getState(view.state) || EMPTY_STATE
}

const getComparableNote = (note) => ({
  id: note?.id || '',
  type: note?.type || '',
  from: note?.from,
  to: note?.to,
  color: note?.color || '',
})

const areNotesEqual = (left = [], right = []) => {
  if (left === right) return true
  if (!Array.isArray(left) || !Array.isArray(right)) return false
  if (left.length !== right.length) return false

  for (let index = 0; index < left.length; index += 1) {
    const leftNote = getComparableNote(left[index])
    const rightNote = getComparableNote(right[index])

    if (
      leftNote.id !== rightNote.id ||
      leftNote.type !== rightNote.type ||
      leftNote.from !== rightNote.from ||
      leftNote.to !== rightNote.to ||
      leftNote.color !== rightNote.color
    ) {
      return false
    }
  }

  return true
}

const dispatchNoteMeta = (editor, notes, docName = null) => {
  const view = getViewFromTarget(editor)
  if (!view?.state || !view.dispatch) return false

  const currentState = getPluginState(view)
  const nextNotes = Array.isArray(notes) ? notes : []
  const nextDocName = typeof docName === 'string' ? docName : null

  if (currentState.docName === nextDocName && areNotesEqual(currentState.notes, nextNotes)) {
    return true
  }

  const tr = view.state.tr.setMeta(NOTE_ANNOTATION_PLUGIN_KEY, {
    docName: nextDocName,
    notes: nextNotes,
  })
  view.dispatch(tr)
  return true
}

// If the editor view isn't ready yet, retry the sync on the next animation frame.
const scheduleNoteSync = (editor, notes, docName = null) => {
  if (!editor || editor.isDestroyed) return

  const previousFrame = pendingSyncByEditor.get(editor)
  if (previousFrame) {
    cancelAnimationFrame(previousFrame)
  }

  const frameId = requestAnimationFrame(() => {
    pendingSyncByEditor.delete(editor)
    dispatchNoteMeta(editor, notes, docName)
  })

  pendingSyncByEditor.set(editor, frameId)
}

/** Push a document's notes into the annotation plugin (public API for React code). */
export const syncEditorNotes = (editor, notes, docName = null) => {
  if (!dispatchNoteMeta(editor, notes, docName)) {
    scheduleNoteSync(editor, notes, docName)
  }
}

// Intentional no-ops: NoteHoverPreview still calls these to signal hover/active
// note state, but the in-editor text highlight they used to drive was removed.
// Kept as stubs so the hook points survive if that highlight returns.
export const setEditorHoveredNote = () => {}
export const setEditorActiveNote = () => {}
export const clearEditorActiveNote = () => {}

const serializeRect = (rect) => ({
  left: rect.left,
  top: rect.top,
  right: rect.right,
  bottom: rect.bottom,
  width: rect.width,
  height: rect.height,
})

const dispatchPreviewEvent = (eventName, note, marker, view, docName) => {
  if (typeof window === 'undefined' || !note || !marker) return

  const rect = marker.getBoundingClientRect?.()
  if (!rect) return

  window.dispatchEvent(new CustomEvent(eventName, {
    detail: {
      note: {
        ...note,
        docName,
      },
      anchorRect: serializeRect(rect),
      editorView: view,
    },
  }))
}

/** Cheap change-detection key over the quote notes that affect decorations. */
const getNoteSignature = (notes = [], docName = null, docSize = 0) => (
  `${docName || ''}:${docSize}:${
    (Array.isArray(notes) ? notes : [])
      .filter(note => note?.type === 'quote')
      .map(note => [
        note.id || '',
        note.from,
        note.to,
        note.color || '',
      ].join(':'))
      .join('|')
  }`
)

const buildNoteDecorations = (doc, notes = [], docName = null) => {
  const decorations = []
  const docSize = doc.content.size

  notes.forEach((note) => {
    if (note.type !== 'quote') return
    if (!Number.isFinite(note.from) || !Number.isFinite(note.to)) return
    if (note.from < 0 || note.to > docSize || note.from >= note.to) return

    decorations.push(
      Decoration.widget(
        note.to,
        (view) => {
          const marker = document.createElement('span')
          marker.className = 'note-marker'
          marker.dataset.noteId = note.id
          marker.style.setProperty('--note-color', note.color || '#007aff')

          const dot = document.createElement('span')
          dot.className = 'note-dot'
          dot.style.backgroundColor = note.color || '#007aff'

          marker.appendChild(dot)
          marker.onmousedown = (event) => {
            event.preventDefault()
            event.stopPropagation()
          }
          marker.onmouseenter = () => {
            dispatchPreviewEvent(
              NOTE_PREVIEW_ENTER_EVENT,
              note,
              marker,
              view,
              docName
            )
          }
          marker.onmouseleave = () => {
            dispatchPreviewEvent(
              NOTE_PREVIEW_LEAVE_EVENT,
              note,
              marker,
              view,
              docName
            )
          }
          marker.onclick = (event) => {
            event.preventDefault()
            event.stopPropagation()
            dispatchPreviewEvent(
              NOTE_PREVIEW_PIN_EVENT,
              note,
              marker,
              view,
              docName
            )
          }
          return marker
        },
        { side: 1, key: `note-widget:${note.id}` }
      )
    )
  })

  return DecorationSet.create(doc, decorations)
}

export const NoteAnnotation = Extension.create({
  name: 'noteAnnotation',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: NOTE_ANNOTATION_PLUGIN_KEY,
        state: {
          init() {
            return EMPTY_STATE
          },
          apply(transaction, pluginState) {
            const meta = transaction.getMeta(NOTE_ANNOTATION_PLUGIN_KEY)
            if (!meta) {
              if (!transaction.docChanged) return pluginState
              return {
                ...pluginState,
                decorations: (pluginState.decorations || DecorationSet.empty)
                  .map(transaction.mapping, transaction.doc),
              }
            }

            const nextDocName = typeof meta.docName === 'string' ? meta.docName : pluginState.docName
            const nextNotes = Array.isArray(meta.notes) ? meta.notes : pluginState.notes
            const nextSignature = getNoteSignature(nextNotes, nextDocName, transaction.doc.content.size)

            if (pluginState.signature === nextSignature && pluginState.decorations) {
              return {
                docName: nextDocName,
                notes: nextNotes,
                signature: nextSignature,
                decorations: pluginState.decorations,
              }
            }

            return {
              docName: nextDocName,
              notes: nextNotes,
              signature: nextSignature,
              decorations: buildNoteDecorations(transaction.doc, nextNotes, nextDocName),
            }
          },
        },
        props: {
          decorations(state) {
            const pluginState = NOTE_ANNOTATION_PLUGIN_KEY.getState(state) || EMPTY_STATE
            return pluginState.decorations || DecorationSet.empty
          },
        },
      }),
    ]
  },
})

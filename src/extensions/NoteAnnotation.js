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

export const syncEditorNotes = (editor, notes, docName = null) => {
  if (!dispatchNoteMeta(editor, notes, docName)) {
    scheduleNoteSync(editor, notes, docName)
  }
}

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
            if (!meta) return pluginState

            return {
              docName: typeof meta.docName === 'string' ? meta.docName : pluginState.docName,
              notes: Array.isArray(meta.notes) ? meta.notes : pluginState.notes,
            }
          },
        },
        props: {
          decorations(state) {
            const pluginState = NOTE_ANNOTATION_PLUGIN_KEY.getState(state) || EMPTY_STATE
            const notes = pluginState.notes || []
            const decorations = []
            const docSize = state.doc.content.size

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
                        pluginState.docName
                      )
                    }
                    marker.onmouseleave = () => {
                      dispatchPreviewEvent(
                        NOTE_PREVIEW_LEAVE_EVENT,
                        note,
                        marker,
                        view,
                        pluginState.docName
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
                        pluginState.docName
                      )
                    }
                    return marker
                  },
                  { side: 1, key: `note-widget:${note.id}` }
                )
              )
            })

            return DecorationSet.create(state.doc, decorations)
          },
        },
      }),
    ]
  },
})

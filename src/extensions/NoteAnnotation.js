import { Extension } from '@tiptap/core'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { Plugin, PluginKey } from '@tiptap/pm/state'

export const NoteAnnotation = Extension.create({
  name: 'noteAnnotation',
  addStorage() {
    return { notes: [] }
  },
  addProseMirrorPlugins() {
    const self = this
    return [
      new Plugin({
        key: new PluginKey('noteAnnotation'),
        props: {
          decorations(state) {
            const decorations = []
            const notes = self.storage.notes || []

            state.doc.descendants((node, pos) => {
              if (!node.isText) return
              notes.forEach(note => {
                const idx = node.text.indexOf(note.anchor)
                if (idx !== -1) {
                  decorations.push(
                    Decoration.widget(
                      pos + idx + note.anchor.length,
                      () => {
                        const dot = document.createElement('span')
                        dot.className = 'note-dot'
                        dot.onclick = e => {
                          e.stopPropagation()
                          window.dispatchEvent(
                            new CustomEvent('open-note', { detail: note.id })
                          )
                        }
                        return dot
                      }
                    )
                  )
                }
              })
            })

            return DecorationSet.create(state.doc, decorations)
          },
        },
      }),
    ]
  },
})
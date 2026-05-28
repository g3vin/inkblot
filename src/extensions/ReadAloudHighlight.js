import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export const READ_ALOUD_HIGHLIGHT_PLUGIN_KEY = new PluginKey('readAloudHighlight')

const EMPTY_DECORATIONS = DecorationSet.empty

const isValidRange = (state, range) => {
  if (!range) return false
  if (!Number.isFinite(range.from) || !Number.isFinite(range.to)) return false
  return range.from >= 0 && range.to > range.from && range.to <= state.doc.content.size
}

export const ReadAloudHighlight = Extension.create({
  name: 'readAloudHighlight',

  addCommands() {
    return {
      setReadAloudHighlight: (range) => ({ dispatch, state, tr }) => {
        if (!isValidRange(state, range)) return false

        if (dispatch) {
          dispatch(tr.setMeta(READ_ALOUD_HIGHLIGHT_PLUGIN_KEY, { range }))
        }

        return true
      },

      clearReadAloudHighlight: () => ({ dispatch, tr }) => {
        if (dispatch) {
          dispatch(tr.setMeta(READ_ALOUD_HIGHLIGHT_PLUGIN_KEY, { range: null }))
        }

        return true
      },
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: READ_ALOUD_HIGHLIGHT_PLUGIN_KEY,
        state: {
          init() {
            return EMPTY_DECORATIONS
          },
          apply(transaction, decorations, oldState, newState) {
            const meta = transaction.getMeta(READ_ALOUD_HIGHLIGHT_PLUGIN_KEY)

            if (meta) {
              if (!isValidRange(newState, meta.range)) {
                return EMPTY_DECORATIONS
              }

              return DecorationSet.create(newState.doc, [
                Decoration.inline(meta.range.from, meta.range.to, {
                  class: 'read-aloud-word-highlight',
                }),
              ])
            }

            return transaction.docChanged ? decorations.map(transaction.mapping, transaction.doc) : decorations
          },
        },
        props: {
          decorations(state) {
            return READ_ALOUD_HIGHLIGHT_PLUGIN_KEY.getState(state) || EMPTY_DECORATIONS
          },
        },
      }),
    ]
  },
})

export const setReadAloudHighlight = (editor, range) => {
  if (!editor || editor.isDestroyed || !isValidRange(editor.state, range)) return false
  return editor.commands.setReadAloudHighlight(range)
}

export const clearReadAloudHighlight = (editor) => {
  if (!editor || editor.isDestroyed) return false
  return editor.commands.clearReadAloudHighlight()
}

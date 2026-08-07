/**
 * DictationInline.js — decorates the live dictation range in the editor.
 *
 * While dictating, DictationControl inserts draft text and marks its range
 * here; the plugin styles it (draft vs. finalizing) with decorations and
 * remaps the range through document edits. The exported helpers are the
 * API used by DictationControl.
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export const DICTATION_INLINE_PLUGIN_KEY = new PluginKey('dictationInline')

const EMPTY_DECORATIONS = DecorationSet.empty
const EMPTY_STATE = { range: null, status: 'idle' }

const isValidRange = (state, range) => {
  if (!range) return false
  if (!Number.isFinite(range.from) || !Number.isFinite(range.to)) return false
  return range.from >= 0 && range.to > range.from && range.to <= state.doc.content.size
}

const getClassName = (status) => (
  status === 'finalizing'
    ? 'dictation-inline-finalizing'
    : 'dictation-inline-draft'
)

const createDecorations = (doc, range, status) => (
  DecorationSet.create(doc, [
    Decoration.inline(range.from, range.to, {
      class: getClassName(status),
    }),
  ])
)

export const DictationInline = Extension.create({
  name: 'dictationInline',

  addCommands() {
    return {
      setDictationInlineRange: (range, status = 'draft') => ({ dispatch, state, tr }) => {
        if (!isValidRange(state, range)) return false

        if (dispatch) {
          dispatch(tr.setMeta(DICTATION_INLINE_PLUGIN_KEY, { range, status }))
        }

        return true
      },

      clearDictationInlineRange: () => ({ dispatch, tr }) => {
        if (dispatch) {
          dispatch(tr.setMeta(DICTATION_INLINE_PLUGIN_KEY, { range: null, status: 'idle' }))
        }

        return true
      },
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: DICTATION_INLINE_PLUGIN_KEY,
        state: {
          init() {
            return { ...EMPTY_STATE, decorations: EMPTY_DECORATIONS }
          },
          apply(transaction, pluginState, oldState, newState) {
            const meta = transaction.getMeta(DICTATION_INLINE_PLUGIN_KEY)

            if (meta) {
              if (!isValidRange(newState, meta.range)) {
                return { ...EMPTY_STATE, decorations: EMPTY_DECORATIONS }
              }

              return {
                range: meta.range,
                status: meta.status || 'draft',
                decorations: createDecorations(newState.doc, meta.range, meta.status),
              }
            }

            if (!transaction.docChanged || !pluginState.range) return pluginState

            const mappedFrom = transaction.mapping.mapResult(pluginState.range.from, 1)
            const mappedTo = transaction.mapping.mapResult(pluginState.range.to, -1)
            const nextRange = {
              from: mappedFrom.pos,
              to: mappedTo.pos,
            }

            if (
              mappedFrom.deletedAcross ||
              mappedTo.deletedAcross ||
              !isValidRange(newState, nextRange)
            ) {
              return { ...EMPTY_STATE, decorations: EMPTY_DECORATIONS }
            }

            return {
              range: nextRange,
              status: pluginState.status,
              decorations: createDecorations(newState.doc, nextRange, pluginState.status),
            }
          },
        },
        props: {
          decorations(state) {
            return DICTATION_INLINE_PLUGIN_KEY.getState(state)?.decorations || EMPTY_DECORATIONS
          },
        },
      }),
    ]
  },
})

export const setDictationInlineRange = (editor, range, status = 'draft') => {
  if (!editor || editor.isDestroyed || !isValidRange(editor.state, range)) return false
  return editor.commands.setDictationInlineRange(range, status)
}

export const clearDictationInlineRange = (editor) => {
  if (!editor || editor.isDestroyed) return false
  return editor.commands.clearDictationInlineRange()
}

export const getDictationInlineRange = (editor) => {
  if (!editor || editor.isDestroyed) return null
  return DICTATION_INLINE_PLUGIN_KEY.getState(editor.state)?.range || null
}

export const getDictationInlineState = (editor) => {
  if (!editor || editor.isDestroyed) return null
  return DICTATION_INLINE_PLUGIN_KEY.getState(editor.state) || null
}

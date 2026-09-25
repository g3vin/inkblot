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
const EMPTY_STATE = { range: null, status: 'idle', anchorAt: 0, tick: 0 }

// Must match the `dictation-inline-flow-*` duration in Editor.css.
const DRAFT_FLOW_DURATION_MS = 960
// Two identical keyframe sets, alternated to force a restart — see below.
const DRAFT_FLOW_NAMES = ['dictation-inline-flow-a', 'dictation-inline-flow-b']
// Re-phasing finer than a frame is churn nobody can see.
const DRAFT_FLOW_QUANTUM_MS = 16

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

// Revising a draft rewrites its text, so the shimmer has to survive two very
// different DOM outcomes: ProseMirror patching the decorated span's attributes
// in place (TextViewDesc.update -> patchOuterDeco), or rebuilding the span
// outright. A negative `animation-delay` measured from the draft's anchor puts
// a *fresh* animation at the right phase, but re-applying it to a running one
// leaves the original start time in place and the phase lurches forward by the
// span's age. So alternate the animation name as well: that forces a restart,
// and the delay is then always measured from the restart. Both paths land on
// phase `now - anchorAt`, which is the same sweep the draft started with.
const getDecorationAttrs = (status, anchorAt, tick) => {
  const className = getClassName(status)
  if (status === 'finalizing' || !Number.isFinite(anchorAt) || !anchorAt) {
    return { class: className }
  }

  const elapsed = Math.max(0, Date.now() - anchorAt) % DRAFT_FLOW_DURATION_MS
  const phase = Math.round(elapsed / DRAFT_FLOW_QUANTUM_MS) * DRAFT_FLOW_QUANTUM_MS
  const name = DRAFT_FLOW_NAMES[tick % DRAFT_FLOW_NAMES.length]

  return {
    class: className,
    style: `animation-name: ${name}; animation-delay: -${phase}ms;`,
  }
}

const createDecorations = (doc, range, status, anchorAt, tick) => (
  DecorationSet.create(doc, [
    Decoration.inline(range.from, range.to, getDecorationAttrs(status, anchorAt, tick)),
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

              const status = meta.status || 'draft'
              // A draft that is still the same draft keeps its animation origin.
              const keepsAnchor = status === 'draft' &&
                pluginState.status === 'draft' &&
                Boolean(pluginState.anchorAt)
              const anchorAt = keepsAnchor ? pluginState.anchorAt : Date.now()
              const tick = pluginState.tick + 1

              return {
                range: meta.range,
                status,
                anchorAt,
                tick,
                decorations: createDecorations(newState.doc, meta.range, status, anchorAt, tick),
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

            const tick = pluginState.tick + 1

            return {
              range: nextRange,
              status: pluginState.status,
              anchorAt: pluginState.anchorAt,
              tick,
              decorations: createDecorations(
                newState.doc,
                nextRange,
                pluginState.status,
                pluginState.anchorAt,
                tick,
              ),
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

/**
 * Mark `range` on a transaction that is already changing the document, so the
 * text edit and the decoration land together. Two separate dispatches let the
 * remapping step see a range it cannot map (a full-range rewrite maps `to`
 * below `from`), drop the decoration, and lose the draft's animation anchor.
 */
export const withDictationInlineRange = (tr, range, status = 'draft') => (
  tr.setMeta(DICTATION_INLINE_PLUGIN_KEY, { range, status })
)

export const setDictationInlineRange = (editor, range, status = 'draft') => {
  if (!editor || editor.isDestroyed || !isValidRange(editor.state, range)) return false
  return editor.commands.setDictationInlineRange(range, status)
}

export const clearDictationInlineRange = (editor) => {
  if (!editor || editor.isDestroyed) return false
  return editor.commands.clearDictationInlineRange()
}

export const getDictationInlineState = (editor) => {
  if (!editor || editor.isDestroyed) return null
  return DICTATION_INLINE_PLUGIN_KEY.getState(editor.state) || null
}

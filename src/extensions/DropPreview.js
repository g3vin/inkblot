/**
 * DropPreview.js — text held over the page before it is dropped.
 *
 * When a clipboard piece is held still over an editor, the pane shows where it would
 * land: the text, set in the accent, at the drop position. It is a widget decoration,
 * not an edit, so the document, its history and its autosave never see it; releasing
 * the pointer makes the real insertion, and moving it clears the preview.
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export const DROP_PREVIEW_PLUGIN_KEY = new PluginKey('dropPreview')

const EMPTY = { pos: null, text: '', decorations: DecorationSet.empty }

const renderPreview = (text) => () => {
  const span = document.createElement('span')
  span.className = 'drop-preview'
  // Line breaks drawn as breaks, as the dropped text will show them.
  text.split('\n').forEach((line, index) => {
    if (index) span.append(document.createElement('br'))
    span.append(line)
  })
  span.setAttribute('aria-hidden', 'true')
  return span
}

/** Show `text` at `pos` in this view, or clear the preview with a null `pos`. */
export function setDropPreview(view, pos, text = '') {
  if (!view || view.isDestroyed) return
  const current = DROP_PREVIEW_PLUGIN_KEY.getState(view.state)
  if (current?.pos === pos && current?.text === text) return
  view.dispatch(view.state.tr
    .setMeta(DROP_PREVIEW_PLUGIN_KEY, { pos, text })
    .setMeta('addToHistory', false))
}

/** The preview's element in this view, if one is showing. */
export const dropPreviewElement = (view) => view?.dom?.querySelector?.('.drop-preview') ?? null

export const DropPreview = Extension.create({
  name: 'dropPreview',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: DROP_PREVIEW_PLUGIN_KEY,
        state: {
          init: () => EMPTY,
          apply(tr, value, _old, state) {
            const meta = tr.getMeta(DROP_PREVIEW_PLUGIN_KEY)
            if (meta) {
              const { pos, text } = meta
              if (pos == null || !text || pos < 0 || pos > state.doc.content.size) return EMPTY
              return {
                pos,
                text,
                decorations: DecorationSet.create(state.doc, [
                  Decoration.widget(pos, renderPreview(text), { side: 1, key: `drop-preview:${text}` }),
                ]),
              }
            }
            if (!tr.docChanged || value.pos == null) return value
            const pos = tr.mapping.map(value.pos)
            return { ...value, pos, decorations: value.decorations.map(tr.mapping, tr.doc) }
          },
        },
        props: {
          decorations: (state) => DROP_PREVIEW_PLUGIN_KEY.getState(state)?.decorations ?? null,
        },
      }),
    ]
  },
})

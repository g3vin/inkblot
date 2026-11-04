/**
 * EntityMentions.js — name tags: every character, place or other story entry named in
 * the text is underlined in its folder's ink, and ⌘-click opens it (⌥⌘-click, beside).
 *
 * The tags are decorations, never marks: nothing is saved, undone, copied or printed.
 * The plugin reads its own inputs — the names to look for (lib/storyEntries.ts) and
 * whether the layer is shown (lib/markVisibility.ts) — so every document editor has it
 * with nothing to wire, and so does a canvas card being edited (buildCardExtensions).
 *
 * Cost: a whole-document scan only when the names, the layer or the document shown
 * changes. An edit maps the tags it kept and rescans just the textblocks it touched.
 * A plain click is ordinary editing; only a click with ⌘ (Ctrl off macOS) opens, and
 * resting on a tag shows its card (lib/entityLinks.js). A name that reads as an
 * ordinary word where it stands ("Will you come?") is left alone (lib/nameContext.ts).
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { endPreview, isLinkClick, linkHint, openFromPane, openTagFromEvent, paneOf, previewTagAt } from '../lib/entityLinks'
import { getMarkVisibility, onMarkVisibilityChange } from '../lib/markVisibility'
import { onNameContextReady } from '../lib/nameContext'
import { inkColor } from '../lib/palette'
import { getNameIndex, onStoryEntriesChange, tagMentions } from '../lib/storyEntries'

export const ENTITY_MENTIONS_KEY = new PluginKey('entityMentions')

/** Stands in for what a name can't run through: an inline node, or code. */
const BLOCKED = '￼'

const EMPTY = { index: null, exceptPath: null, decorations: DecorationSet.empty }

/**
 * A textblock's text with one character per document position, so a match's offsets
 * are positions from the block's start. Code and inline nodes become BLOCKED.
 */
function blockText(block) {
  let text = ''
  block.forEach((child) => {
    if (child.isText && !child.marks.some((mark) => mark.type.spec.code)) text += child.text
    else text += BLOCKED.repeat(child.nodeSize)
  })
  return text
}

function blockDecorations(block, start, index, exceptPath, out) {
  if (block.type.spec.code) return
  const tip = linkHint()
  for (const { from, to, entry } of tagMentions(blockText(block), index, exceptPath).mentions) {
    out.push(Decoration.inline(start + from, start + to, {
      class: 'entity-mention',
      'data-entity-path': entry.path,
      title: `${tip} to open ${entry.name}`,
      style: `--entity-ink: ${inkColor(entry.ink)}`,
    }, { entityPath: entry.path }))
  }
}

function scanAll(doc, index, exceptPath) {
  if (!index?.pattern) return DecorationSet.empty
  const decorations = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    blockDecorations(node, pos + 1, index, exceptPath, decorations)
    return false
  })
  return DecorationSet.create(doc, decorations)
}

/** The ranges of the new document a transaction touched. */
function changedRanges(tr) {
  const ranges = []
  tr.mapping.maps.forEach((map, i) => {
    const rest = tr.mapping.slice(i + 1)
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      ranges.push([rest.map(newStart, -1), rest.map(newEnd, 1)])
    })
  })
  return ranges
}

function rescanChanged(tr, decorations, index, exceptPath) {
  const { doc } = tr
  let next = decorations.map(tr.mapping, doc)
  if (!index?.pattern) return next
  const seen = new Set()
  for (const [from, to] of changedRanges(tr)) {
    // A step at a block's edge (a join, a split) can sit between blocks, so look one
    // position either side.
    doc.nodesBetween(Math.max(0, from - 1), Math.min(doc.content.size, to + 1), (node, pos) => {
      if (!node.isTextblock) return true
      if (seen.has(pos)) return false
      seen.add(pos)
      const start = pos + 1
      const end = start + node.content.size
      const fresh = []
      blockDecorations(node, start, index, exceptPath, fresh)
      next = next.remove(next.find(start, end)).add(doc, fresh)
      return false
    })
  }
  return next
}

export const EntityMentions = Extension.create({
  name: 'entityMentions',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: ENTITY_MENTIONS_KEY,
        state: {
          init: () => EMPTY,
          apply(tr, value) {
            const meta = tr.getMeta(ENTITY_MENTIONS_KEY)
            if (meta) {
              const index = getMarkVisibility().names ? getNameIndex() : null
              return { index, exceptPath: meta.exceptPath, decorations: scanAll(tr.doc, index, meta.exceptPath) }
            }
            if (!tr.docChanged) return value
            return { ...value, decorations: rescanChanged(tr, value.decorations, value.index, value.exceptPath) }
          },
        },
        props: {
          decorations: (state) => ENTITY_MENTIONS_KEY.getState(state)?.decorations || DecorationSet.empty,
          handleDOMEvents: {
            mousedown: (view, event) => openTagFromEvent(event, (path, beside) => openFromPane(paneOf(view).pane, path, beside)),
            mouseover: (_view, event) => {
              previewTagAt(event.target)
              return false
            },
            mouseleave: () => {
              endPreview()
              return false
            },
          },
        },
        view(view) {
          let frame = 0
          let destroyed = false
          // One rescan per frame, however many of the inputs changed in it.
          const refresh = () => {
            if (frame || destroyed) return
            frame = requestAnimationFrame(() => {
              frame = 0
              if (destroyed || view.isDestroyed) return
              const tr = view.state.tr.setMeta(ENTITY_MENTIONS_KEY, { exceptPath: paneOf(view).docPath })
              view.dispatch(tr.setMeta('addToHistory', false))
            })
          }
          const offEntries = onStoryEntriesChange(refresh)
          const offMarks = onMarkVisibilityChange(refresh)
          // Names that read as ordinary words wait for the tagger (nameContext.ts).
          const offContext = onNameContextReady(refresh)

          // With ⌘ held, the tags read as links (EditorMarks.css).
          const setLinking = (event) => view.dom.classList.toggle('is-entity-linking', isLinkClick(event))
          const clearLinking = () => view.dom.classList.remove('is-entity-linking')
          window.addEventListener('keydown', setLinking)
          window.addEventListener('keyup', setLinking)
          window.addEventListener('blur', clearLinking)

          refresh()
          return {
            update(updated) {
              // A pane swapping documents keeps its editor: the document's own name is
              // no longer the one to leave untagged.
              const state = ENTITY_MENTIONS_KEY.getState(updated.state)
              if (state && paneOf(updated).docPath !== state.exceptPath) refresh()
            },
            destroy() {
              destroyed = true
              if (frame) cancelAnimationFrame(frame)
              offEntries()
              offMarks()
              offContext()
              window.removeEventListener('keydown', setLinking)
              window.removeEventListener('keyup', setLinking)
              window.removeEventListener('blur', clearLinking)
            },
          }
        },
      }),
    ]
  },
})

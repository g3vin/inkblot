/**
 * TableStyles.js — what a writer sets on a table beyond its text.
 *
 *   - a cell's fill: an ink id (palette.ts), drawn as a wash of that ink, saved as the
 *     cell's `fill` attribute and in HTML as `data-fill`;
 *   - which borders the table draws: 'all' (the default), 'outer', 'inner' or 'none',
 *     saved as the table's `borders` attribute and in HTML as `data-borders`.
 *
 * Both are part of the document, so they ride in its JSON, its versions and its HTML,
 * and the exports draw them (print/export/tableStyles.ts).
 *
 * A resizable table is drawn by a node view that renders its own <table>, so the
 * table's attributes never reach the page. Its borders are put on the node view's
 * wrapper with a node decoration instead (`.tableWrapper[data-borders]`).
 *
 * Everything else a table toolbar needs (rows, columns, merging, header rows, a cell's
 * alignment) the table extensions and TextAlign already have.
 */
import { findParentNode } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { Table } from '@tiptap/extension-table'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { isInkId } from '../lib/palette'

export const TABLE_BORDERS = ['all', 'outer', 'inner', 'none']

const TABLE_BORDERS_KEY = new PluginKey('tableBorders')

const fillAttribute = {
  fill: {
    default: null,
    parseHTML: (element) => {
      const fill = element.getAttribute('data-fill')
      return isInkId(fill) ? fill : null
    },
    renderHTML: (attributes) => (isInkId(attributes.fill) ? { 'data-fill': attributes.fill } : {}),
  },
}

export const StyledTableCell = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...fillAttribute }
  },
})

export const StyledTableHeader = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...fillAttribute }
  },
})

const findTable = (selection) => findParentNode((node) => node.type.name === 'table')(selection)

export const StyledTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      borders: {
        default: 'all',
        parseHTML: (element) => {
          const borders = element.getAttribute('data-borders')
          return TABLE_BORDERS.includes(borders) ? borders : 'all'
        },
        renderHTML: (attributes) => (
          attributes.borders && attributes.borders !== 'all' ? { 'data-borders': attributes.borders } : {}
        ),
      },
    }
  },

  addCommands() {
    return {
      ...this.parent?.(),
      /** Draw the borders of the table the selection is in: 'all', 'outer', 'inner' or 'none'. */
      setTableBorders: (borders) => ({ state, tr, dispatch }) => {
        if (!TABLE_BORDERS.includes(borders)) return false
        const table = findTable(state.selection)
        if (!table) return false
        if (dispatch) tr.setNodeMarkup(table.pos, undefined, { ...table.node.attrs, borders })
        return true
      },
    }
  },

  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() ?? []),
      new Plugin({
        key: TABLE_BORDERS_KEY,
        props: {
          decorations(state) {
            const decorations = []
            state.doc.descendants((node, pos) => {
              // Into blocks that may hold a table; never into a paragraph's text.
              if (node.type.name !== 'table') return !node.isTextblock
              if (node.attrs.borders && node.attrs.borders !== 'all') {
                decorations.push(Decoration.node(pos, pos + node.nodeSize, { 'data-borders': node.attrs.borders }))
              }
              return false
            })
            return decorations.length ? DecorationSet.create(state.doc, decorations) : DecorationSet.empty
          },
        },
      }),
    ]
  },
})

/** The table the selection is in, as `{ node, pos }`, or null. */
export const tableAt = (editor) => (editor ? findTable(editor.state.selection) : null)

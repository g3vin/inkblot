/**
 * TypesetAnchors.ts — a stable name for a block the typesetter has touched.
 *
 * The typeset history (typesetHistory.ts) keeps what was set on a paragraph or a picture
 * — its width, its alignment, later its style and tracking — apart from the text, so an
 * older typeset can be restored onto text written since. That needs to find the same
 * block again after the text around it has changed; a position will not do. So a block
 * gets a `typesetId` the first time something is set on it (`anchorBlock`), and keeps it.
 *
 * Only blocks that have been typeset carry one: a document never typeset has none. When
 * a block is split — Enter in the middle of it — both halves would carry the same id; the
 * second is given a new one, keeping only what is meant to carry on (a paragraph's
 * style), not what belonged to the lines it had (its tracking).
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { Transaction } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'

/** The blocks a typesetter sets something on, and what on each. */
export const TYPESET_BLOCKS: Record<string, string[]> = {
  paragraph: ['styleName', 'tracking', 'keepTogether', 'keepWithNext'],
  heading: ['keepWithNext'],
  blockquote: ['styleName'],
  image: ['width', 'align', 'layout'],
}

/**
 * What a block split in two — or copied — does not keep in its second half: what
 * belonged to the lines it had. A picture keeps everything, as a copy of it would.
 */
const NOT_INHERITED: Record<string, string[]> = {
  paragraph: ['tracking', 'keepTogether', 'keepWithNext'],
  heading: ['keepWithNext'],
}

let counter = 0
export const newTypesetId = (): string => {
  counter = (counter + 1) % 46656
  return `t${Date.now().toString(36)}${counter.toString(36)}`
}

/** The typeset attributes a block has, of those its type can have. */
export const typesetAttrsOf = (node: PMNode | { type: string | { name: string }; attrs?: Record<string, unknown> }): Record<string, unknown> => {
  const name = typeof node.type === 'string' ? node.type : node.type.name
  const keys = TYPESET_BLOCKS[name] || []
  const out: Record<string, unknown> = {}
  for (const key of keys) {
    const value = node.attrs?.[key]
    if (value !== undefined && value !== null && value !== '') out[key] = value
  }
  return out
}

/**
 * Give the block at `pos` a typeset id if it has none, in `tr`. Returns the id. Call it
 * before setting a typeset attribute on the block.
 */
export const anchorBlock = (tr: Transaction, pos: number): string | null => {
  const node = tr.doc.nodeAt(pos)
  if (!node || !(node.type.name in TYPESET_BLOCKS) || !('typesetId' in node.attrs)) return null
  if (node.attrs.typesetId) return node.attrs.typesetId as string
  const id = newTypesetId()
  tr.setNodeAttribute(pos, 'typesetId', id)
  return id
}

export const typesetAnchorsKey = new PluginKey('typesetAnchors')

export const TypesetAnchors = Extension.create({
  name: 'typesetAnchors',

  addGlobalAttributes() {
    return [
      {
        types: Object.keys(TYPESET_BLOCKS),
        attributes: {
          typesetId: {
            default: null,
            // Kept in the document's JSON only: it means nothing outside the app.
            parseHTML: () => null,
            renderHTML: () => ({}),
          },
        },
      },
    ]
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: typesetAnchorsKey,
        // A block split in two: the second half is a block of its own.
        appendTransaction: (transactions, _old, state) => {
          // Only a change that puts blocks in — Enter, a paste — can make two of one;
          // typing never does, and is not made to walk the document.
          const addsBlocks = transactions.some((t) => t.steps.some((step) => {
            const slice = (step as unknown as { slice?: { content: { firstChild: PMNode | null; childCount: number }; openStart: number } }).slice
            return Boolean(slice && slice.content.childCount && (slice.openStart > 0 || slice.content.firstChild?.isBlock))
          }))
          if (!addsBlocks) return null
          const seen = new Set<string>()
          let tr: Transaction | null = null
          state.doc.descendants((node, pos) => {
            const id = node.attrs?.typesetId as string | undefined
            if (!id) return
            if (!seen.has(id)) {
              seen.add(id)
              return
            }
            tr = tr || state.tr
            tr.setNodeAttribute(pos, 'typesetId', newTypesetId())
            for (const key of NOT_INHERITED[node.type.name] || []) {
              if (key in node.attrs && node.attrs[key] != null) tr.setNodeAttribute(pos, key, node.type.spec.attrs?.[key]?.default ?? null)
            }
          })
          if (tr) (tr as Transaction).setMeta('addToHistory', false).setMeta('typeset', true)
          return tr
        },
      }),
    ]
  },
})

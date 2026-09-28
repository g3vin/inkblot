/**
 * toolbarEdits.js — what a drag in Customize Toolbar does to a layout. Pure.
 *
 * A drag comes from the toolbar itself (by its index there: a spacer can appear more
 * than once, so an item is not its id) or from the palette (by id). It ends inside
 * the toolbar at an insertion index — counted among the items left once the dragged
 * one is lifted out — or outside it.
 */
import { isSpacer } from '../../lib/chromeLayout'

export function applyToolbarDrop(items, { source, inside, index }) {
  if (source.kind === 'toolbar') {
    const moved = items[source.index]
    if (moved === undefined) return items
    const rest = items.filter((_, i) => i !== source.index)
    if (!inside) return rest
    rest.splice(clampIndex(index, rest.length), 0, moved)
    return rest
  }

  if (source.kind === 'defaults') return inside ? [...source.items] : items

  const id = source.id
  if (!inside) return items
  if (isSpacer(id)) {
    const next = [...items]
    next.splice(clampIndex(index, next.length), 0, id)
    return next
  }
  const existing = items.indexOf(id)
  const rest = existing === -1 ? [...items] : items.filter((_, i) => i !== existing)
  rest.splice(clampIndex(index, rest.length), 0, id)
  return rest
}

const clampIndex = (index, length) => Math.max(0, Math.min(Number.isFinite(index) ? index : length, length))

/** Items the palette dims: those already in the toolbar, which can appear only once. */
export const inToolbar = (items, id) => !isSpacer(id) && items.includes(id)

/**
 * mapMenu.js — right-clicking a map.
 *
 * Runs before the editor branch for the same reason canvasMenu does: a map pane has
 * no live text editor, so text commands would have nothing to act on. What the menu
 * offers depends on what is under the pointer — an item (`data-map-item`) gets the
 * item's commands, the open map gets ways to add things there.
 */
import { dispatchMapCommand } from '../../map/mapEvents'

export async function mapMenu(ctx) {
  const { Menu, MenuItem, PredefinedMenuItem, e, fileItem, items } = ctx
  const surface = !fileItem && e.target.closest('.map-surface')
  if (!surface) return false

  const item = e.target.closest('[data-map-item]')
  const run = (command) =>
    dispatchMapCommand(surface, command, {
      clientX: e.clientX,
      clientY: e.clientY,
      itemId: item?.getAttribute('data-map-item') || null,
      itemKind: item?.getAttribute('data-map-kind') || null,
    })

  if (item) {
    const kind = item.getAttribute('data-map-kind')
    if (kind === 'pin') {
      items.push(await MenuItem.new({ text: 'Open Linked Document', action: () => run('open-item') }))
      items.push(await MenuItem.new({ text: 'Link to Document…', action: () => run('link-item') }))
    }
    items.push(
      await MenuItem.new({ text: 'Rename…', action: () => run('rename-item') }),
      await PredefinedMenuItem.new({ item: 'Separator' }),
      await MenuItem.new({ text: 'Delete', action: () => run('delete') }),
    )
  } else {
    items.push(
      await MenuItem.new({ text: 'Add Place Here', action: () => run('add-pin') }),
      await MenuItem.new({ text: 'Add Label Here', action: () => run('add-label') }),
      await PredefinedMenuItem.new({ item: 'Separator' }),
      await MenuItem.new({ text: 'Zoom to Fit', action: () => run('zoom-to-fit') }),
    )
  }

  const menu = await Menu.new({ items })
  await menu.popup()
  return true
}

/**
 * helpMenu.js — "Help: <topic>…" at the foot of a right-click menu, when what was
 * clicked has a help topic (data-help; see lib/help.ts).
 */
import { helpMenuItem } from '../../lib/help'

export async function helpMenu(ctx) {
  const { MenuItem, PredefinedMenuItem, e, items } = ctx
  const help = helpMenuItem(e.target)
  if (!help) return
  if (items.length) items.push(await PredefinedMenuItem.new({ item: 'Separator' }))
  items.push(await MenuItem.new(help))
}

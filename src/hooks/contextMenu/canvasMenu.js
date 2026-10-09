/**
 * canvasMenu.js — right-clicking an infinite-canvas surface.
 *
 * Runs before the editor branch and pops its own menu: a canvas pane has no live
 * editor (the TipTap instances sit idle), so the editor branch would offer text
 * commands with nothing to act on.
 */
import { dispatchCanvasCommand } from '../../canvas/canvasEvents'

export async function canvasMenu(ctx) {
  const {
    Menu,
    MenuItem,
    PredefinedMenuItem,
    e,
    fileItem,
    items,
  } = ctx
  const canvasSurface = !fileItem && e.target.closest('.canvas-surface')
  if (canvasSurface) {
    const onNode = !!e.target.closest('.canvas-node')
    const run = (command) =>
      dispatchCanvasCommand(canvasSurface, command, {
        clientX: e.clientX,
        clientY: e.clientY,
      })

    items.push(
      await MenuItem.new({ text: 'Add card', action: () => run('add-card') }),
      await MenuItem.new({ text: 'Add image…', action: () => run('add-image') }),
      await MenuItem.new({ text: 'Record voice memo', action: () => run('record-memo') }),
      await MenuItem.new({ text: 'Group selection', action: () => run('group') }),
      await MenuItem.new({ text: 'Ungroup', action: () => run('ungroup') })
    )

    if (onNode) {
      items.push(
        await PredefinedMenuItem.new({ item: 'Separator' }),
        await MenuItem.new({ text: 'Bring to front', accelerator: 'CmdOrCtrl+Shift+]', action: () => run('bring-to-front') }),
        await MenuItem.new({ text: 'Send to back', accelerator: 'CmdOrCtrl+Shift+[', action: () => run('send-to-back') }),
        await PredefinedMenuItem.new({ item: 'Separator' }),
        await MenuItem.new({ text: 'Delete', action: () => run('delete') })
      )
    }

    items.push(
      await PredefinedMenuItem.new({ item: 'Separator' }),
      await MenuItem.new({ text: 'Zoom to fit', action: () => run('zoom-to-fit') }),
      await MenuItem.new({ text: 'Toggle read mode', action: () => run('toggle-lock') })
    )

    const canvasMenu = await Menu.new({ items })
    await canvasMenu.popup()
    return true
  }

  return false
}

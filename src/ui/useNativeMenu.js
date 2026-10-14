/**
 * useNativeMenu — pop up a native (Tauri) menu from a plain description, for
 * right-clicks and "…" buttons:
 *
 *   const popUp = useNativeMenu()
 *   popUp(event, [
 *     { text: 'Icon and Text', checked: mode === 'iconAndLabel', action: () => setMode('iconAndLabel') },
 *     { separator: true },
 *     { text: 'More', items: [ … ] },
 *   ])
 *
 * Built the way contextMenu/menuContext.js builds the editor's menus. A right-click
 * on something with a help topic (data-help) gets "Help: …" at the foot. Outside
 * Tauri (tests, a plain browser) it does nothing.
 */
import { useCallback } from 'react'
import { helpMenuItem } from '../lib/help'

export async function buildNativeMenu(items, api) {
  const { Menu, MenuItem, CheckMenuItem, PredefinedMenuItem, Submenu } = api
  const build = async (list) => Promise.all(list.filter(Boolean).map(async (item) => {
    if (item.separator) return PredefinedMenuItem.new({ item: 'Separator' })
    if (item.items) return Submenu.new({ text: item.text, enabled: item.enabled !== false, items: await build(item.items) })
    if (typeof item.checked === 'boolean') {
      return CheckMenuItem.new({ text: item.text, checked: item.checked, enabled: item.enabled !== false, action: item.action })
    }
    return MenuItem.new({ text: item.text, enabled: item.enabled !== false, accelerator: item.accelerator, action: item.action })
  }))
  return Menu.new({ items: await build(items) })
}

export async function popUpNativeMenu(event, items) {
  event?.preventDefault?.()
  event?.stopPropagation?.()
  // A right-click on something with a help topic also offers it, last.
  const help = event?.type === 'contextmenu' ? helpMenuItem(event.target) : null
  const list = help ? [...items, { separator: true }, help] : items
  try {
    const api = await import('@tauri-apps/api/menu')
    const menu = await buildNativeMenu(list, api)
    await menu.popup()
  } catch (error) {
    console.warn('Could not show the menu:', error)
  }
}

export default function useNativeMenu() {
  return useCallback((event, items) => popUpNativeMenu(event, items), [])
}

/**
 * A right-click that nothing else answered, on something with a help topic, gets a
 * menu of just "Help: …". Installed once (App), so a FormRow in a sheet or a section
 * in a panel needs no menu of its own to offer its help.
 */
export function installHelpContextMenu() {
  const onContextMenu = (event) => {
    if (event.defaultPrevented) return
    const help = helpMenuItem(event.target)
    if (!help) return
    void popUpNativeMenu({ preventDefault: () => event.preventDefault(), stopPropagation: () => {}, type: 'fallback', target: event.target }, [help])
    event.preventDefault()
  }
  document.addEventListener('contextmenu', onContextMenu)
  return () => document.removeEventListener('contextmenu', onContextMenu)
}

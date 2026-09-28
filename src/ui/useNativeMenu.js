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
 * Built the way contextMenu/menuContext.js builds the editor's menus. Outside Tauri
 * (tests, a plain browser) it does nothing.
 */
import { useCallback } from 'react'

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
  try {
    const api = await import('@tauri-apps/api/menu')
    const menu = await buildNativeMenu(items, api)
    await menu.popup()
  } catch (error) {
    console.warn('Could not show the menu:', error)
  }
}

export default function useNativeMenu() {
  return useCallback((event, items) => popUpNativeMenu(event, items), [])
}

/**
 * useNativeMenu — menus from a plain description:
 *
 *   popUpMenu(event, [
 *     { text: 'Icon and Text', checked: mode === 'iconAndLabel', action: () => setMode('iconAndLabel') },
 *     { separator: true },
 *     { text: 'More', items: [ … ] },
 *   ])
 *
 * A right-click gets the OS's menu (Tauri), built the way contextMenu/menuContext.js
 * builds the editor's; on something with a help topic (data-help) it ends with "Help: …".
 * A menu a button opens is an in-page `Menu` (MenuFromItems), anchored to that button
 * (docs/DESIGN.md §9 → Pop-ups). Outside Tauri a right-click menu does nothing.
 */
import { createElement, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import { helpMenuItem } from '../lib/help'
import MenuFromItems from './MenuFromItems.jsx'

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

let host = null
let root = null
let opened = 0

/** A button's menu: drawn in the page, under the button (or at the event's point). */
function popUpInPage(event, items) {
  const target = event?.currentTarget instanceof Element ? event.currentTarget : event?.target
  const anchor = target instanceof Element ? target.closest('button, [role="button"]') ?? target : null
  if (!root) {
    host = document.createElement('div')
    host.className = 'ib-menu-host'
    document.body.append(host)
    root = createRoot(host)
  }
  opened += 1
  root.render(createElement(MenuFromItems, {
    key: opened,
    anchor,
    point: { x: event?.clientX ?? 0, y: event?.clientY ?? 0 },
    items,
    onClose: () => root.render(null),
  }))
}

export async function popUpMenu(event, items) {
  event?.preventDefault?.()
  event?.stopPropagation?.()
  const rightClick = event?.type === 'contextmenu' || event?.type === 'fallback'
  if (!rightClick) {
    popUpInPage(event, items.filter(Boolean))
    return
  }
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
  return useCallback((event, items) => popUpMenu(event, items), [])
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
    void popUpMenu({ preventDefault: () => event.preventDefault(), stopPropagation: () => {}, type: 'fallback', target: event.target }, [help])
    event.preventDefault()
  }
  document.addEventListener('contextmenu', onContextMenu)
  return () => document.removeEventListener('contextmenu', onContextMenu)
}

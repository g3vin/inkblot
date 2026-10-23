/**
 * MenuFromItems — a Menu drawn from the same plain description a native menu takes
 * (useNativeMenu.js), so a button's menu is in the page while a right-click's is the OS's
 * (docs/DESIGN.md §9 → Pop-ups). A submenu becomes a labelled group.
 */
import { useMemo } from 'react'
import Menu, { MenuItem, MenuLabel, MenuSeparator } from './Menu.jsx'
import { LayerContext } from './layer'

/** `CmdOrCtrl+Shift+N` → `⌘⇧N`. */
const shortcut = (accelerator) => accelerator
  ?.replace(/(CmdOrCtrl|CommandOrControl|Cmd|Command)\+/g, '⌘')
  .replace(/Shift\+/g, '⇧').replace(/(Alt|Option)\+/g, '⌥').replace(/Ctrl\+/g, '⌃')

function itemsOf(list, path = '') {
  const nodes = list.filter(Boolean).flatMap((item, index) => {
    const key = `${path}${index}`
    if (item.separator) return [<MenuSeparator key={key} />]
    if (item.items) return [<MenuSeparator key={`${key}-`} />, <MenuLabel key={key}>{item.text}</MenuLabel>, ...itemsOf(item.items, `${key}.`)]
    return [
      <MenuItem
        key={key}
        checked={typeof item.checked === 'boolean' ? item.checked : undefined}
        disabled={item.enabled === false}
        shortcut={shortcut(item.accelerator)}
        onSelect={() => item.action?.()}
      >
        {item.text}
      </MenuItem>,
    ]
  })
  while (nodes[0]?.type === MenuSeparator) nodes.shift()
  return nodes
}

export default function MenuFromItems({ anchor, point, items, onClose }) {
  const anchorRef = useMemo(() => ({ current: anchor }), [anchor])
  // Opened from a button in a dialog, it goes in the dialog's layer (layer.js).
  const layer = anchor?.closest?.('.ib-dialog-scrim') ?? null
  return (
    <LayerContext.Provider value={layer}>
      <Menu
        open
        anchorRef={anchor ? anchorRef : undefined}
        point={anchor ? undefined : point}
        onClose={onClose}
        label={anchor?.getAttribute?.('aria-label') || anchor?.textContent?.trim() || 'Menu'}
      >
        {itemsOf(items)}
      </Menu>
    </LayerContext.Provider>
  )
}

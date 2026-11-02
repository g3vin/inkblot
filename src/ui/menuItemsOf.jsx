/**
 * menuItemsOf — the MenuItems for a plain menu description (useNativeMenu.js), for an
 * in-page Menu built around them: MenuFromItems, and MoreMenu's `items`. A submenu
 * becomes a labelled group.
 */
import { MenuItem, MenuLabel, MenuSeparator } from './Menu.jsx'

/** `CmdOrCtrl+Shift+N` → `⌘⇧N`. */
const shortcut = (accelerator) => accelerator
  ?.replace(/(CmdOrCtrl|CommandOrControl|Cmd|Command)\+/g, '⌘')
  .replace(/Shift\+/g, '⇧').replace(/(Alt|Option)\+/g, '⌥').replace(/Ctrl\+/g, '⌃')

export function menuItemsOf(list, path = '') {
  const nodes = list.filter(Boolean).flatMap((item, index) => {
    const key = `${path}${index}`
    if (item.separator) return [<MenuSeparator key={key} />]
    if (item.items) return [<MenuSeparator key={`${key}-`} />, <MenuLabel key={key}>{item.text}</MenuLabel>, ...menuItemsOf(item.items, `${key}.`)]
    return [
      <MenuItem
        key={key}
        checked={typeof item.checked === 'boolean' ? item.checked : undefined}
        disabled={item.enabled === false}
        danger={item.danger}
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


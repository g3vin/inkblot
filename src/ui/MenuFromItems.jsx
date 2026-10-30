/**
 * MenuFromItems — a Menu drawn from the same plain description a native menu takes
 * (useNativeMenu.js), so a button's menu is in the page while a right-click's is the OS's
 * (docs/DESIGN.md §9 → Pop-ups). A submenu becomes a labelled group.
 */
import { useMemo } from 'react'
import Menu from './Menu.jsx'
import { menuItemsOf } from './menuItemsOf.jsx'
import { LayerContext } from './layer'

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
        {menuItemsOf(items)}
      </Menu>
    </LayerContext.Provider>
  )
}

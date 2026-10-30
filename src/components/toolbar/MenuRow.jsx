/**
 * MenuRow — a toolbar button's menu, as a row of its items in the toolbar (docs/DESIGN.md
 * §6 → the dynamic toolbar). It takes the plain list a native menu takes
 * (useNativeMenu.js): a separator or a submenu sets a group apart, with a divider and
 * never a heading; a checked item is pressed. An item with an `icon` is drawn as it,
 * its text its name (unless the toolbar shows text only), and one with a `style` is
 * drawn in it (a font's name in its face). ←/→ and typeahead move between items.
 */
import { useLayoutEffect, useRef } from 'react'
import Icon from '../../ui/Icon.jsx'
import { useRovingFocus } from '../../ui/hooks'

function rowOf(items, onDone, display, path = '') {
  return items.filter(Boolean).flatMap((item, index) => {
    const key = `${path}${index}`
    if (item.separator) return [<span key={key} className="toolbar-group-divider" aria-hidden="true" />]
    if (item.items) {
      return [
        <span key={`${key}-`} className="toolbar-group-divider" aria-hidden="true" />,
        ...rowOf(item.items, onDone, display, `${key}.`),
      ]
    }
    const iconOnly = item.icon && display !== 'label'
    return [
      <button
        key={key}
        type="button"
        className={item.checked ? 'active' : undefined}
        aria-pressed={typeof item.checked === 'boolean' ? item.checked : undefined}
        aria-label={iconOnly ? item.text : undefined}
        title={item.title ?? item.text}
        disabled={item.enabled === false}
        onClick={() => { item.action?.(); if (!item.keepOpen) onDone() }}
      >
        {iconOnly ? <Icon name={item.icon} active={Boolean(item.checked)} /> : <span className="tb-text" style={item.style}>{item.text}</span>}
      </button>,
    ]
  })
}

export default function MenuRow({ label, items, onDone, display = 'icon', className = '' }) {
  const ref = useRef(null)
  const onKeyDown = useRovingFocus(ref, 'button:not([disabled])', { orientation: 'horizontal' })
  const nodes = rowOf(items, onDone, display)
  // A row that scrolls (the fonts) opens on the chosen item. Set by hand: scrollIntoView
  // would scroll the toolbar's own row too.
  useLayoutEffect(() => {
    const row = ref.current
    const chosen = row?.querySelector(':scope > .active')
    if (!row || !chosen || row.scrollWidth <= row.clientWidth) return
    row.scrollLeft = chosen.offsetLeft - (row.clientWidth - chosen.offsetWidth) / 2
  }, [])
  while (nodes[0]?.type === 'span' && nodes[0].props.className === 'toolbar-group-divider') nodes.shift()
  return (
    <div ref={ref} className={`toolbar-group tb-menu-row ${className}`.trim()} role="toolbar" aria-label={label} onKeyDown={onKeyDown}>
      {nodes}
    </div>
  )
}

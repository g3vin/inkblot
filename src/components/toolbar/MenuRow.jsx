/**
 * MenuRow — a toolbar button's menu, as a row of its items in the toolbar (docs/DESIGN.md
 * §6 → the dynamic toolbar). It takes the plain list a native menu takes
 * (useNativeMenu.js): a separator or a submenu sets a group apart, the submenu's name
 * its eyebrow; a checked item is pressed. ←/→ and typeahead move between items.
 */
import { useRef } from 'react'
import { useRovingFocus } from '../../ui/hooks'

function rowOf(items, onDone, path = '') {
  return items.filter(Boolean).flatMap((item, index) => {
    const key = `${path}${index}`
    if (item.separator) return [<span key={key} className="toolbar-group-divider" aria-hidden="true" />]
    if (item.items) {
      return [
        <span key={`${key}-`} className="toolbar-group-divider" aria-hidden="true" />,
        <span key={`${key}-l`} className="ib-eyebrow tb-menu-row-group">{item.text}</span>,
        ...rowOf(item.items, onDone, `${key}.`),
      ]
    }
    return [
      <button
        key={key}
        type="button"
        className={item.checked ? 'active' : undefined}
        aria-pressed={typeof item.checked === 'boolean' ? item.checked : undefined}
        disabled={item.enabled === false}
        onClick={() => { item.action?.(); onDone() }}
      >
        <span className="tb-text">{item.text}</span>
      </button>,
    ]
  })
}

export default function MenuRow({ label, items, onDone }) {
  const ref = useRef(null)
  const onKeyDown = useRovingFocus(ref, 'button:not([disabled])', { orientation: 'horizontal' })
  const nodes = rowOf(items, onDone)
  while (nodes[0]?.type === 'span' && nodes[0].props.className === 'toolbar-group-divider') nodes.shift()
  return (
    <div ref={ref} className="toolbar-group tb-menu-row" role="toolbar" aria-label={label} onKeyDown={onKeyDown}>
      {nodes}
    </div>
  )
}

/**
 * Section — a collapsible group in an inspector panel. Whether it is open is kept per
 * section id under inkblot.inspector.sections, so a panel reopens as it was left.
 *
 * `accessory` sits at the right of the title row: the section's one action (a Button
 * or IconButton), or a short status in `.ib-meta`. It is beside the toggle, not inside
 * it, so it can be a control of its own. `help` names the help topic a right-click on
 * the section offers (lib/help.ts).
 */
import { useCallback, useState } from 'react'
import Icon from './Icon.jsx'
import { readSectionStates, writeSectionState } from './sectionState.js'
import './ui.css'

export default function Section({ id, title, accessory, help, defaultOpen = true, className = '', children }) {
  const [open, setOpen] = useState(() => {
    const stored = id ? readSectionStates()[id] : undefined
    return typeof stored === 'boolean' ? stored : defaultOpen
  })

  const toggle = useCallback(() => {
    setOpen((was) => {
      if (id) writeSectionState(id, !was)
      return !was
    })
  }, [id])

  return (
    <section className={`ui-section ${className}`.trim()} data-open={open} data-section={id} data-help={help}>
      <div className="ui-section-row">
        <button type="button" className="ui-section-header" aria-expanded={open} onClick={toggle}>
          <span className="ui-section-chevron"><Icon name="chevron-down" /></span>
          <span className="ui-section-title">{title}</span>
        </button>
        {accessory ? <div className="ui-section-accessory">{accessory}</div> : null}
      </div>
      {open ? <div className="ui-section-body">{children}</div> : null}
    </section>
  )
}

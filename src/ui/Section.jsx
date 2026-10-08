/**
 * Section — a collapsible group in an inspector panel. Whether it is open is kept per
 * section id under inkblot.inspector.sections, so a panel reopens as it was left.
 */
import { useCallback, useState } from 'react'
import SFIcon from '../components/SFIcon.jsx'
import { readSectionStates, writeSectionState } from './sectionState.js'
import './ui.css'

export default function Section({ id, title, accessory, defaultOpen = true, className = '', children }) {
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
    <section className={`ui-section ${className}`.trim()} data-open={open} data-section={id}>
      <button type="button" className="ui-section-header" aria-expanded={open} onClick={toggle}>
        <span className="ui-section-chevron"><SFIcon name="chevron.down" size={10} /></span>
        <span className="ui-section-title">{title}</span>
        {accessory ? <span className="ui-section-accessory">{accessory}</span> : null}
      </button>
      {open ? <div className="ui-section-body">{children}</div> : null}
    </section>
  )
}

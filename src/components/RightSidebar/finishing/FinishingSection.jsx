/**
 * A Finishing section: collapsible, remembered open or shut (ui/Section), re-read when
 * Expand or Collapse All is chosen, with its note as its last row.
 */
import { useEffect, useState } from 'react'
import Section from '../../../ui/Section'
import { Note } from './controls'

export default function FinishingSection({ id, title, note, accessory, children }) {
  const [generation, setGeneration] = useState(0)
  useEffect(() => {
    const reread = () => setGeneration((g) => g + 1)
    window.addEventListener('inkblot:finishing-sections', reread)
    return () => window.removeEventListener('inkblot:finishing-sections', reread)
  }, [])
  return (
    <Section key={generation} id={id} title={title} accessory={accessory} className="fin-section">
      {children}
      {note ? <Note>{note}</Note> : null}
    </Section>
  )
}

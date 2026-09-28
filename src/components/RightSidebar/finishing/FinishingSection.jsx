/**
 * A Finishing section: collapsible, remembered open or shut (ui/Section), re-read when
 * Expand or Collapse All is chosen, with its note as its last row. Picking a handle on
 * a Typeset page (`typesetFocus`) opens the section it belongs to and scrolls to it.
 */
import { useEffect, useState } from 'react'
import Section from '../../../ui/Section'
import { writeSectionState } from '../../../ui/sectionState'
import { shellBridge } from '../../../bridge'
import { Note } from './controls'

export default function FinishingSection({ id, title, note, accessory, children }) {
  const [generation, setGeneration] = useState(0)
  useEffect(() => {
    const reread = () => setGeneration((g) => g + 1)
    window.addEventListener('inkblot:finishing-sections', reread)
    const unsubscribe = shellBridge.on('typesetFocus', ({ sectionId }) => {
      if (sectionId !== id) return
      writeSectionState(id, true)
      reread()
      requestAnimationFrame(() => {
        document.querySelector(`.fin-section[data-section="${id}"]`)?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
      })
    })
    return () => {
      window.removeEventListener('inkblot:finishing-sections', reread)
      unsubscribe()
    }
  }, [id])
  return (
    <Section key={generation} id={id} title={title} accessory={accessory} className="fin-section">
      {children}
      {note ? <Note>{note}</Note> : null}
    </Section>
  )
}

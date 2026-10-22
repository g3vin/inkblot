/**
 * FontSelect — a family for the page: the project's fonts, a few that print well, then
 * every family installed; the current one kept even when this machine lacks it.
 */
import { useEffect, useState } from 'react'
import { loadSystemFonts, SUGGESTED_FONTS } from '../../../lib/systemFonts'
import { primaryFamily } from './finishingText'

let installedCache = null

export default function FontSelect({ value, onChange, projectFamilies = [], label = 'Font' }) {
  const [installed, setInstalled] = useState(installedCache ?? [])
  useEffect(() => {
    if (installedCache) return undefined
    let alive = true
    loadSystemFonts().then((fonts) => {
      installedCache = fonts
      if (alive) setInstalled(fonts)
    })
    return () => { alive = false }
  }, [])
  const current = primaryFamily(value)
  const known = new Set([...installed, ...projectFamilies])
  const suggested = SUGGESTED_FONTS.filter((font) => known.has(font))
  return (
    <select className="ui-select fin-font" aria-label={label} value={current} onChange={(event) => onChange(event.target.value)}>
      {!known.has(current) && current ? <option value={current}>{current}</option> : null}
      {projectFamilies.length ? <optgroup label="In this project">{projectFamilies.map((f) => <option key={`p-${f}`} value={f}>{f}</option>)}</optgroup> : null}
      {suggested.length ? <optgroup label="Suggested">{suggested.map((f) => <option key={`s-${f}`} value={f} style={{ fontFamily: `"${f}"` }}>{f}</option>)}</optgroup> : null}
      <optgroup label="All fonts">{installed.map((f) => <option key={f} value={f}>{f}</option>)}</optgroup>
    </select>
  )
}

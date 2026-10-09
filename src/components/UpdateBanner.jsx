/**
 * UpdateBanner — after an update, what changed: the version's highlights (what was
 * added, what was fixed) from its GitHub Release, and a link to the whole of it
 * (releaseNotes.ts).
 *
 * It shows on the first launch of a new version and is marked seen as it shows, so it
 * appears once per version whether or not it is dismissed. A first install shows
 * nothing.
 */
import { useEffect, useState } from 'react'
import { Button, IconButton } from '../ui'
import { fetchReleaseNotes, markVersionSeen, updatedVersion } from '../lib/releaseNotes'
import './UpdateBanner.css'

const appVersion = () => import('@tauri-apps/api/app').then(({ getVersion }) => getVersion()).catch(() => null)
const openLink = (url) => import('@tauri-apps/plugin-opener').then(({ openUrl }) => openUrl(url)).catch(() => window.open(url, '_blank'))

function Highlights({ title, items }) {
  if (!items.length) return null
  return (
    <section className="update-banner-group">
      <h3 className="ib-eyebrow">{title}</h3>
      <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>
    </section>
  )
}

export default function UpdateBanner({ getVersion = appVersion, loadNotes = fetchReleaseNotes }) {
  const [notes, setNotes] = useState(null)

  useEffect(() => {
    let live = true
    getVersion().then(async (current) => {
      const version = updatedVersion(current)
      if (!version) return
      const found = await loadNotes(version)
      if (!live) return
      markVersionSeen(version)
      setNotes(found)
    })
    return () => { live = false }
  }, [getVersion, loadNotes])

  if (!notes) return null
  const hasHighlights = notes.added.length > 0 || notes.fixed.length > 0
  return (
    <aside className="update-banner" role="status" aria-label={`Inkblot ${notes.version}`}>
      <div className="update-banner-head">
        <div>
          <p className="ib-eyebrow">Updated to {notes.version}</p>
          <h2 className="ib-title">What’s new in Inkblot</h2>
        </div>
        <IconButton icon="close" label="Dismiss" size="circle" onClick={() => setNotes(null)} />
      </div>
      {hasHighlights ? (
        <>
          <Highlights title="New" items={notes.added} />
          <Highlights title="Fixed" items={notes.fixed} />
        </>
      ) : (
        <p className="ib-body">This version’s notes list everything that changed.</p>
      )}
      <Button variant="tinted" className="update-banner-link" onClick={() => openLink(notes.url)}>See all changes</Button>
    </aside>
  )
}

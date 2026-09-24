/**
 * MapHoverCard.jsx — a glance at the document a pin or traveller links to.
 *
 * The same read-only preview a document card on a canvas shows (useDocPreview), so
 * hovering a town shows the opening of its notes without leaving the map.
 */
import { docPathToFilePath, useDocPreview } from '../canvas/useDocPreview'
import { isMapDoc } from '../lib/docKind'

export default function MapHoverCard({ projectName, docPath, title, missing, x, y }) {
  const preview = useDocPreview(projectName, missing ? null : docPathToFilePath(docPath))
  const left = Math.max(8, x + 16)
  const top = Math.max(8, y - 24)
  let body
  if (missing) body = <p>The document this links to has been deleted. Pick another in the inspector.</p>
  else if (isMapDoc(docPath)) body = <p>Another map — double-click to open it.</p>
  else if (preview.status === 'ready' && preview.html) body = <div dangerouslySetInnerHTML={{ __html: preview.html }} />
  else if (preview.status === 'loading') body = <p>…</p>
  else body = <p>Nothing written yet. Double-click to open it.</p>

  return (
    <div className="map-floating map-hover-card" style={{ left, top }} role="tooltip">
      <h4>{title}</h4>
      <div className="map-hover-card-body">{body}</div>
    </div>
  )
}

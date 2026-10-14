/**
 * SearchPreview.jsx — a look at the document under the search's pointer (or its
 * keyboard selection), beside the search card, as Dia previews a tab.
 *
 * A text document is drawn as static HTML from disk (useDocPreview, the way a document
 * card on a canvas is: no editor). Only documents that are not open are previewed.
 * The first match is marked and scrolled to. A map is drawn small; a canvas or a
 * timeline shows its matching line.
 *
 * It is a picture only (`aria-hidden`, no pointer events): the row is what you act on.
 */
import { useLayoutEffect, useRef } from 'react'
import Icon from '../../ui/Icon.jsx'
import MapThumbnail from '../../map/MapThumbnail'
import { docPathToFilePath, useDocPreview } from '../../canvas/useDocPreview'

const KIND_ICONS = { text: 'document', canvas: 'canvas', map: 'map', timeline: 'timeline' }

const EMPTY_MESSAGES = {
  loading: '',
  missing: 'Document not found',
  unrenderable: 'Preview unavailable',
  ready: 'Empty document',
}

// Wrap the first match in the drawn document in a <mark>, and bring it into view a
// third of the way down, where the eye lands.
const markFirstMatch = (body, matcher) => {
  if (!body || !matcher || matcher.isEmpty || !matcher.valid) return
  const walker = body.ownerDocument.createTreeWalker(body, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const [hit] = matcher.findAll(node.data, 1)
    if (!hit) continue
    const range = body.ownerDocument.createRange()
    range.setStart(node, hit.index)
    range.setEnd(node, hit.index + hit.length)
    const mark = body.ownerDocument.createElement('mark')
    mark.className = 'project-search-hit'
    range.surroundContents(mark)
    body.scrollTop = Math.max(0, mark.offsetTop - body.clientHeight / 3)
    return
  }
}

export default function SearchPreview({ projectName, row, matcher, place }) {
  const { kind } = row
  const { status, html } = useDocPreview(projectName, kind === 'text' ? docPathToFilePath(row.docName) : '')

  const bodyRef = useRef(null)
  useLayoutEffect(() => {
    markFirstMatch(bodyRef.current, matcher)
  }, [html, matcher])

  let body
  if (kind === 'map') {
    body = <div className="project-search-preview-map"><MapThumbnail projectName={projectName} docPath={row.docName} /></div>
  } else if (kind !== 'text') {
    body = <div className="project-search-preview-empty">{row.preview && row.preview !== row.path ? row.preview : null}</div>
  } else if (status === 'ready' && html) {
    // `ProseMirror` gives it the editor's typography, so it looks like the document.
    body = <div ref={bodyRef} className="project-search-preview-body ProseMirror" dangerouslySetInnerHTML={{ __html: html }} />
  } else {
    body = <div className="project-search-preview-empty">{EMPTY_MESSAGES[status] ?? ''}</div>
  }

  return (
    <div className="project-search-preview" style={place} aria-hidden="true">
      <div className="project-search-preview-head">
        <Icon name={KIND_ICONS[kind] || 'file'} />
        <span className="project-search-preview-title">{row.title}</span>
      </div>
      {body}
    </div>
  )
}

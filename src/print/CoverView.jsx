/**
 * CoverView.jsx — the book's cover, in Typeset: its full wrap, drawn to scale.
 *
 * Back, spine and front side by side as the printer takes them, with the bleed around
 * them. Each part takes a picture dropped on it; a picture dropped across the whole
 * wrap is used as one picture for all three. The guides show where the trim falls,
 * the bleed beyond it, where text is safe, the spine's folds and the barcode's box —
 * the app does not design covers, it sizes and checks the author's own.
 */
import { useEffect, useState } from 'react'

import { assetUrl, isAssetPath, writeAssetFromFile } from '../lib/assets'
import { coversOf, withCoverPart } from './chapterDesign'
import { BARCODE_MM, SAFE_MM, SPINE_CLEAR_MM } from './coverWrap'
import { bookSpine, bookWrap } from './coverState'
import { getBookSettings, setBookSettings, setShowingCover, usePrintLayoutStore } from './printLayoutStore'

const PARTS = ['back', 'spine', 'front']
const LABELS = { back: 'Back', spine: 'Spine', front: 'Front', wrap: 'The whole wrap' }

export default function CoverView({ projectName, docPath, folder, setup }) {
  usePrintLayoutStore()
  const book = getBookSettings(projectName, folder)
  const { covers, activeCover } = coversOf(book)
  const set = covers.find((c) => c.id === activeCover) || null
  const { geometry, pageCount } = bookWrap(projectName, docPath, book, book.pageSetup || setup)
  const [guides, setGuides] = useState(true)
  const [over, setOver] = useState(null)
  const [urls, setUrls] = useState({})

  const pathsKey = set ? ['front', 'back', 'spine', 'wrap'].map((p) => set[p]).filter(Boolean).join('\n') : ''
  useEffect(() => {
    let live = true
    const paths = pathsKey ? pathsKey.split('\n') : []
    Promise.all(paths.map(async (path) => [path, isAssetPath(path) ? await assetUrl(projectName, path) : path]))
      .then((pairs) => { if (live) setUrls(Object.fromEntries(pairs)) })
      .catch(() => {})
    return () => { live = false }
  }, [pathsKey, projectName])

  const put = async (part, file) => {
    const image = await writeAssetFromFile(projectName, file)
    let next = withCoverPart(getBookSettings(projectName, folder), part, image)
    if (part === 'spine' || part === 'wrap') {
      const { spineMm } = bookSpine(projectName, docPath, next)
      if (spineMm) next = { ...next, covers: next.covers.map((c) => (c.id === next.activeCover ? { ...c, madeForSpineMm: spineMm } : c)) }
    }
    setBookSettings(projectName, folder, next)
  }

  const onDrop = (part) => async (event) => {
    const file = [...(event.dataTransfer?.files || [])].find((f) => f.type.startsWith('image/'))
    setOver(null)
    if (!file) return
    event.preventDefault()
    // A picture much wider than it is tall is a whole wrap, wherever it was dropped.
    let target = part
    try {
      const bitmap = await createImageBitmap(file)
      if (bitmap.width / bitmap.height > 1.3) target = 'wrap'
      bitmap.close?.()
    } catch {
      // Unreadable here: it goes where it was dropped.
    }
    put(target, file).catch((error) => console.error('[cover] the picture could not be added:', error))
  }
  const onDragOver = (part) => (event) => {
    if (![...(event.dataTransfer?.items || [])].some((i) => i.type.startsWith('image/'))) return
    event.preventDefault()
    setOver(part)
  }

  // The wrap at a scale that fits the pane's width.
  const scale = `calc(min(100cqw - 48px, 1400px) / ${geometry.wrapWidthMm})`
  const mm = (value) => `calc(${scale} * ${value})`
  const b = geometry.bleedMm

  return (
    <div className="cover-view">
      <div className="cover-bar">
        <strong>{set?.name || 'Cover'}</strong>
        <span>
          {geometry.wrapWidthMm.toFixed(1)} × {geometry.wrapHeightMm.toFixed(1)} mm with bleed ·
          spine {pageCount ? `${geometry.spineWidthMm.toFixed(1)} mm for ${pageCount} pages` : 'not sized until the pages are counted'}
        </span>
        <label><input type="checkbox" checked={guides} onChange={(e) => setGuides(e.target.checked)} /> Guides</label>
        <button type="button" onClick={() => setShowingCover(false)}>Back to the Pages</button>
      </div>
      <div className="cover-stage-host">
        <div
          className={`cover-stage${over === 'wrap' ? ' is-over' : ''}`}
          style={{ width: mm(geometry.wrapWidthMm), height: mm(geometry.wrapHeightMm) }}
          onDragOver={onDragOver('wrap')}
          onDragLeave={() => setOver(null)}
          onDrop={onDrop('wrap')}
        >
          {set?.wrap && urls[set.wrap] ? <img className="cover-picture" src={urls[set.wrap]} alt="" style={{ objectFit: set.fit === 'fit' ? 'contain' : set.fit === 'stretch' ? 'fill' : 'cover' }} /> : null}
          {PARTS.map((part) => {
            const at = geometry[part]
            if (part === 'spine' && at.width <= 0) return null
            const src = !set?.wrap && set?.[part] ? urls[set[part]] : null
            return (
              <div
                key={part}
                className={`cover-part is-${part}${over === part ? ' is-over' : ''}${src ? ' has-picture' : ''}`}
                style={{ left: mm(at.x), width: mm(at.width) }}
                onDragOver={(e) => { e.stopPropagation(); onDragOver(part)(e) }}
                onDrop={(e) => { e.stopPropagation(); onDrop(part)(e) }}
              >
                {src ? <img className="cover-picture" src={src} alt="" style={{ objectFit: set.fit === 'fit' ? 'contain' : set.fit === 'stretch' ? 'fill' : 'cover' }} /> : null}
                {!src && !set?.wrap ? <span className="cover-drop">Drop the {LABELS[part].toLowerCase()} here</span> : null}
              </div>
            )
          })}
          {guides ? (
            <div className="cover-guides" aria-hidden="true">
              <div className="cover-trim" style={{ left: mm(b), top: mm(b), right: mm(b), bottom: mm(b) }} />
              <div className="cover-safe" style={{ left: mm(b + SAFE_MM), top: mm(b + SAFE_MM), width: mm(geometry.trimWidthMm - SAFE_MM * 2), bottom: mm(b + SAFE_MM) }} />
              <div className="cover-safe" style={{ left: mm(geometry.front.x + SAFE_MM), top: mm(b + SAFE_MM), width: mm(geometry.trimWidthMm - SAFE_MM * 2), bottom: mm(b + SAFE_MM) }} />
              {geometry.spineWidthMm > 0 ? (
                <>
                  <div className="cover-fold" style={{ left: mm(geometry.spine.x) }} />
                  <div className="cover-fold" style={{ left: mm(geometry.spine.x + geometry.spine.width) }} />
                  <div className="cover-safe is-spine" style={{ left: mm(geometry.spine.x + SPINE_CLEAR_MM), width: mm(Math.max(0, geometry.spine.width - SPINE_CLEAR_MM * 2)), top: mm(b + SAFE_MM), bottom: mm(b + SAFE_MM) }} />
                </>
              ) : null}
              <div className="cover-barcode" style={{ left: mm(geometry.back.x + geometry.back.width - BARCODE_MM.inset - BARCODE_MM.width), bottom: mm(b + BARCODE_MM.inset), width: mm(BARCODE_MM.width), height: mm(BARCODE_MM.height) }}>Barcode</div>
            </div>
          ) : null}
        </div>
      </div>
      <p className="cover-note">
        Drop a picture on the back, the spine or the front. A picture as wide as the whole wrap is used across all three.
        The dashed line is the trim; everything beyond it is bleed, trimmed away. Keep text inside the inner boxes.
      </p>
    </div>
  )
}

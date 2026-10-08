/**
 * coverState.js — a book's covers as the Cover section and the cover view see them:
 * its versions, the size of its wrap, and what a printer would say about them.
 *
 * The wrap's size needs the spine's width, which needs the page count: the book's last
 * count (Publishing › Count), until it is counted again. Each picture's pixel size is
 * read once, from its file, for the resolution checks.
 */
import { joinPath } from '../lib/projectPaths'
import { coversOf } from './chapterDesign'
import { coverChecks, wrapGeometry } from './coverWrap'
import { imageSize, resolveImage } from './export/images'
import { getMeasurement, getPrintScope } from './printLayoutStore'
import { spineWidthMm } from './preflight'
import { normalizePageSetup } from './pageSetup'

const PARTS = ['front', 'back', 'spine', 'wrap']
const sizes = new Map()

/** A cover picture's pixel size: known, loading (undefined), or unreadable (null). */
export const pictureSize = (path) => sizes.get(path)

/** Read the sizes of a book's cover pictures not read yet. Resolves true when any was. */
export const loadCoverSizes = async (projectName, book) => {
  let read = false
  for (const set of coversOf(book).covers) {
    for (const part of PARTS) {
      const path = set[part]
      if (!path || sizes.has(path)) continue
      sizes.set(path, undefined)
      const image = await resolveImage(projectName, path).catch(() => null)
      sizes.set(path, image ? imageSize(image) : null)
      read = true
    }
  }
  return read
}

/** The book's page count as last counted, and the spine it makes. */
export const bookSpine = (projectName, docPath, book) => {
  const scope = getPrintScope(projectName) === 'project' ? 'project' : 'folder'
  const pageCount = getMeasurement(projectName, scope, docPath)?.pageCount || 0
  const target = book?.publishing || { service: 'none', paper: 'cream' }
  const service = target.service === 'none' ? 'kdp' : target.service
  return { pageCount, spineMm: pageCount ? Math.round(spineWidthMm({ pageCount, paper: target.paper, service }) * 100) / 100 : 0 }
}

/** The wrap for a book at a setup: its trim, and the spine it has now. */
export const bookWrap = (projectName, docPath, book, setup) => {
  const s = normalizePageSetup(setup)
  const landscape = s.orientation === 'landscape'
  const { pageCount, spineMm } = bookSpine(projectName, docPath, book)
  return {
    pageCount,
    geometry: wrapGeometry(landscape ? s.heightMm : s.widthMm, landscape ? s.widthMm : s.heightMm, spineMm),
  }
}

/** Everything the shell draws of a book's covers. */
export const buildCoverState = ({ projectName, docPath, book, setup, projectRoot, showing }) => {
  const { covers, activeCover } = coversOf(book)
  const { geometry, pageCount } = bookWrap(projectName, docPath, book, book.pageSetup || setup)
  const file = (path) => (path && projectRoot && !path.startsWith('data:') ? joinPath(projectRoot, path) : undefined)
  const active = covers.find((c) => c.id === activeCover) || null
  const known = Object.fromEntries(PARTS.map((part) => [part, active?.[part] ? sizes.get(active[part]) || null : null]))
  return {
    sets: covers.map((c) => ({
      id: c.id,
      name: c.name,
      frontFile: file(c.front),
      backFile: file(c.back),
      spineFile: file(c.spine),
      wrapFile: file(c.wrap),
      fit: c.fit || 'fill',
    })),
    active: activeCover,
    trimWidthMm: geometry.trimWidthMm,
    trimHeightMm: geometry.trimHeightMm,
    spineWidthMm: geometry.spineWidthMm,
    bleedMm: geometry.bleedMm,
    wrapWidthMm: Math.round(geometry.wrapWidthMm * 100) / 100,
    wrapHeightMm: Math.round(geometry.wrapHeightMm * 100) / 100,
    pageCount,
    checks: coverChecks({ set: active, geometry, pageCount, sizes: known }),
    showing: Boolean(showing),
  }
}

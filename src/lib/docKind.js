/**
 * docKind.js — which kind of document a tree path refers to.
 *
 * Canvases live on disk as `<name>.canvas.json`, so their tree path is
 * `Folder/name.canvas`; maps likewise as `<name>.map.json` → `Folder/name.map`.
 * Every path→file mapping in FileSystem.js appends
 * `.json` to the tree path, so canvases travel through save/load/rename/move/
 * delete unchanged, and the document kind is a pure function of the path —
 * no file read required.
 *
 * The kind is deliberately NOT read from a `type` field inside the file:
 * saveDocument() whitelists the keys it writes, so any such field would be
 * silently dropped.
 */

export const CANVAS_SUFFIX = '.canvas'
export const MAP_SUFFIX = '.map'

/** The suffix each structured kind carries; a text document carries none. */
const KIND_SUFFIX = { canvas: CANVAS_SUFFIX, map: MAP_SUFFIX }

/** 'canvas' | 'map' | 'text' for a document tree path. */
export const getDocKind = (path) => {
  const value = String(path || '')
  if (value.endsWith(CANVAS_SUFFIX)) return 'canvas'
  if (value.endsWith(MAP_SUFFIX)) return 'map'
  return 'text'
}

export const isCanvasDoc = (path) => getDocKind(path) === 'canvas'

export const isMapDoc = (path) => getDocKind(path) === 'map'

/**
 * A rich-text document — the only kind that goes through `saveDocument`, the
 * text autosave, print, references and word counts. Anything else (a canvas,
 * a map) is a structured document with its own loader and writer.
 */
export const isTextDoc = (path) => getDocKind(path) === 'text'

export const withCanvasSuffix = (name) => {
  const value = String(name || '')
  return isCanvasDoc(value) ? value : `${value}${CANVAS_SUFFIX}`
}

export const stripCanvasSuffix = (name) => {
  const value = String(name || '')
  return isCanvasDoc(value) ? value.slice(0, -CANVAS_SUFFIX.length) : value
}

/** `name` with the suffix `kind` needs, left alone when it already has it. */
export const withDocSuffix = (name, kind) => {
  const value = String(name || '')
  const suffix = KIND_SUFFIX[kind]
  if (!suffix || value.endsWith(suffix)) return value
  return `${value}${suffix}`
}

/** `name` with whichever kind suffix it carries removed. */
export const stripDocSuffix = (name) => {
  const value = String(name || '')
  const suffix = KIND_SUFFIX[getDocKind(value)]
  return suffix ? value.slice(0, -suffix.length) : value
}

/** Last path segment, with any kind suffix stripped — what the UI shows. */
export const getDocDisplayName = (path) => {
  const segments = String(path || '').split('/').filter(Boolean)
  return stripDocSuffix(segments[segments.length - 1] || '')
}

/**
 * docKind.js — which kind of document a tree path refers to.
 *
 * Canvases live on disk as `<name>.canvas.json`, so their tree path is
 * `Folder/name.canvas`. Every path→file mapping in FileSystem.js appends
 * `.json` to the tree path, so canvases travel through save/load/rename/move/
 * delete unchanged, and the document kind is a pure function of the path —
 * no file read required.
 *
 * The kind is deliberately NOT read from a `type` field inside the file:
 * saveDocument() whitelists the keys it writes, so any such field is unreliable
 * (FileTree has been writing a `type: 'doc'` that gets silently dropped).
 */

export const CANVAS_SUFFIX = '.canvas'

/** 'canvas' | 'text' for a document tree path. */
export const getDocKind = (path) =>
  String(path || '').endsWith(CANVAS_SUFFIX) ? 'canvas' : 'text'

export const isCanvasDoc = (path) => getDocKind(path) === 'canvas'

export const withCanvasSuffix = (name) => {
  const value = String(name || '')
  return isCanvasDoc(value) ? value : `${value}${CANVAS_SUFFIX}`
}

export const stripCanvasSuffix = (name) => {
  const value = String(name || '')
  return isCanvasDoc(value) ? value.slice(0, -CANVAS_SUFFIX.length) : value
}

/** Last path segment, with the `.canvas` suffix stripped — what the UI shows. */
export const getDocDisplayName = (path) => {
  const segments = String(path || '').split('/').filter(Boolean)
  return stripCanvasSuffix(segments[segments.length - 1] || '')
}

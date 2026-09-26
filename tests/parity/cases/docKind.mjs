/**
 * docKind.js against `inkblot_core::doc_kind`.
 *
 * The corpus leans on the awkward inputs rather than the obvious ones: the suffix in
 * the middle of a name, a path that is nothing but the suffix, empty segments, and
 * the falsy non-strings the JS functions coerce with `String(x || '')`.
 */
import {
  getDocKind,
  isCanvasDoc,
  withCanvasSuffix,
  stripCanvasSuffix,
  getDocDisplayName,
  isMapDoc,
  isTimelineDoc,
  isTextDoc,
  withDocSuffix,
  stripDocSuffix,
} from '../../../src/lib/docKind.js'

const PATHS = [
  '',
  'board',
  'board.canvas',
  '.canvas',
  '..canvas',
  'board.canvas.backup',
  'board.Canvas',
  'Folder/board.canvas',
  'Folder/Sub/board',
  'Folder//board.canvas',
  '/leading/board.canvas',
  'trailing/',
  'trailing/.canvas',
  'a/b/c/d/e.canvas',
  'spaces in the name.canvas',
  'émigré.canvas',
  '日本語のボード.canvas',
  'emoji 🎨 board.canvas',
  'canvas',
  'canvas.canvas.canvas',
  // Falsy and non-string, which `String(path || '')` flattens to ''.
  null,
  0,
  false,
  true,
  7,
  'multi\nline.canvas',
  'World/Aria.map',
  '.map',
  'map',
  'a.map.canvas',
  'x.canvas.map',
  'Treasure.Map',
  'atlas.map.backup',
  'Lands 🗺️.map',
  'Plot/Main.timeline',
  '.timeline',
  'timeline',
  'x.map.timeline',
  'x.timeline.map',
  'Main.timeline.old',
]

const FUNCTIONS = {
  getDocKind,
  isCanvasDoc,
  withCanvasSuffix,
  stripCanvasSuffix,
  getDocDisplayName,
  isMapDoc,
  isTimelineDoc,
  isTextDoc,
  stripDocSuffix,
}

export default {
  name: 'docKind',
  *cases() {
    for (const [name, fn] of Object.entries(FUNCTIONS)) {
      for (const path of PATHS) {
        yield { fn: name, args: [path], expected: fn(path) }
      }
    }
    for (const path of PATHS) {
      for (const kind of ['canvas', 'map', 'timeline', 'text', 'folder', undefined]) {
        yield { fn: 'withDocSuffix', args: [path, kind ?? null], expected: withDocSuffix(path, kind) }
      }
    }
  },
}

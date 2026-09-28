/**
 * SFIcon.jsx — legacy adapter: SF-Symbols-style names → src/ui/Icon.
 *
 * Kept so the ~100 existing call sites keep working while surfaces migrate. New code
 * imports `Icon` from src/ui and uses its semantic names; when the last SFIcon call
 * site is gone, delete this file (docs/DESIGN.md → Migration).
 */
import Icon from '../ui/Icon.jsx'

/** SF-style name (without `.fill`) → semantic Icon name. */
const SF_TO_ICON = {
  'arrow.down.to.dot': 'merge',
  'arrow.left.arrow.right': 'move-left-right',
  'arrow.up.from.dot': 'split',
  'arrow.uturn.backward': 'undo',
  'arrow.uturn.forward': 'redo',
  bold: 'bold',
  calendar: 'calendar',
  canvas: 'canvas',
  checkmark: 'check',
  'chevron.down': 'chevron-down',
  'chevron.left': 'chevron-left',
  clock: 'clock',
  cursorarrow: 'cursor',
  doc: 'file',
  'doc.characters': 'characters',
  'doc.novel': 'notebook',
  'doc.on.clipboard': 'clipboard',
  'doc.on.doc': 'copy',
  'doc.outline': 'list-bullets',
  'doc.settings': 'map-pin',
  'doc.text': 'document',
  ellipsis: 'more',
  'exclamationmark.triangle': 'warning',
  'figure.walk': 'walk',
  folder: 'folder',
  'folder.characters': 'users',
  'folder.novel': 'book',
  'folder.outline': 'list',
  'folder.settings': 'map-world',
  frame: 'frame',
  gauge: 'gauge',
  gear: 'settings',
  gearshape: 'settings',
  'git.pullrequest': 'compare',
  globe: 'globe',
  guides: 'guides',
  hammer: 'hammer',
  italic: 'italic',
  'line.3.horizontal.decrease.circle': 'filter',
  lock: 'lock',
  'lock.open': 'unlock',
  magnifyingglass: 'search',
  'magnifyingglass.circle': 'search',
  map: 'map',
  'map.area': 'map-area',
  'map.calibrate': 'crosshair',
  'map.fit': 'fit',
  'map.label': 'label',
  'map.region': 'map-area',
  'map.route': 'map-route',
  'map.ruler': 'ruler',
  'map.system': 'orbit',
  'map.trace': 'map-trace',
  mappin: 'map-pin',
  mic: 'dictate',
  minus: 'minus',
  paintpalette: 'palette',
  pause: 'pause',
  photo: 'image',
  pin: 'pin',
  play: 'play',
  plus: 'add',
  'read.aloud': 'read-aloud',
  'rectangle.dashed': 'ungroup',
  'rectangle.on.rectangle': 'group',
  speech: 'chat',
  'square.and.arrow.down': 'download',
  strikethrough: 'strikethrough',
  'sun.max': 'sun',
  'table.grid': 'table',
  'text.aligncenter': 'align-center',
  'text.alignleft': 'align-left',
  'text.alignright': 'align-right',
  trash: 'delete',
  underline: 'underline',
  xmark: 'close',
}

export default function SFIcon({ name, filled = false, className = '', title, size = 16 }) {
  const isFillVariant = /\.fill$/.test(name)
  const semantic = SF_TO_ICON[name.replace(/\.fill$/, '')] || 'search'
  return (
    <span className="sf-icon" aria-hidden="true" title={title}>
      <Icon name={semantic} size={size} active={filled || isFillVariant} className={className || undefined} />
    </span>
  )
}

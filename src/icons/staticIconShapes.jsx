/**
 * staticIconShapes.jsx — the SF-Symbol names the chrome uses that have no animated icon.
 * Lucide-style strokes on a 24-unit grid, drawn with currentColor. SFIcon falls back
 * to these before its generic default.
 */

const path_ = (d) => <path d={d} />
const line_ = (x1, y1, x2, y2) => <line x1={x1} y1={y1} x2={x2} y2={y2} />
const rect_ = (x, y, width, height, rx = 2) => <rect x={x} y={y} width={width} height={height} rx={rx} />
const circle_ = (cx, cy, r) => <circle cx={cx} cy={cy} r={r} />

export const STATIC_ICONS = {
  textformat: <>{path_('M4 18 9 6l5 12')}{line_(5.6, 14, 12.4, 14)}{path_('M15 18v-5.5a2.5 2.5 0 0 1 5 0V18')}{line_(15, 15, 20, 15)}</>,
  'textformat.size': <>{path_('M3 18 8 5l5 13')}{line_(4.6, 14, 11.4, 14)}{path_('M15 18l3-8 3 8')}{line_(16, 15.5, 20, 15.5)}</>,
  'textformat.alt': <>{path_('M4 7V5h16v2')}{line_(12, 5, 12, 19)}{line_(9, 19, 15, 19)}</>,
  'text.quote': <>{path_('M17 6H3')}{path_('M21 12H8')}{path_('M21 18H8')}{path_('M3 12v6')}</>,
  'bold.italic.underline': <>{path_('M5 4h4a3 3 0 0 1 0 6H5z')}{path_('M5 10h5a3 3 0 0 1 0 6H5z')}{line_(19, 4, 14, 4)}{line_(16.5, 4, 14, 16)}{line_(4, 20, 20, 20)}</>,
  character: <>{path_('M5 20 12 4l7 16')}{line_(7.8, 14, 16.2, 14)}</>,
  highlighter: <>{path_('m9 11-6 6v3h9l3-3')}{path_('m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4')}</>,
  paragraphsign: <>{path_('M13 4v16')}{path_('M17 4v16')}{path_('M19 4H9.5a4.5 4.5 0 0 0 0 9H13')}</>,
  'list.bullet': <>{line_(8, 6, 21, 6)}{line_(8, 12, 21, 12)}{line_(8, 18, 21, 18)}{circle_(3.5, 6, 0.6)}{circle_(3.5, 12, 0.6)}{circle_(3.5, 18, 0.6)}</>,
  'list.number': <>{line_(10, 6, 21, 6)}{line_(10, 12, 21, 12)}{line_(10, 18, 21, 18)}{path_('M4 6h1v4')}{path_('M4 10h2')}{path_('M6 18H4c0-1 2-2 2-3s-1-1.5-2-1')}</>,
  scope: <>{circle_(12, 12, 8)}{circle_(12, 12, 3)}{line_(12, 2, 12, 5)}{line_(12, 19, 12, 22)}{line_(2, 12, 5, 12)}{line_(19, 12, 22, 12)}</>,
  number: <>{line_(4, 9, 20, 9)}{line_(4, 15, 20, 15)}{line_(10, 3, 8, 21)}{line_(16, 3, 14, 21)}</>,
  'note.text': <>{path_('M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z')}{path_('M14 3v6h6')}{line_(8, 13, 16, 13)}{line_(8, 17, 13, 17)}</>,
  'books.vertical': <>{rect_(3, 4, 5, 16, 1)}{rect_(9, 4, 5, 16, 1)}{path_('m15.5 5.2 4.3-1.1 3.6 15.5-4.3 1.1z')}</>,
  'chart.bar.xaxis': <>{line_(3, 20, 21, 20)}{rect_(5, 12, 3, 6, 0.5)}{rect_(10.5, 6, 3, 12, 0.5)}{rect_(16, 9, 3, 9, 0.5)}</>,
  timer: <>{line_(10, 2, 14, 2)}{line_(12, 14, 15, 11)}{circle_(12, 14, 8)}</>,
  'plus.square.on.square': <>{rect_(8, 8, 13, 13)}{path_('M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2')}{line_(14.5, 11.5, 14.5, 17.5)}{line_(11.5, 14.5, 17.5, 14.5)}</>,
  'rectangle.split.2x1': <>{rect_(3, 4, 18, 16)}{line_(12, 4, 12, 20)}</>,
  'rectangle.split.1x2': <>{rect_(3, 4, 18, 16)}{line_(3, 12, 21, 12)}</>,
  rectangle: <>{rect_(3, 4, 18, 16)}</>,
  'pencil.line': <>{path_('M13 21h8')}{path_('m15 5 4 4')}{path_('M21.2 6.8a2.8 2.8 0 0 0-4-4L4 16l-1 5 5-1z')}</>,
  'book.pages': <>{path_('M4 19.5V5a2 2 0 0 1 2-2h12v18H6.5a2.5 2.5 0 0 1 0-5H18')}{line_(8, 7, 14, 7)}{line_(8, 11, 14, 11)}</>,
  book: <>{path_('M2 5h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2z')}{path_('M22 5h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7z')}</>,
  'checkmark.seal': <>{path_('M12 2.5 14.4 4l2.8-.1 1.1 2.6 2.4 1.5-.6 2.8L21.5 12l-1.4 2.2.6 2.8-2.4 1.5-1.1 2.6-2.8-.1L12 21.5 9.6 20l-2.8.1-1.1-2.6-2.4-1.5.6-2.8L2.5 12l1.4-2.2-.6-2.8 2.4-1.5 1.1-2.6 2.8.1z')}{path_('m8.5 12 2.5 2.5 4.5-5')}</>,
  'line.3.horizontal': <>{line_(4, 7, 20, 7)}{line_(4, 12, 20, 12)}{line_(4, 17, 20, 17)}</>,
  'arrow.right.and.line.vertical.and.arrow.left': <>{line_(12, 4, 12, 20)}{path_('M3 12h6')}{path_('m6 9 3 3-3 3')}{path_('M21 12h-6')}{path_('m18 9-3 3 3 3')}</>,
  'arrow.left.and.line.vertical.and.arrow.right': <>{line_(12, 4, 12, 20)}{path_('M9 12H3')}{path_('m6 9-3 3 3 3')}{path_('M15 12h6')}{path_('m18 9 3 3-3 3')}</>,
  'rectangle.compress.vertical': <>{rect_(4, 9, 16, 6)}{path_('M12 2v4')}{path_('m9 4 3 2 3-2')}{path_('M12 22v-4')}{path_('m9 20 3-2 3 2')}</>,
  printer: <>{path_('M6 9V3h12v6')}{rect_(3, 9, 18, 8)}{rect_(7, 14, 10, 7, 1)}</>,
  'square.and.arrow.up': <>{path_('M8 10H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-2')}{line_(12, 3, 12, 15)}{path_('m8 7 4-4 4 4')}</>,
  'ipad.and.iphone': <>{rect_(2, 3, 14, 18)}{rect_(15, 9, 7, 12, 1.5)}</>,
  'sidebar.right': <>{rect_(3, 4, 18, 16)}{line_(15, 4, 15, 20)}</>,
  'sidebar.left': <>{rect_(3, 4, 18, 16)}{line_(9, 4, 9, 20)}</>,
  'chevron.right': <>{path_('m9 6 6 6-6 6')}</>,
  'plus.magnifyingglass': <>{circle_(11, 11, 7)}{line_(21, 21, 16, 16)}{line_(11, 8, 11, 14)}{line_(8, 11, 14, 11)}</>,
  'minus.magnifyingglass': <>{circle_(11, 11, 7)}{line_(21, 21, 16, 16)}{line_(8, 11, 14, 11)}</>,
  'arrow.up.left.and.arrow.down.right': <>{path_('M15 3h6v6')}{path_('M9 21H3v-6')}{line_(21, 3, 14, 10)}{line_(3, 21, 10, 14)}</>,
  'square.grid.2x2': <>{rect_(3, 3, 7, 7, 1)}{rect_(14, 3, 7, 7, 1)}{rect_(3, 14, 7, 7, 1)}{rect_(14, 14, 7, 7, 1)}</>,
  flame: <>{path_('M12 22c4 0 7-3 7-7 0-3-2-6-4-8 0 3-2 4-3 4 0-3-1-6-4-8 0 4-3 6-3 12 0 4 3 7 7 7z')}</>,
  target: <>{circle_(12, 12, 9)}{circle_(12, 12, 5)}{circle_(12, 12, 1)}</>,
  bell: <>{path_('M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9')}{path_('M10.3 21a1.9 1.9 0 0 0 3.4 0')}</>,
  'person.crop.circle': <>{circle_(12, 12, 9)}{circle_(12, 10, 3)}{path_('M6.2 18.2a7 7 0 0 1 11.6 0')}</>,
  link: <>{path_('M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7')}{path_('M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7')}</>,
  'quote.bubble': <>{path_('M21 12a8 8 0 0 1-11.8 7L3 21l2-6.2A8 8 0 1 1 21 12z')}{path_('M9 10h.01')}{path_('M13 10h.01')}</>,
  'arrow.clockwise': <>{path_('M21 12a9 9 0 1 1-3-6.7L21 8')}{path_('M21 3v5h-5')}</>,
  'doc.badge.plus': <>{path_('M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7')}{path_('M14 3v6h6v4')}{line_(18, 16, 18, 22)}{line_(15, 19, 21, 19)}</>,
  photo_frame: <>{rect_(3, 3, 18, 18)}{circle_(9, 9, 2)}{path_('m21 15-5-5L5 21')}</>,
  bookmark: <>{path_('M6 3h12v18l-6-4-6 4z')}</>,
  'character.cursor.ibeam': <>{path_('M3 19 7.5 7l4.5 12')}{line_(4.6, 15, 10.4, 15)}{line_(17, 4, 17, 20)}{path_('M15 4h4')}{path_('M15 20h4')}</>,
  'plus.forwardslash.minus': <>{line_(3, 7, 9, 7)}{line_(6, 4, 6, 10)}{line_(17, 4, 7, 20)}{line_(15, 17, 21, 17)}</>,
  keyboard: <>{rect_(2, 6, 20, 12)}{path_('M6 10h.01')}{path_('M10 10h.01')}{path_('M14 10h.01')}{path_('M18 10h.01')}{line_(7, 14, 17, 14)}</>,
  'forward.end': <>{path_('M5 5l10 7-10 7z')}{line_(19, 5, 19, 19)}</>,
  stop: <>{rect_(5, 5, 14, 14, 2)}</>,
  'moon.zzz': <>{path_('M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z')}{path_('M15 3h4l-4 4h4')}</>,
  'cup.and.saucer': <>{path_('M5 8h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z')}{path_('M16 9h1.5a2.5 2.5 0 0 1 0 5H16')}{line_(3, 21, 19, 21)}</>,
  pencil: <>{path_('m15 5 4 4')}{path_('M21.2 6.8a2.8 2.8 0 0 0-4-4L4 16l-1 5 5-1z')}</>,
  'arrow.up.right': <>{line_(7, 17, 17, 7)}{path_('M8 7h9v9')}</>,
  'arrow.down.right': <>{line_(7, 7, 17, 17)}{path_('M17 8v9H8')}</>,
  'chart.line.downtrend.xyaxis': <>{path_('M3 3v18h18')}{path_('m7 8 4 5 3-2 5 6')}</>,
  'plusminus.circle': <>{circle_(12, 12, 9)}{line_(8, 9.5, 12, 9.5)}{line_(10, 7.5, 10, 11.5)}{line_(12, 15, 16, 15)}</>,
  'eye.slash': <>{path_('M9.9 5.1A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2')}{path_('M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a10 10 0 0 0 5.4-1.6')}{path_('M14.1 14.2a3 3 0 0 1-4.2-4.3')}{line_(2, 2, 22, 22)}</>,
  'eye': <>{path_('M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z')}{circle_(12, 12, 3)}</>,
}

export const hasStaticIcon = (name) => Object.prototype.hasOwnProperty.call(STATIC_ICONS, name)

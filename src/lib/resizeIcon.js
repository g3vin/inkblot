/**
 * resizeIcon.js — plain-DOM SVG icon builders for TipTap node views
 * (which build DOM directly and can't use React components): the corner
 * resize grip, crop-frame icon, and flip arrows.
 */
export const RESIZE_ICON_PATHS = [
  'M7 17V7h10',
  'M17 17 7 7',
  'M7 7 17 17',
  'M17 7v10H7',
]

const SVG_NS = 'http://www.w3.org/2000/svg'

export const ICON_FRAME_LINES = [
  { x1: 22, x2: 2, y1: 6, y2: 6 },
  { x1: 22, x2: 2, y1: 18, y2: 18 },
  { x1: 6, x2: 6, y1: 2, y2: 22 },
  { x1: 18, x2: 18, y1: 2, y2: 22 },
]

export const ICON_ARROW_RIGHT_LEFT_PATHS = [
  'm16 3 4 4-4 4',
  'M20 7H4',
  'm8 21-4-4 4-4',
  'M4 17h16',
]

export const ICON_ARROW_UP_DOWN_PATHS = [
  'm21 16-4 4-4-4',
  'M17 20V4',
  'm3 8 4-4 4 4',
  'M7 4v16',
]

const createBaseIconElement = (size) => {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('xmlns', SVG_NS)
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  return svg
}

export const createSvgIconElement = (paths, size = 16, className = '') => {
  const svg = createBaseIconElement(size)
  if (className) svg.classList.add(...className.split(' ').filter(Boolean))

  paths.forEach((d) => {
    const path = document.createElementNS(SVG_NS, 'path')
    path.setAttribute('d', d)
    svg.appendChild(path)
  })

  return svg
}

export const createFrameIconElement = (size = 16) => {
  const svg = createBaseIconElement(size)
  svg.classList.add('image-tool-icon', 'image-tool-icon-frame')

  ICON_FRAME_LINES.forEach((attrs) => {
    const line = document.createElementNS(SVG_NS, 'line')
    Object.entries(attrs).forEach(([key, value]) => {
      line.setAttribute(key, String(value))
    })
    svg.appendChild(line)
  })

  return svg
}

export const createResizeIconElement = (size = 14) => {
  const svg = createBaseIconElement(size)
  svg.classList.add('resize-corner-icon')

  RESIZE_ICON_PATHS.forEach((d) => {
    const path = document.createElementNS(SVG_NS, 'path')
    path.setAttribute('d', d)
    svg.appendChild(path)
  })

  return svg
}

/**
 * mapExport.js — a map as a picture: SVG, PNG, PDF, or on paper.
 *
 * Everything starts as one standalone SVG built from the same MapLayers the editor
 * draws, so an export is what was on screen. Standalone means it carries its own
 * styles (the world rules of Map.css, with the theme's colours read off the live map
 * and written in), the Earth's outlines already projected, and pictures inlined as
 * data URIs — nothing it points at can be missing, and a canvas drawing it for a PNG
 * is never tainted. The compass, scale bar and title are redrawn in SVG in the
 * places they sit on screen.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import mapCss from './Map.css?raw'
import MapLayers, { MapDefs } from './MapLayers'
import { CompassRose, MapKey } from './mapGlyphs'
import { NO_NORTH, scaleBarFor } from './mapChromeMath'
import { legendEntries } from './mapLegend'
import { assetUrl } from '../lib/assets'
import { projectedEarth } from '../lib/map/earthData'
import { earthLevelFor } from './mapRender'

/** The theme's custom properties, as the live map has them resolved. */
const THEME_VARIABLES = [
  '--map-paper', '--map-sheet', '--map-ink', '--map-ink-soft', '--map-land', '--map-land-edge', '--map-water',
  '--map-border', '--map-grid', '--map-route', '--map-pin', '--map-region', '--map-accent', '--map-label-font',
]

/** Map.css's rules for what is drawn in the world (not the panels and toolbars). */
const worldCss = () =>
  mapCss
    .split('/* ---------------- screen chrome ---------------- */')[0]
    .split('/* ---------------- world content ---------------- */')[1] || ''

async function dataUrlFor(projectName, relativePath) {
  if (!relativePath) return null
  try {
    const response = await fetch(await assetUrl(projectName, relativePath))
    const blob = await response.blob()
    return await new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

const escapeXml = (text) => String(text).replace(/[<>&"]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[char])

/**
 * The map as an SVG string. `frame` is what to show — `'view'` (the visible part,
 * given the view's `viewport` and pixel `viewSize`) or `'all'` (the whole sheet, world
 * or system) — and `scale` multiplies the pixel size. A globe or a 3D view passes
 * its own picture as `backdrop` (a data URL), drawn under the places and labels.
 */
export async function buildMapSvg({
  map, projector, space, day, schedules, projectName, surface, viewport, viewSize, frame = 'view', scale = 1, backdrop = null,
}) {
  let rect
  if (frame === 'all') rect = projector.bounds
  else {
    rect = { x: viewport.x, y: viewport.y, width: viewSize.width / viewport.zoom, height: viewSize.height / viewport.zoom }
  }
  // The whole map comes out 2400 px on its long side (times `scale`); a view, at its zoom.
  const zoom = frame === 'all' ? 2400 / Math.max(rect.width, rect.height) : viewport.zoom
  const pixelWidth = Math.round(rect.width * zoom * scale)
  const pixelHeight = Math.round(rect.height * zoom * scale)
  const drawnZoom = zoom * scale

  const computed = surface ? getComputedStyle(surface) : null
  const variables = THEME_VARIABLES.map((name) => `${name}:${computed?.getPropertyValue(name).trim() || 'initial'};`).join('')
  const inlineAssets = map.mapKind === 'image' || map.mapKind === 'blank'
    ? { image: await dataUrlFor(projectName, map.background.image), trace: await dataUrlFor(projectName, map.background.trace) }
    : null
  const earthPaths = map.mapKind === 'earth' ? await projectedEarth(projector, earthLevelFor(map.earth, drawnZoom)) : null

  const layers = renderToStaticMarkup(
    createElement(
      'g',
      null,
      createElement(MapDefs, { idPrefix: 'export' }),
      createElement(MapLayers, {
        map, projector, space, day, zoom: drawnZoom, schedules, projectName, idPrefix: 'export', inlineAssets, earthPaths,
        earthLevel: earthLevelFor(map.earth, drawnZoom),
      })
    )
  )

  // Screen furniture, where it sits on screen, in the exported pixels.
  const chrome = []
  const at = (fraction) => [fraction[0] * pixelWidth, fraction[1] * pixelHeight]
  const { style } = map
  if (style.legend.show) {
    const entries = legendEntries(map, day)
    if (entries.length) {
      const [x, y] = at(style.legend.at)
      chrome.push(`<g transform="translate(${x} ${y}) scale(${scale})">${renderToStaticMarkup(createElement(MapKey, { entries }))}</g>`)
    }
  }
  if (style.compass.show && !NO_NORTH.has(map.mapKind)) {
    const [x, y] = at(style.compass.at)
    const size = style.compass.size * scale
    chrome.push(`<g transform="translate(${x - size / 2} ${y - size / 2})" style="color:var(--map-ink)">${renderToStaticMarkup(createElement(CompassRose, { size, variant: style.compass.style }))}</g>`)
  }
  if (style.scaleBar.show) {
    const bar = scaleBarFor(map, projector, space, { x: rect.x, y: rect.y, zoom: drawnZoom }, pixelWidth, pixelHeight)
    if (bar) {
      const [x, y] = at(style.scaleBar.at)
      chrome.push(
        `<g transform="translate(${x} ${y - 8})" fill="var(--map-ink)" stroke="var(--map-ink)">` +
        `<rect x="0" y="0" width="${bar.px / 2}" height="${5 * scale}"/>` +
        `<rect x="${bar.px / 2}" y="0" width="${bar.px / 2}" height="${5 * scale}" fill="none"/>` +
        `<text x="0" y="${18 * scale}" stroke="none" font-size="${11 * scale}" font-family="-apple-system, system-ui, sans-serif" font-weight="600">${escapeXml(bar.label)}</text></g>`
      )
    }
  }
  if (style.cartouche.show && (style.cartouche.title || style.cartouche.subtitle)) {
    const [x, y] = at(style.cartouche.at)
    const title = style.cartouche.title || ''
    const width = Math.max(title.length * 15, (style.cartouche.subtitle || '').length * 7, 120) * scale + 44 * scale
    const height = (style.cartouche.subtitle ? 58 : 42) * scale
    chrome.push(
      `<g transform="translate(${x} ${y})" font-family="var(--map-label-font)">` +
      `<rect width="${width}" height="${height}" fill="var(--map-sheet)" stroke="var(--map-ink)" stroke-width="${2 * scale}"/>` +
      `<rect x="${4 * scale}" y="${4 * scale}" width="${width - 8 * scale}" height="${height - 8 * scale}" fill="none" stroke="var(--map-ink)" stroke-width="${0.8 * scale}"/>` +
      `<text x="${width / 2}" y="${28 * scale}" text-anchor="middle" font-size="${22 * scale}" letter-spacing="${2.5 * scale}" fill="var(--map-ink)">${escapeXml(title.toUpperCase())}</text>` +
      (style.cartouche.subtitle ? `<text x="${width / 2}" y="${46 * scale}" text-anchor="middle" font-size="${12 * scale}" font-style="italic" fill="var(--map-ink)">${escapeXml(style.cartouche.subtitle)}</text>` : '') +
      `</g>`
    )
  }

  return {
    width: pixelWidth,
    height: pixelHeight,
    svg:
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${pixelWidth}" height="${pixelHeight}" viewBox="0 0 ${pixelWidth} ${pixelHeight}">` +
      `<style>svg{${variables}--map-inv-zoom:${1 / drawnZoom};}${worldCss()}</style>` +
      `<rect width="100%" height="100%" fill="var(--map-paper)"/>` +
      (backdrop ? `<image href="${backdrop}" x="0" y="0" width="${pixelWidth}" height="${pixelHeight}" preserveAspectRatio="none"/>` : '') +
      `<g transform="translate(${-rect.x * drawnZoom} ${-rect.y * drawnZoom}) scale(${drawnZoom})">${layers}</g>` +
      chrome.join('') +
      `</svg>`,
  }
}

/** An SVG string rasterized to a PNG blob. */
export async function svgToPng(svg, width, height) {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  try {
    const image = new Image()
    image.decoding = 'sync'
    await new Promise((resolve, reject) => {
      image.onload = resolve
      image.onerror = () => reject(new Error('The map could not be drawn as a picture.'))
      image.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d').drawImage(image, 0, 0, width, height)
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Ask where to save, then write `bytes` there. Resolves to the path, or null. */
export async function saveBytes(bytes, defaultName, extension, filterName) {
  const { save } = await import('@tauri-apps/plugin-dialog')
  const path = await save({ defaultPath: `${defaultName}.${extension}`, filters: [{ name: filterName, extensions: [extension] }] })
  if (!path) return null
  const { writeFile } = await import('@tauri-apps/plugin-fs')
  await writeFile(path, bytes)
  return path
}

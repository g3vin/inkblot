/**
 * traceSection.js — trace a map's picture into clean outlines.
 *
 * The picture is decoded at no more than 2048 px across (600 for the live preview),
 * handed to a worker, and the result drawn over the map as an SVG asset — so the
 * trace can be shown alone, over the picture, or not at all. Outlines can also become
 * the map's own regions, which is how a scanned coastline becomes land that travel
 * can be measured against.
 *
 * `useMapTrace` holds the settings and the preview; `traceSection` describes them.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { assetUrl, writeAsset } from '../../lib/assets'
import { DEFAULT_TRACE_OPTIONS, traceImage, traceToSvg } from '../../lib/map/trace'
import { newId } from '../../lib/map/mapModel'

const PREVIEW_SIZE = 600
const FULL_SIZE = 2048

/** Decode a picture to RGBA at most `maxSize` px across: `{ image, scale }`. */
async function decode(url, maxSize) {
  const response = await fetch(url)
  const bitmap = await createImageBitmap(await response.blob())
  const scale = Math.max(1, Math.max(bitmap.width, bitmap.height) / maxSize)
  const width = Math.max(1, Math.round(bitmap.width / scale))
  const height = Math.max(1, Math.round(bitmap.height / scale))
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height })
  const context = canvas.getContext('2d')
  context.drawImage(bitmap, 0, 0, width, height)
  const { data } = context.getImageData(0, 0, width, height)
  return { image: { data, width, height }, scale: bitmap.width / width }
}

let worker = null
let nextJob = 0
const pending = new Map()

/** Trace in the worker; fall back to the main thread where a module worker will not start. */
function traceOffThread(image, options, scale) {
  try {
    if (!worker) {
      worker = new Worker(new URL('../../lib/map/trace.worker.js', import.meta.url), { type: 'module' })
      worker.onmessage = (event) => {
        const job = pending.get(event.data.id)
        if (!job) return
        pending.delete(event.data.id)
        if (event.data.error) job.reject(new Error(event.data.error))
        else job.resolve(event.data.result)
      }
      worker.onerror = () => {
        for (const job of pending.values()) job.fallback()
        pending.clear()
        worker = null
      }
    }
    const id = (nextJob += 1)
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, fallback: () => resolve(traceImage(image, options, scale)) })
      worker.postMessage({ id, image, options, scale })
    })
  } catch {
    return Promise.resolve(traceImage(image, options, scale))
  }
}

export function useMapTrace({ map, dispatch, projectName }) {
  const [options, setOptions] = useState(DEFAULT_TRACE_OPTIONS)
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState('')
  const [regionCount, setRegionCount] = useState(3)
  const runRef = useRef(0)
  const { image, width, height } = map.background

  // A live preview at low resolution, redone as the settings change.
  useEffect(() => {
    if (!open || !image) return undefined
    const run = (runRef.current += 1)
    const timer = setTimeout(async () => {
      try {
        const decoded = await decode(await assetUrl(projectName, image), PREVIEW_SIZE)
        const result = await traceOffThread(decoded.image, options, decoded.scale)
        if (run === runRef.current) setPreview(result)
      } catch (error) {
        console.warn('[map] trace preview failed:', error)
      }
    }, 250)
    return () => clearTimeout(timer)
  }, [image, open, options, projectName])

  const apply = useCallback(async () => {
    setBusy('Tracing…')
    try {
      const decoded = await decode(await assetUrl(projectName, image), FULL_SIZE)
      const result = await traceOffThread(decoded.image, options, decoded.scale)
      const svg = traceToSvg(result, width, height)
      const asset = await writeAsset(projectName, new TextEncoder().encode(svg), 'svg')
      dispatch({ type: 'section/patch', section: 'background', patch: { trace: asset } })
      setPreview(result)
      setBusy('')
    } catch (error) {
      console.error('[map] trace failed:', error)
      setBusy('The picture could not be traced.')
    }
  }, [dispatch, height, image, options, projectName, width])

  const makeRegions = useCallback(() => {
    const shapes = (preview?.shapes || []).filter((shape) => shape.closed).sort((a, b) => b.area - a.area).slice(0, regionCount)
    const regions = shapes.map((shape, index) => ({
      id: newId(),
      name: `Land ${index + 1}`,
      rings: [shape.points.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10])],
      terrain: null,
      fill: null,
      hatch: 'none',
      stroke: null,
    }))
    if (regions.length) dispatch({ type: 'items/add', collection: 'regions', items: regions })
  }, [dispatch, preview, regionCount])

  return useMemo(
    () => ({ options, setOptions, open, setOpen, preview, busy, regionCount, setRegionCount, apply, makeRegions }),
    [apply, busy, makeRegions, open, options, preview, regionCount]
  )
}

export function traceSection(ui, { map, dispatch, trace }) {
  const { options, setOptions, open, setOpen, preview, busy, regionCount, setRegionCount, apply, makeRegions } = trace
  const { width, height } = map.background
  const set = (patch) => setOptions((current) => ({ ...current, ...patch }))
  const fields = !open
    ? [ui.note('Turn a photo or scan of a drawn map into clean vector lines.')]
    : [
        ui.choice('trace.mode', 'Read it as', options.mode, [{ value: 'outline', label: 'Filled shapes (outlines)' }, { value: 'lines', label: 'Pen lines (centre lines)' }], (mode) => set({ mode })),
        ui.toggle('trace.autoContrast', 'Automatic contrast', !Number.isFinite(options.threshold), (auto) => set({ threshold: auto ? null : preview?.threshold ?? 128 })),
        Number.isFinite(options.threshold) ? ui.number('trace.threshold', 'Ink darker than', options.threshold, (threshold) => set({ threshold }), { min: 1, max: 254, step: 1 }) : null,
        ui.toggle('trace.invert', 'Light ink on dark', options.invert, (invert) => set({ invert })),
        ui.number('trace.minArea', 'Ignore specks under', options.minArea, (minArea) => set({ minArea }), { min: 0, step: 4, suffix: 'px²' }),
        ui.number('trace.detail', 'Simplify', options.detail, (detail) => set({ detail }), { min: 0.2, max: 20, step: 0.2, suffix: 'px' }),
        ui.number('trace.smoothing', 'Smoothing', options.smoothing, (smoothing) => set({ smoothing }), { min: 0, max: 5, step: 1 }),
        preview
          ? ui.preview(width, height, preview.shapes.map((shape) => `M${shape.points.map(([x, y]) => `${x} ${y}`).join('L')}${shape.closed ? 'Z' : ''}`).join(''), preview.mode !== 'lines')
          : ui.note('Working out a preview…'),
        preview ? ui.note(`${preview.shapes.length} ${preview.mode === 'lines' ? 'lines' : 'shapes'} found.`) : null,
        ui.buttons([
          ui.button('trace.apply', 'Trace the picture', apply, { role: 'primary', disabled: busy === 'Tracing…' }),
          map.background.trace ? ui.button('trace.remove', 'Remove trace', () => dispatch({ type: 'section/patch', section: 'background', patch: { trace: null } })) : null,
        ]),
        busy ? ui.note(busy) : null,
        ...(options.mode === 'outline' && preview?.shapes.length
          ? [
              ui.number('trace.regionCount', 'How many regions', regionCount, (count) => setRegionCount(Math.round(count)), { min: 1, max: 50, step: 1 }),
              ui.buttonField('trace.makeRegions', 'Make regions from the largest', makeRegions),
            ]
          : []),
      ]
  return ui.section('trace', 'Trace into outlines', fields, [ui.button('trace.toggle', open ? 'Close' : 'Trace…', () => setOpen(!open))])
}

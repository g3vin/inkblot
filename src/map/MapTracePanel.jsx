/**
 * MapTracePanel.jsx — trace a map's picture into clean outlines.
 *
 * The picture is decoded at no more than 2048 px across (600 for the live preview),
 * handed to a worker, and the result drawn over the map as an SVG asset — so the
 * trace can be shown alone, over the picture, or not at all. Outlines can also become
 * the map's own regions, which is how a scanned coastline becomes land that travel
 * can be measured against.
 */
import { useEffect, useRef, useState } from 'react'
import { assetUrl, writeAsset } from '../lib/assets'
import { DEFAULT_TRACE_OPTIONS, traceImage, traceToSvg } from '../lib/map/trace'
import { newId } from '../lib/map/mapModel'
import { CheckField, NumberField, Section, SelectField } from './inspector/fields'

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
      worker = new Worker(new URL('../lib/map/trace.worker.js', import.meta.url), { type: 'module' })
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

export default function MapTracePanel({ map, dispatch, projectName }) {
  const [options, setOptions] = useState(DEFAULT_TRACE_OPTIONS)
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState('')
  const [regionCount, setRegionCount] = useState(3)
  const runRef = useRef(0)
  const { image, width, height, trace } = map.background

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

  const apply = async () => {
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
  }

  const makeRegions = () => {
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
  }

  const set = (patch) => setOptions((current) => ({ ...current, ...patch }))

  return (
    <Section title="Trace into outlines" actions={<button type="button" className="map-button" onClick={() => setOpen((value) => !value)}>{open ? 'Close' : 'Trace…'}</button>}>
      {!open ? <p className="map-note">Turn a photo or scan of a drawn map into clean vector lines.</p> : null}
      {open ? (
        <>
          <SelectField
            label="Read it as"
            value={options.mode}
            options={[{ value: 'outline', label: 'Filled shapes (outlines)' }, { value: 'lines', label: 'Pen lines (centre lines)' }]}
            onChange={(mode) => set({ mode })}
          />
          <CheckField label="Automatic contrast" checked={!Number.isFinite(options.threshold)} onChange={(auto) => set({ threshold: auto ? null : preview?.threshold ?? 128 })} />
          {Number.isFinite(options.threshold) ? (
            <NumberField label="Ink darker than" value={options.threshold} min={1} max={254} step={1} onCommit={(threshold) => set({ threshold })} />
          ) : null}
          <CheckField label="Light ink on dark" checked={options.invert} onChange={(invert) => set({ invert })} />
          <NumberField label="Ignore specks under" value={options.minArea} min={0} step={4} suffix="px²" onCommit={(minArea) => set({ minArea })} />
          <NumberField label="Simplify" value={options.detail} min={0.2} max={20} step={0.2} suffix="px" onCommit={(detail) => set({ detail })} />
          <NumberField label="Smoothing" value={options.smoothing} min={0} max={5} step={1} onCommit={(smoothing) => set({ smoothing })} />
          {preview ? (
            <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 150, background: 'var(--map-sheet)', borderRadius: 8, marginTop: 6 }} aria-label="Trace preview">
              <path
                d={preview.shapes.map((shape) => `M${shape.points.map(([x, y]) => `${x} ${y}`).join('L')}${shape.closed ? 'Z' : ''}`).join('')}
                fill={preview.mode === 'lines' ? 'none' : 'currentColor'}
                fillOpacity={0.2}
                fillRule="evenodd"
                stroke="currentColor"
                strokeWidth={Math.max(1, width / 300)}
              />
            </svg>
          ) : <p className="map-note">Working out a preview…</p>}
          <p className="map-note">{preview ? `${preview.shapes.length} ${preview.mode === 'lines' ? 'lines' : 'shapes'} found.` : ''}</p>
          <div className="map-row">
            <button type="button" className="map-button is-primary" onClick={apply} disabled={Boolean(busy) && busy === 'Tracing…'}>Trace the picture</button>
            {trace ? <button type="button" className="map-button" onClick={() => dispatch({ type: 'section/patch', section: 'background', patch: { trace: null } })}>Remove trace</button> : null}
          </div>
          {busy ? <p className="map-note">{busy}</p> : null}
          {options.mode === 'outline' && preview?.shapes.length ? (
            <div className="map-row" style={{ marginTop: 8 }}>
              <button type="button" className="map-button" onClick={makeRegions}>Make regions from the largest</button>
              <input className="map-input" style={{ width: 56 }} type="number" min="1" max="50" value={regionCount} onChange={(event) => setRegionCount(Math.max(1, Math.min(50, Number(event.target.value) || 1)))} aria-label="How many regions" />
            </div>
          ) : null}
        </>
      ) : null}
    </Section>
  )
}

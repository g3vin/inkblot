/**
 * ExportMapDialog.jsx — Export map… : the map out into the world as a PNG, SVG or
 * PDF, on paper, or on the clipboard (paste it into a chapter like any picture).
 *
 * Places, routes and regions also go out as GeoJSON or KML, for GIS tools and
 * Google Earth.
 *
 * Opened from the map toolbar's More menu, ⌘K and ⇧⌘E. Everything is drawn by
 * mapExport.js from the same layers the editor shows, so an export is what was on
 * screen. A globe or 3D view is exported as it is framed, drawn by its own renderer
 * under the same places and labels; a 3D view can also be filmed going once round
 * (a turntable video, of the scene alone). A star system, galaxy or group of
 * galaxies can instead be plotted as line art in one ink (plotScene.js): crisp
 * vector plates for a book, from whatever angle it is framed at.
 */
import { useState } from 'react'
import { Button, Dialog, FormRow, Segmented, SelectMenu } from '../ui'
import { getDocDisplayName } from '../lib/docKind'
import { buildSchedules } from '../lib/map/timeline'
import { printFigure } from '../print/printJob'
import { buildMapSvg, saveBytes, svgToPng } from './mapExport'
import { mapToGeoJSON, mapToKml } from '../lib/map/geoInterchange'

const FRAMES = [{ value: 'view', label: 'What’s on screen' }, { value: 'all', label: 'The whole map' }]
const DRAWINGS = [{ value: 'picture', label: 'As on screen' }, { value: 'ink', label: 'Ink drawing' }, { value: 'mono', label: 'Black and white' }]
const TURNTABLE_LENGTHS = [{ value: '4', label: '4 s' }, { value: '8', label: '8 s' }, { value: '16', label: '16 s' }]
const SHARPNESS = [{ value: '1', label: 'Standard (1×)' }, { value: '2', label: 'Retina (2×)' }, { value: '4', label: 'Print (4×)' }]

export default function ExportMapDialog({ open, onClose, map, projector, space, day, projectName, docPath, surfaceRef, viewportRef, picture = null, recorder = null, plotCamera = null }) {
  const [frame, setFrame] = useState('view')
  const [scale, setScale] = useState(2)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [seconds, setSeconds] = useState('8')
  // A 3D view can be drawn as on screen, or plotted as line art (space/plot/).
  const [drawing, setDrawing] = useState('picture')
  const plotting = Boolean(plotCamera) && drawing !== 'picture'
  const name = getDocDisplayName(docPath)

  // A globe or a 3D view draws itself (`picture`); only what is on screen can be shown.
  const native = Boolean(picture)
  const build = async (pixelScale) => {
    const surface = surfaceRef.current
    if (plotting) {
      const { plotScene } = await import('./space/plot/plotScene')
      const { cartouche } = map.style
      return plotScene(map, space, {
        day,
        camera: plotCamera(),
        width: surface?.clientWidth || 1200,
        height: surface?.clientHeight || 800,
        scale: pixelScale,
        mono: drawing === 'mono',
        title: cartouche.show ? cartouche.title : null,
      })
    }
    const canvas = native ? await picture(pixelScale) : null
    if (native && !canvas) throw new Error('The view could not be drawn.')
    return buildMapSvg({
      map,
      projector,
      space,
      day,
      schedules: buildSchedules(map, space),
      projectName,
      surface,
      viewport: viewportRef.current,
      viewSize: { width: surface?.clientWidth || 1200, height: surface?.clientHeight || 800 },
      frame: native ? 'view' : frame,
      scale: pixelScale,
      backdrop: canvas ? canvas.toDataURL('image/png') : null,
    })
  }

  const run = (label, task) => async () => {
    setBusy(true)
    setStatus(`${label}…`)
    try {
      const result = await task()
      setStatus(result === false ? '' : result || 'Done.')
    } catch (error) {
      console.error(`[map] ${label} failed:`, error)
      setStatus(`Couldn’t finish. ${error?.message || error}`)
    } finally {
      setBusy(false)
    }
  }

  const exportPng = run('Saving PNG', async () => {
    const { svg, width, height } = await build(scale)
    const blob = await svgToPng(svg, width, height)
    const path = await saveBytes(new Uint8Array(await blob.arrayBuffer()), name, 'png', 'PNG image')
    return path ? `Saved ${path.split('/').pop()} (${width} × ${height}).` : false
  })
  const exportSvg = run('Saving SVG', async () => {
    const { svg } = await build(1)
    const path = await saveBytes(new TextEncoder().encode(svg), name, 'svg', 'SVG image')
    return path ? `Saved ${path.split('/').pop()}.` : false
  })
  const exportPdf = run('Saving PDF', async () => {
    const { save } = await import('@tauri-apps/plugin-dialog')
    const pdfPath = await save({ defaultPath: `${name}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] })
    if (!pdfPath) return false
    const { svg, width, height } = await build(1)
    await printFigure({ markup: svg, widthPx: width, heightPx: height, jobName: name, pdfPath })
    return `Saved ${pdfPath.split('/').pop()}.`
  })
  const print = run('Printing', async () => {
    const { svg, width, height } = await build(1)
    await printFigure({ markup: svg, widthPx: width, heightPx: height, jobName: name })
    return false
  })
  const exportGeoJson = run('Saving GeoJSON', async () => {
    const text = JSON.stringify(mapToGeoJSON(map, space, { day }), null, 2)
    const path = await saveBytes(new TextEncoder().encode(text), name, 'geojson', 'GeoJSON')
    return path ? `Saved ${path.split('/').pop()}.` : false
  })
  const exportKml = run('Saving KML', async () => {
    const path = await saveBytes(new TextEncoder().encode(mapToKml(map, space, { name, day })), name, 'kml', 'KML')
    return path ? `Saved ${path.split('/').pop()}.` : false
  })
  const exportVideo = run('Recording', async () => {
    const { blob, extension } = await recorder.record({
      seconds: Number(seconds),
      onProgress: (fraction) => setStatus(`Recording… ${Math.round(fraction * 100)}%`),
    })
    setStatus('Saving…')
    const path = await saveBytes(new Uint8Array(await blob.arrayBuffer()), `${name} turntable`, extension, 'Video')
    return path ? `Saved ${path.split('/').pop()}.` : false
  })
  const copy = run('Copying', async () => {
    const { svg, width, height } = await build(scale)
    const blob = await svgToPng(svg, width, height)
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    return 'Copied. Paste it into any document.'
  })

  return (
    <Dialog
      open={open}
      onClose={onClose}
      eyebrow="Map"
      width="min(600px, calc(100vw - 32px))"
      title="Export map"
      description="Save it as a picture, print it, or copy it to paste into a chapter."
      footer={
        <>
          <Button disabled={busy} onClick={copy}>Copy image</Button>
          <Button disabled={busy} onClick={print}>Print…</Button>
          <Button disabled={busy} onClick={exportSvg}>Save SVG…</Button>
          <Button disabled={busy} onClick={exportPdf}>Save PDF…</Button>
          <Button variant="filled" disabled={busy} onClick={exportPng}>Save PNG…</Button>
        </>
      }
    >
      {plotCamera ? (
        <FormRow label="Drawing" help="map.export">
          <Segmented label="How to draw it" value={drawing} onChange={setDrawing} options={DRAWINGS} />
        </FormRow>
      ) : null}
      {native ? null : (
        <FormRow label="What">
          <Segmented label="What to export" value={frame} onChange={setFrame} options={FRAMES} />
        </FormRow>
      )}
      <FormRow label="Sharpness" help="map.export">
        <SelectMenu label="Sharpness" value={String(scale)} options={SHARPNESS} onChange={(value) => setScale(Number(value))} />
      </FormRow>
      {recorder ? (
        <FormRow label="Turntable" help="map.export">
          <span className="map-row">
            <Segmented label="How long" value={seconds} onChange={setSeconds} options={TURNTABLE_LENGTHS} />
            <Button disabled={busy} onClick={exportVideo}>Save video…</Button>
          </span>
        </FormRow>
      ) : null}
      <FormRow label="Places and borders" help="map.interchange">
        <span className="map-row">
          <Button disabled={busy} onClick={exportGeoJson}>Save GeoJSON…</Button>
          <Button disabled={busy} onClick={exportKml}>Save KML…</Button>
        </span>
      </FormRow>
      <p className="ib-hint" role="status">{status || 'Drag this map onto a canvas to show it there, kept up to date.'}</p>
    </Dialog>
  )
}

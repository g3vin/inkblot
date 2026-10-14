/**
 * ExportMapDialog.jsx — Export map… : the map out into the world as a PNG, SVG or
 * PDF, on paper, or on the clipboard (paste it into a chapter like any picture).
 *
 * Opened from the map toolbar's More menu, ⌘K and ⇧⌘E. Everything is drawn by
 * mapExport.js from the same layers the editor shows, so an export is what was on
 * screen.
 */
import { useState } from 'react'
import { Button, Dialog, FormRow, Segmented, SelectMenu } from '../ui'
import { getDocDisplayName } from '../lib/docKind'
import { buildSchedules } from '../lib/map/timeline'
import { printFigure } from '../print/printJob'
import { buildMapSvg, saveBytes, svgToPng } from './mapExport'

const FRAMES = [{ value: 'view', label: 'What’s on screen' }, { value: 'all', label: 'The whole map' }]
const SHARPNESS = [{ value: '1', label: 'Standard (1×)' }, { value: '2', label: 'Retina (2×)' }, { value: '4', label: 'Print (4×)' }]

export default function ExportMapDialog({ open, onClose, map, projector, space, day, projectName, docPath, surfaceRef, viewportRef }) {
  const [frame, setFrame] = useState('view')
  const [scale, setScale] = useState(2)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const name = getDocDisplayName(docPath)

  const build = (pixelScale) => {
    const surface = surfaceRef.current
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
      frame,
      scale: pixelScale,
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
      <FormRow label="What">
        <Segmented label="What to export" value={frame} onChange={setFrame} options={FRAMES} />
      </FormRow>
      <FormRow label="Sharpness" help="map.export">
        <SelectMenu label="Sharpness" value={String(scale)} options={SHARPNESS} onChange={(value) => setScale(Number(value))} />
      </FormRow>
      <p className="ib-hint" role="status">{status || 'Drag this map onto a canvas to show it there, kept up to date.'}</p>
    </Dialog>
  )
}

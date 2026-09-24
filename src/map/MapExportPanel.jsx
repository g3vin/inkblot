/**
 * MapExportPanel.jsx — the map out into the world: an SVG, a PNG, a PDF, paper, or
 * the clipboard (paste it into a chapter like any picture).
 */
import { useState } from 'react'
import { getDocDisplayName } from '../lib/docKind'
import { buildSchedules } from '../lib/map/timeline'
import { printFigure } from '../print/printJob'
import { buildMapSvg, saveBytes, svgToPng } from './mapExport'
import { Section, SelectField } from './inspector/fields'

export default function MapExportPanel({ map, projectName, docPath, surfaceRef, projector, space, day, viewport }) {
  const [frame, setFrame] = useState('view')
  const [scale, setScale] = useState(2)
  const [status, setStatus] = useState('')
  const name = getDocDisplayName(docPath)

  const build = async (pixelScale) => {
    const surface = surfaceRef.current
    return buildMapSvg({
      map,
      projector,
      space,
      day,
      schedules: buildSchedules(map, space),
      projectName,
      surface,
      viewport,
      viewSize: { width: surface?.clientWidth || 1200, height: surface?.clientHeight || 800 },
      frame,
      scale: pixelScale,
    })
  }

  const run = async (label, task) => {
    setStatus(`${label}…`)
    try {
      const result = await task()
      setStatus(result === false ? '' : result || 'Done.')
    } catch (error) {
      console.error(`[map] ${label} failed:`, error)
      setStatus(`${label} didn’t work: ${error?.message || error}`)
    }
  }

  const exportSvg = () => run('Saving SVG', async () => {
    const { svg } = await build(1)
    const path = await saveBytes(new TextEncoder().encode(svg), name, 'svg', 'SVG image')
    return path ? `Saved ${path.split('/').pop()}.` : false
  })

  const exportPng = () => run('Saving PNG', async () => {
    const { svg, width, height } = await build(scale)
    const blob = await svgToPng(svg, width, height)
    const path = await saveBytes(new Uint8Array(await blob.arrayBuffer()), name, 'png', 'PNG image')
    return path ? `Saved ${path.split('/').pop()} (${width} × ${height}).` : false
  })

  const exportPdf = () => run('Saving PDF', async () => {
    const { save } = await import('@tauri-apps/plugin-dialog')
    const pdfPath = await save({ defaultPath: `${name}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] })
    if (!pdfPath) return false
    const { svg, width, height } = await build(1)
    await printFigure({ markup: svg, widthPx: width, heightPx: height, jobName: name, pdfPath })
    return `Saved ${pdfPath.split('/').pop()}.`
  })

  const print = () => run('Printing', async () => {
    const { svg, width, height } = await build(1)
    await printFigure({ markup: svg, widthPx: width, heightPx: height, jobName: name })
    return false
  })

  const copy = () => run('Copying', async () => {
    const { svg, width, height } = await build(scale)
    const blob = await svgToPng(svg, width, height)
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    return 'Copied — paste it into any document.'
  })

  return (
    <Section title="Export">
      <SelectField label="What" value={frame} options={[{ value: 'view', label: 'What’s on screen' }, { value: 'all', label: 'The whole map' }]} onChange={setFrame} />
      <SelectField label="Sharpness" value={String(scale)} options={[{ value: '1', label: 'Standard (1×)' }, { value: '2', label: 'Retina (2×)' }, { value: '4', label: 'Print (4×)' }]} onChange={(value) => setScale(Number(value))} />
      <div className="map-row">
        <button type="button" className="map-button" onClick={exportPng}>PNG</button>
        <button type="button" className="map-button" onClick={exportSvg}>SVG</button>
        <button type="button" className="map-button" onClick={exportPdf}>PDF</button>
        <button type="button" className="map-button" onClick={print}>Print…</button>
        <button type="button" className="map-button" onClick={copy}>Copy image</button>
      </div>
      <p className="map-note">{status || 'Drag this map onto a canvas to show it there, kept up to date.'}</p>
    </Section>
  )
}

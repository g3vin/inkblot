/**
 * MapSetup.jsx — what a new map is, asked the first time it is opened.
 *
 * A blank sheet at a chosen scale, a picture of a map, the Earth in a chosen
 * projection, or a star system. Every creation path makes the same blank map marked
 * `setupPending`; this is where it becomes one of those.
 */
import { useState } from 'react'
import SFIcon from '../components/SFIcon'
import { IMAGE_EXTENSIONS_LIST, assetUrl, importAssetFromPath, measureImage } from '../lib/assets'
import { PROJECTION_NAMES } from '../lib/map/mapProjection'
import { SYSTEM_PRESETS, presetBodies } from '../lib/map/systemPresets'
import { defaultTerrainEntries } from '../lib/map/terrains'
import { BLANK_SHEET } from '../lib/map/mapModel'

/** Blank-sheet scales: how many km the 4000-unit-wide sheet spans. */
const SHEET_SCALES = [
  { id: 'town', label: 'A town', hint: '2 km across', km: 2, unit: 'm' },
  { id: 'region', label: 'A region', hint: '150 km across', km: 150, unit: 'km' },
  { id: 'kingdom', label: 'A kingdom', hint: '800 km across', km: 800, unit: 'km' },
  { id: 'continent', label: 'A continent', hint: '5,000 km across', km: 5000, unit: 'km' },
]

const PROJECTION_ORDER = ['equalEarth', 'orthographic', 'naturalEarth', 'mercator', 'equirectangular']

export default function MapSetup({ projectName, onDone }) {
  const [step, setStep] = useState(null)
  const [status, setStatus] = useState('')

  const chooseImage = async () => {
    setStatus('')
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({ multiple: false, filters: [{ name: 'Images', extensions: IMAGE_EXTENSIONS_LIST }] })
      if (!selected) return
      const path = Array.isArray(selected) ? selected[0] : selected
      setStatus('Importing…')
      const image = await importAssetFromPath(projectName, path)
      const size = await measureImage(await assetUrl(projectName, image))
      onDone({
        mapKind: 'image',
        background: { image, width: size?.width || BLANK_SHEET.width, height: size?.height || BLANK_SHEET.height, opacity: 1, trace: null, showImage: true },
        terrains: defaultTerrainEntries(),
        scale: { kmPerUnit: 1, displayUnit: 'km', calibration: null, customUnits: [] },
      })
    } catch (error) {
      console.error('[map] could not import the picture:', error)
      setStatus('That picture could not be imported.')
    }
  }

  return (
    <div className="map-setup">
      <div className="map-floating map-setup-card" style={{ position: 'relative' }}>
        <h2>What kind of map is this?</h2>
        <p className="map-note">You can add places, routes and journeys to any of them, and change the look later.</p>

        <div className="map-setup-grid">
          <button type="button" className="map-setup-option" onClick={() => setStep('blank')}>
            <SFIcon name="map" size={22} />
            <strong>A blank sheet</strong>
            <small>Draw a world of your own: coasts, regions, roads.</small>
          </button>
          <button type="button" className="map-setup-option" onClick={chooseImage}>
            <SFIcon name="photo" size={22} />
            <strong>From a picture</strong>
            <small>A drawn or scanned map. Trace it into outlines later.</small>
          </button>
          <button type="button" className="map-setup-option" onClick={() => setStep('earth')}>
            <SFIcon name="globe" size={22} />
            <strong>The Earth</strong>
            <small>Real coastlines and countries, offline.</small>
          </button>
          <button type="button" className="map-setup-option" onClick={() => setStep('system')}>
            <SFIcon name="map.system" size={22} />
            <strong>A star system</strong>
            <small>Stars, planets and moons that move with your story.</small>
          </button>
        </div>

        {step === 'blank' ? (
          <div className="map-setup-choices">
            {SHEET_SCALES.map((scale) => (
              <button
                key={scale.id}
                type="button"
                className="map-button"
                title={scale.hint}
                onClick={() =>
                  onDone({
                    mapKind: 'blank',
                    background: { width: BLANK_SHEET.width, height: BLANK_SHEET.height },
                    scale: { kmPerUnit: scale.km / BLANK_SHEET.width, displayUnit: scale.unit, calibration: null, customUnits: [] },
                    terrains: defaultTerrainEntries(),
                  })
                }
              >
                {scale.label} <small>· {scale.hint}</small>
              </button>
            ))}
          </div>
        ) : null}

        {step === 'earth' ? (
          <div className="map-setup-choices">
            {PROJECTION_ORDER.map((projection) => (
              <button
                key={projection}
                type="button"
                className="map-button"
                onClick={() =>
                  onDone({
                    mapKind: 'earth',
                    earth: { projection, rotate: [0, 0], graticule: true, borders: true, detail: 'auto' },
                    scale: { kmPerUnit: 1, displayUnit: 'km', calibration: null, customUnits: [] },
                    terrains: defaultTerrainEntries(),
                  })
                }
              >
                {PROJECTION_NAMES[projection]}
              </button>
            ))}
          </div>
        ) : null}

        {step === 'system' ? (
          <div className="map-setup-choices">
            {SYSTEM_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="map-button"
                title={preset.hint}
                onClick={() =>
                  onDone({
                    mapKind: 'system',
                    system: { bodies: presetBodies(preset.id), display: { radial: 'log', pxPerAU: 100 } },
                    scale: { kmPerUnit: 1, displayUnit: 'AU', calibration: null, customUnits: [] },
                    style: { theme: 'night' },
                  })
                }
              >
                {preset.label}
              </button>
            ))}
          </div>
        ) : null}

        {status ? <p className="map-note">{status}</p> : null}
      </div>
    </div>
  )
}

/**
 * MapSetup.jsx — what a new map is, asked the first time it is opened.
 *
 * A blank sheet at a chosen scale, a picture of a map, the Earth in a chosen
 * projection, or a star system. Every creation path makes the same blank map marked
 * `setupPending`; this is where it becomes one of those.
 */
import { useState } from 'react'
import Icon from '../ui/Icon.jsx'
import { IMAGE_EXTENSIONS_LIST, assetUrl, importAssetFromPath, measureImage } from '../lib/assets'
import { PROJECTION_NAMES } from '../lib/map/mapProjection'
import { SYSTEM_PRESET_GROUPS, SYSTEM_PRESETS, presetSystem } from '../lib/map/systemPresets'
import { newSeed } from '../lib/map/seeded'
import { PLANET_PRESET_GROUPS, PLANET_PRESETS, presetSurface } from '../lib/map/planetPresets'
import { defaultTerrainEntries } from '../lib/map/terrains'
import { BLANK_SHEET } from '../lib/map/mapModel'

/** Blank-sheet scales: how many km the 4000-unit-wide sheet spans. */
const SHEET_SCALES = [
  { id: 'town', label: 'A town', hint: '2 km across', km: 2, unit: 'm' },
  { id: 'region', label: 'A region', hint: '150 km across', km: 150, unit: 'km' },
  { id: 'kingdom', label: 'A kingdom', hint: '800 km across', km: 800, unit: 'km' },
  { id: 'continent', label: 'A continent', hint: '5,000 km across', km: 5000, unit: 'km' },
]

/** The Earth: the globe first, then the flat projections. */
const EARTH_CHOICES = [
  { id: 'globe', label: 'A globe', hint: 'Spin it and zoom down to a street', earth: { view: 'globe', projection: 'equalEarth' } },
  ...['equalEarth', 'naturalEarth', 'mercator', 'equirectangular'].map((projection) => ({
    id: projection,
    label: PROJECTION_NAMES[projection],
    hint: 'A flat map of the whole world',
    earth: { view: 'flat', projection },
  })),
]

/** A new planet map wearing `surface`. */
const planetMap = (surface) => ({
  mapKind: 'planet',
  surface,
  scale: { kmPerUnit: 1, displayUnit: 'km', calibration: null, customUnits: [] },
  terrains: defaultTerrainEntries(),
  style: { theme: 'night' },
})

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

  /** A planet wrapped in a picture: an equirectangular map of a world. */
  const choosePlanetPicture = async () => {
    setStatus('')
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({ multiple: false, filters: [{ name: 'Images', extensions: IMAGE_EXTENSIONS_LIST }] })
      if (!selected) return
      setStatus('Importing…')
      const texture = await importAssetFromPath(projectName, Array.isArray(selected) ? selected[0] : selected)
      onDone(planetMap({ ...presetSurface('earthlike'), look: { kind: 'texture', texture, seed: 1 } }))
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

        <h3 className="ib-eyebrow map-setup-heading">On a world</h3>
        <div className="map-setup-grid">
          <button type="button" className="map-setup-option" onClick={() => setStep('blank')}>
            <Icon name="map" size={20} />
            <strong>A blank sheet</strong>
            <small>Draw a world of your own: coasts, regions, roads.</small>
          </button>
          <button type="button" className="map-setup-option" onClick={chooseImage}>
            <Icon name="image" size={20} />
            <strong>From a picture</strong>
            <small>A drawn or scanned map. Trace it into outlines later.</small>
          </button>
          <button type="button" className="map-setup-option" onClick={() => setStep('earth')}>
            <Icon name="globe" size={20} />
            <strong>The Earth</strong>
            <small>A globe to spin and zoom, or a flat map. Real coastlines, offline.</small>
          </button>
          <button type="button" className="map-setup-option" onClick={() => setStep('planet')}>
            <Icon name="world" size={20} />
            <strong>A planet or star</strong>
            <small>A whole world to turn, invented or drawn. Paint its continents.</small>
          </button>
        </div>

        <h3 className="ib-eyebrow map-setup-heading">In space</h3>
        <div className="map-setup-grid">
          <button type="button" className="map-setup-option" onClick={() => setStep('system')}>
            <Icon name="orbit" size={20} />
            <strong>A star system</strong>
            <small>Stars, planets and moons that move with your story, in 3D.</small>
          </button>
        </div>

        {step === 'planet' ? (
          <div className="map-setup-groups">
            {PLANET_PRESET_GROUPS.map(([group, title]) => (
              <div key={group} className="map-setup-group">
                <h3 className="ib-eyebrow">{title}</h3>
                <div className="map-setup-choices">
                  {PLANET_PRESETS.filter((preset) => preset.group === group).map((preset) => (
                    <button key={preset.id} type="button" className="map-button" title={preset.hint} onClick={() => onDone(planetMap(presetSurface(preset.id, newSeed())))}>
                      {preset.label}
                    </button>
                  ))}
                  {group === 'world' ? (
                    <button type="button" className="map-button" title="An equirectangular picture of a world" onClick={choosePlanetPicture}>
                      From a picture…
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}

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
            {EARTH_CHOICES.map((choice) => (
              <button
                key={choice.id}
                type="button"
                className="map-button"
                title={choice.hint}
                onClick={() =>
                  onDone({
                    mapKind: 'earth',
                    earth: { ...choice.earth, rotate: [0, 0], graticule: true, borders: true, detail: 'auto', imagery: 'map', terrain3d: false },
                    scale: { kmPerUnit: 1, displayUnit: 'km', calibration: null, customUnits: [] },
                    terrains: defaultTerrainEntries(),
                  })
                }
              >
                {choice.label}
              </button>
            ))}
          </div>
        ) : null}

        {step === 'system' ? (
          <div className="map-setup-groups">
            {SYSTEM_PRESET_GROUPS.map(([group, title]) => (
              <div key={group} className="map-setup-group">
                <h3 className="ib-eyebrow">{title}</h3>
                <div className="map-setup-choices">
                  {SYSTEM_PRESETS.filter((preset) => preset.group === group).map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className="map-button"
                      title={preset.hint}
                      onClick={() =>
                        onDone({
                          mapKind: 'system',
                          // A template that rolls its stars starts from a new seed each time.
                          system: presetSystem(preset.id, { seed: preset.id === 'encounter' ? newSeed() : 1 }),
                          scale: { kmPerUnit: 1, displayUnit: 'AU', calibration: null, customUnits: [] },
                          style: { theme: 'night' },
                        })
                      }
                    >
                      {preset.label}
                      {preset.group === 'three' ? <small> · {preset.stable ? 'stable' : 'chaotic'}</small> : null}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {status ? <p className="map-note">{status}</p> : null}
      </div>
    </div>
  )
}

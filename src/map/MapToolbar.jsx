/**
 * MapToolbar.jsx — the floating tool bar across the top of a map.
 *
 * It floats inside the map rather than sitting in the window's titlebar, so it
 * works the same under the Tauri window and the Swift shell's native toolbar, and in
 * either half of a split.
 */
import SFIcon from '../components/SFIcon'
import { MAP_TOOLS } from './mapOptions'

const formatZoom = (zoom) => (zoom >= 10 ? `${Math.round(zoom)}×` : zoom >= 1 ? `${Math.round(zoom * 100)}%` : `${Math.round(zoom * 1000) / 10}%`)

export default function MapToolbar({
  tool,
  onTool,
  zoom,
  onZoomIn,
  onZoomOut,
  onFit,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  inspectorOpen,
  onToggleInspector,
}) {
  return (
    <div className="map-floating map-toolbar" role="toolbar" aria-label="Map tools">
      {MAP_TOOLS.map((option) => (
        <button
          key={option.id}
          type="button"
          className={`map-tool${tool === option.id ? ' is-active' : ''}`}
          title={`${option.label} (${option.key})`}
          aria-label={option.label}
          aria-pressed={tool === option.id}
          onClick={() => onTool(option.id)}
        >
          <SFIcon name={option.icon} size={16} />
        </button>
      ))}
      <span className="map-toolbar-sep" />
      <button type="button" className="map-tool" title="Undo (⌘Z)" aria-label="Undo" disabled={!canUndo} onClick={onUndo}>
        <SFIcon name="arrow.uturn.backward" size={16} />
      </button>
      <button type="button" className="map-tool" title="Redo (⇧⌘Z)" aria-label="Redo" disabled={!canRedo} onClick={onRedo}>
        <SFIcon name="arrow.uturn.forward" size={16} />
      </button>
      <span className="map-toolbar-sep" />
      <button type="button" className="map-tool" title="Zoom out" aria-label="Zoom out" onClick={onZoomOut}>
        <SFIcon name="minus" size={16} />
      </button>
      <span className="map-zoom-readout">{formatZoom(zoom)}</span>
      <button type="button" className="map-tool" title="Zoom in" aria-label="Zoom in" onClick={onZoomIn}>
        <SFIcon name="plus" size={16} />
      </button>
      <button type="button" className="map-tool" title="Zoom to fit (⌘0)" aria-label="Zoom to fit" onClick={onFit}>
        <SFIcon name="map.fit" size={16} />
      </button>
      <span className="map-toolbar-sep" />
      <button
        type="button"
        className={`map-tool${inspectorOpen ? ' is-active' : ''}`}
        title="Inspector"
        aria-label="Inspector"
        aria-pressed={inspectorOpen}
        onClick={onToggleInspector}
      >
        <SFIcon name="gearshape" size={16} />
      </button>
    </div>
  )
}

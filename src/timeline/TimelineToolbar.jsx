/**
 * TimelineToolbar.jsx — the tool bar across the top of a timeline view.
 *
 * Drawn in the page, like the map's, so it works in either half of a split. Under the
 * Swift shell (`timelineChrome`) it is not drawn: the window's toolbar becomes the
 * timeline's (`TimelineToolbar.swift`).
 */
import SFIcon from '../components/SFIcon'

const TIMELINE_SCALE_OPTIONS = [
  { id: 'time', label: 'By date', help: 'The chronology along the calendar' },
  { id: 'sequence', label: 'In order', help: 'The chronology, every event one step apart' },
  { id: 'manuscript', label: 'Manuscript', help: 'Passages in reading order, joined to when they happen' },
]

export default function TimelineToolbar({
  scale, onScale, onAdd, onUndo, onRedo, canUndo, canRedo, onZoomIn, onZoomOut, onFit, lensOn, onLens, inspectorOpen, onToggleInspector,
}) {
  return (
    <div className="timeline-toolbar" role="toolbar" aria-label="Timeline">
      <button type="button" className="map-tool" title="Add an event" aria-label="Add an event" onClick={onAdd}>
        <SFIcon name="plus" size={16} />
      </button>
      <span className="map-toolbar-sep" />
      <div className="timeline-segmented" role="radiogroup" aria-label="Show as">
        {TIMELINE_SCALE_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={scale === option.id}
            className={scale === option.id ? 'is-active' : ''}
            title={option.help}
            onClick={() => onScale(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <span className="map-toolbar-sep" />
      <button type="button" className="map-tool" title="Undo (⌘Z)" aria-label="Undo" disabled={!canUndo} onClick={onUndo}>
        <SFIcon name="arrow.uturn.backward" size={16} />
      </button>
      <button type="button" className="map-tool" title="Redo (⇧⌘Z)" aria-label="Redo" disabled={!canRedo} onClick={onRedo}>
        <SFIcon name="arrow.uturn.forward" size={16} />
      </button>
      <span className="map-toolbar-sep" />
      <button type="button" className="map-tool" title="Zoom out (⌘−)" aria-label="Zoom out" onClick={onZoomOut}>
        <SFIcon name="minus" size={16} />
      </button>
      <button type="button" className="map-tool" title="Zoom in (⌘+)" aria-label="Zoom in" onClick={onZoomIn}>
        <SFIcon name="plus" size={16} />
      </button>
      <button type="button" className="map-tool" title="Show everything (⌘0)" aria-label="Show everything" onClick={onFit}>
        <SFIcon name="map.fit" size={16} />
      </button>
      <span className="map-toolbar-sep" />
      <button
        type="button"
        className={`map-tool timeline-lens-toggle${lensOn ? ' is-active' : ''}`}
        title="Time lens — highlight the passages in a window of time"
        aria-label="Time lens"
        aria-pressed={lensOn}
        onClick={onLens}
      >
        <SFIcon name="timeline" size={16} />
      </button>
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

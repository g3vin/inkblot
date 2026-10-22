/**
 * TimelineToolbar.jsx — the tool bar across the top of a timeline view.
 *
 * Drawn in the page, like the map's, so it works in either half of a split. Under the
 * Swift shell (`timelineChrome`) it is not drawn: the window's toolbar becomes the
 * timeline's (`TimelineToolbar.swift`).
 */
import { Icon, Segmented } from '../ui'

const TIMELINE_SCALE_OPTIONS = [
  { value: 'time', label: 'By date', title: 'The chronology along the calendar' },
  { value: 'sequence', label: 'In order', title: 'The chronology, every event one step apart' },
  { value: 'manuscript', label: 'Manuscript', title: 'Passages in reading order, joined to when they happen' },
]

export default function TimelineToolbar({
  scale, onScale, onAdd, onUndo, onRedo, canUndo, canRedo, onZoomIn, onZoomOut, onFit, lensOn, onLens, inspectorOpen, onToggleInspector,
}) {
  return (
    <div className="timeline-toolbar" role="toolbar" aria-label="Timeline">
      <button type="button" className="map-tool" title="Add an event" aria-label="Add an event" onClick={onAdd}>
        <Icon name="add" />
      </button>
      <span className="map-toolbar-sep" />
      <Segmented label="Show as" value={scale} onChange={onScale} options={TIMELINE_SCALE_OPTIONS} />
      <span className="map-toolbar-sep" />
      <button type="button" className="map-tool" title="Undo (⌘Z)" aria-label="Undo" disabled={!canUndo} onClick={onUndo}>
        <Icon name="undo" />
      </button>
      <button type="button" className="map-tool" title="Redo (⇧⌘Z)" aria-label="Redo" disabled={!canRedo} onClick={onRedo}>
        <Icon name="redo" />
      </button>
      <span className="map-toolbar-sep" />
      <button type="button" className="map-tool" title="Zoom out (⌘−)" aria-label="Zoom out" onClick={onZoomOut}>
        <Icon name="zoom-out" />
      </button>
      <button type="button" className="map-tool" title="Zoom in (⌘+)" aria-label="Zoom in" onClick={onZoomIn}>
        <Icon name="zoom-in" />
      </button>
      <button type="button" className="map-tool" title="Show everything (⌘0)" aria-label="Show everything" onClick={onFit}>
        <Icon name="fit" />
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
        <Icon name="timeline" />
      </button>
      <button
        type="button"
        className={`map-tool${inspectorOpen ? ' is-active' : ''}`}
        title="Inspector"
        aria-label="Inspector"
        aria-pressed={inspectorOpen}
        onClick={onToggleInspector}
      >
        <Icon name="sidebar" />
      </button>
    </div>
  )
}

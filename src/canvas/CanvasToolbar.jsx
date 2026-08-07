/**
 * CanvasToolbar.jsx — the canvas's own controls, in the titlebar.
 *
 * It shares the titlebar's single toolbar slot with the text Toolbar and the two
 * take turns: editing a card's text puts the text Toolbar up, and anywhere else
 * on the canvas puts this one up. CanvasSurface portals it into that slot (see
 * canvasToolbarSlot.js), because the state behind these buttons — zoom, undo,
 * selection, the recorder — belongs to the surface.
 *
 * Because the two swap in and out of the same place, they have to look like the
 * same object: this is built from Toolbar.css's segmented groups, not from
 * styling of its own.
 *
 * With one slot and possibly two canvases on screen, only the ACTIVE pane's
 * canvas gets the toolbar; the other pane keeps its state and simply has no
 * toolbar until you click into it.
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
// The editor Toolbar's own stylesheet: this toolbar wears its .toolbar /
// .toolbar-group classes rather than restating them, so the two cannot drift.
import '../components/Toolbar.css'
import SFIcon from '../components/SFIcon'
import { formatDuration } from '../lib/audioNotes'
import { CANVAS_COLOR_PRESETS, resolveCanvasColor } from '../lib/canvasModel'

function ColorPicker({ disabled, onApplyColor }) {
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState(null)
  const rootRef = useRef(null)
  const buttonRef = useRef(null)

  useEffect(() => {
    if (!open) return

    // Close on any press outside. Capture phase, so it still fires when the press
    // lands on the surface, which stops propagation on its own handlers.
    const onPointerDown = (event) => {
      if (rootRef.current?.contains(event.target)) return
      // The menu is portaled out of the toolbar, so "outside" has to account for
      // it explicitly or clicking a swatch would close the menu before it applied.
      if (event.target.closest?.('.canvas-color-menu')) return
      setOpen(false)
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }

    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])

  const apply = (color) => {
    onApplyColor(color)
    setOpen(false)
  }

  const toggle = () => {
    const rect = buttonRef.current?.getBoundingClientRect()
    setAnchor(rect ? { top: rect.bottom + 8, left: rect.left + rect.width / 2 } : null)
    setOpen((current) => !current)
  }

  // Portaled: the toolbar scrolls and the titlebar clips its overflow, so a menu
  // rendered inside either one would be cut off.
  const menu = open && anchor ? createPortal(
    <div
      className="canvas-color-menu"
      role="menu"
      style={{ top: `${anchor.top}px`, left: `${anchor.left}px` }}
    >
      {CANVAS_COLOR_PRESETS.map((preset) => (
        <button
          key={preset.id}
          type="button"
          className="canvas-color-swatch"
          style={{ background: preset.value }}
          onClick={() => apply(preset.id)}
          aria-label={preset.label}
          title={preset.label}
        />
      ))}
      <button
        type="button"
        className="canvas-color-swatch canvas-color-swatch-none"
        style={{ background: resolveCanvasColor(null) }}
        onClick={() => apply(null)}
        aria-label="Default color"
        title="Default"
      />
    </div>,
    document.body,
  ) : null

  // No wrapper element: the button has to be a direct child of .toolbar-group to
  // pick up the shared toolbar styling. The menu is portaled anyway.
  return (
    <>
      <button
        ref={(node) => { buttonRef.current = node; rootRef.current = node }}
        type="button"
        onClick={toggle}
        disabled={disabled}
        aria-label="Color"
        aria-expanded={open}
        title="Color"
      >
        <SFIcon name="paintpalette" />
      </button>

      {menu}
    </>
  )
}

export default function CanvasToolbar({
  zoom,
  canUndo,
  canRedo,
  hasSelection,
  canGroup,
  canUngroup,
  locked,
  onToggleLocked,
  alignmentGuides,
  snapToGrid,
  onToggleAlignmentGuides,
  onToggleSnapToGrid,
  canRecord,
  isRecording,
  recordElapsed,
  onToggleRecording,
  onAddCard,
  onAddImage,
  onGroup,
  onUngroup,
  onApplyColor,
  onUndo,
  onRedo,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onZoomToFit,
}) {
  /*
   * In read mode the tools that CREATE or CHANGE things are gone, not merely disabled:
   * a row of dead buttons is just clutter, and the point of the mode is to get the
   * editing furniture out of the way so the canvas can be read. Zoom, fit and the lock
   * itself stay, because those are how you read.
   */
  return (
    <div className="toolbar canvas-toolbar">
      <div className="toolbar-group">
        <button
          type="button"
          className={locked ? 'active' : ''}
          onClick={onToggleLocked}
          aria-label={locked ? 'Unlock canvas (L)' : 'Lock canvas for reading (L)'}
          aria-pressed={!!locked}
          title={locked ? 'Editing locked — press L to edit' : 'Lock for reading (L)'}
        >
          <SFIcon name={locked ? 'lock' : 'lock.open'} filled={locked} />
        </button>
      </div>

      {locked ? null : (
        <div className="toolbar-group">
          <button type="button" onClick={onAddCard} aria-label="Add card" title="Add card">
            <SFIcon name="plus" />
          </button>

          <button type="button" onClick={onAddImage} aria-label="Add image" title="Add image">
            <SFIcon name="photo" />
          </button>

          {canRecord ? (
            <button
              type="button"
              className={`canvas-toolbar-record${isRecording ? ' is-recording' : ''}`}
              onClick={onToggleRecording}
              aria-label={isRecording ? 'Stop recording' : 'Record a voice memo'}
              title={isRecording ? 'Stop recording' : 'Record a voice memo'}
            >
              {isRecording ? (
                <>
                  <span className="audio-record-dot" aria-hidden="true" />
                  <span className="canvas-toolbar-record-time">{formatDuration(recordElapsed)}</span>
                </>
              ) : (
                <SFIcon name="mic" />
              )}
            </button>
          ) : null}

          <ColorPicker disabled={!hasSelection} onApplyColor={onApplyColor} />
        </div>
      )}

      {locked ? null : (
        <div className="toolbar-group">
          {/* Ungroup replaces Group when the selection is groups — the two are never
              both what the user means, and a toolbar this small can't afford both. */}
          {canUngroup && !canGroup ? (
            <button type="button" onClick={onUngroup} aria-label="Ungroup (⌘⇧G)" title="Ungroup (⌘⇧G)">
              <SFIcon name="rectangle.dashed" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onGroup}
              disabled={!canGroup}
              aria-label="Group (⌘G)"
              title="Group (⌘G)"
            >
              <SFIcon name="rectangle.on.rectangle" />
            </button>
          )}

          <span className="toolbar-group-divider" />

          <button type="button" onClick={onUndo} disabled={!canUndo} aria-label="Undo" title="Undo">
            <SFIcon name="arrow.up.from.dot" />
          </button>

          <button type="button" onClick={onRedo} disabled={!canRedo} aria-label="Redo" title="Redo">
            <SFIcon name="arrow.down.to.dot" />
          </button>
        </div>
      )}

      {/* How a drag settles. Read mode drags nothing, so these go with the rest of
          the editing tools. */}
      {locked ? null : (
        <div className="toolbar-group">
          <button
            type="button"
            className={alignmentGuides ? 'active' : ''}
            onClick={onToggleAlignmentGuides}
            aria-pressed={!!alignmentGuides}
            aria-label={alignmentGuides ? 'Turn off alignment guides' : 'Turn on alignment guides'}
            title={alignmentGuides ? 'Alignment guides on' : 'Alignment guides off'}
          >
            <SFIcon name="guides" filled={alignmentGuides} />
          </button>

          <button
            type="button"
            className={snapToGrid ? 'active' : ''}
            onClick={onToggleSnapToGrid}
            aria-pressed={!!snapToGrid}
            aria-label={snapToGrid ? 'Turn off snap to grid' : 'Turn on snap to grid'}
            title={snapToGrid ? 'Snap to grid on' : 'Snap to grid off'}
          >
            <SFIcon name="table.grid" filled={snapToGrid} />
          </button>
        </div>
      )}

      <div className="toolbar-group">
        <button type="button" onClick={onZoomOut} aria-label="Zoom out" title="Zoom out">
          <SFIcon name="minus" />
        </button>

        <button
          type="button"
          className="canvas-toolbar-zoom"
          onClick={onResetZoom}
          aria-label="Reset zoom to 100%"
          title="Reset zoom"
        >
          {Math.round(zoom * 100)}%
        </button>

        <button type="button" onClick={onZoomIn} aria-label="Zoom in" title="Zoom in">
          <SFIcon name="plus" />
        </button>

        <span className="toolbar-group-divider" />

        <button type="button" onClick={onZoomToFit} aria-label="Zoom to fit" title="Zoom to fit">
          <SFIcon name="frame" />
        </button>
      </div>
    </div>
  )
}

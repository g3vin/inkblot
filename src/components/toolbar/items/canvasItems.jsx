/**
 * The canvas toolbar's items. The active canvas publishes `canvasToolbarChanged`
 * while its own toolbar is up (no card being edited) and takes these back as canvas
 * commands by surface id. With no canvas state every item is there but disabled.
 */
import { useRef, useState } from 'react'
import { formatDuration } from '../../../lib/audioNotes'
import { CANVAS_COLOR_PRESETS, resolveCanvasColor } from '../../../lib/canvasModel'
import Popover from '../../../ui/Popover'
import { Glyph, ItemFrame, MenuButton, ToolButton } from '../ToolbarControls'

const command = (ctx, name, detail) => {
  const surfaceId = ctx.canvas?.surfaceId
  if (surfaceId) ctx.send('canvasCommand', { surfaceId, command: name, ...(detail ? { detail } : {}) })
}

const editing = (ctx) => Boolean(ctx.canvas) && !ctx.canvas.locked

export function CanvasLockItem({ ctx, spec }) {
  const locked = Boolean(ctx.canvas?.locked)
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <ToolButton
        symbol={locked ? 'lock' : 'lock.open'}
        label={locked ? 'Unlock Canvas' : 'Lock for Reading'}
        title={locked ? 'Editing locked — press L to edit' : 'Lock for reading (L)'}
        display={ctx.display}
        active={locked}
        disabled={!ctx.canvas}
        onClick={() => command(ctx, 'toggle-lock')}
      />
    </ItemFrame>
  )
}

export function CanvasAddCardItem({ ctx, spec }) {
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <ToolButton symbol="plus" label={spec.label} display={ctx.display} disabled={!editing(ctx)} onClick={() => command(ctx, 'add-card')} />
    </ItemFrame>
  )
}

export function CanvasAddImageItem({ ctx, spec }) {
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <ToolButton symbol="photo" label={spec.label} display={ctx.display} disabled={!editing(ctx)} onClick={() => command(ctx, 'add-image')} />
    </ItemFrame>
  )
}

export function CanvasRecordMemoItem({ ctx, spec }) {
  const recording = Boolean(ctx.canvas?.isRecording)
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <button
        type="button"
        className={`canvas-toolbar-record${recording ? ' is-recording' : ''}`}
        aria-label={recording ? 'Stop Recording' : 'Record a Voice Memo'}
        title={recording ? 'Stop recording' : 'Record a voice memo'}
        disabled={!editing(ctx) || !ctx.canvas?.canRecord}
        onClick={() => command(ctx, 'record-memo')}
      >
        {recording ? (
          <>
            <span className="audio-record-dot" aria-hidden="true" />
            <span className="canvas-toolbar-record-time">{formatDuration(ctx.canvas.recordElapsedMs || 0)}</span>
          </>
        ) : <Glyph symbol="mic" label={spec.label} display={ctx.display} />}
      </button>
    </ItemFrame>
  )
}

export function CanvasColorItem({ ctx, spec }) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef(null)
  const apply = (color) => {
    command(ctx, 'apply-color', color ? { color } : {})
    setOpen(false)
  }
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <button
        ref={anchorRef}
        type="button"
        aria-label={spec.label}
        aria-expanded={open}
        title={spec.label}
        disabled={!editing(ctx) || !ctx.canvas?.hasSelection}
        onClick={() => setOpen((was) => !was)}
      >
        <Glyph symbol="paintpalette" label={spec.label} display={ctx.display} />
      </button>
      <Popover anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} align="center" className="tb-swatches" role="menu">
        {CANVAS_COLOR_PRESETS.map((preset) => (
          <button key={preset.id} type="button" className="canvas-color-swatch" style={{ background: preset.value }} onClick={() => apply(preset.id)} aria-label={preset.label} title={preset.label} />
        ))}
        <button type="button" className="canvas-color-swatch canvas-color-swatch-none" style={{ background: resolveCanvasColor(null) }} onClick={() => apply(null)} aria-label="Default Color" title="Default" />
      </Popover>
    </ItemFrame>
  )
}

export function CanvasGroupItem({ ctx, spec }) {
  const c = ctx.canvas
  // Ungroup replaces Group when the selection is groups: never both what is meant.
  const ungroup = Boolean(c?.canUngroup && !c?.canGroup)
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <ToolButton
        symbol="rectangle.dashed"
        label={ungroup ? 'Ungroup' : 'Group'}
        title={ungroup ? 'Ungroup (⌘⇧G)' : 'Group (⌘G)'}
        display={ctx.display}
        disabled={!editing(ctx) || !(c.canGroup || c.canUngroup)}
        onClick={() => command(ctx, ungroup ? 'ungroup' : 'group')}
      />
    </ItemFrame>
  )
}

export function CanvasUndoRedoItem({ ctx, spec }) {
  const c = ctx.canvas
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <ToolButton symbol="arrow.uturn.backward" label="Undo" title="Undo (⌘Z)" display={ctx.display} disabled={!editing(ctx) || !c.canUndo} onClick={() => command(ctx, 'undo')} />
      <ToolButton symbol="arrow.uturn.forward" label="Redo" title="Redo (⇧⌘Z)" display={ctx.display} disabled={!editing(ctx) || !c.canRedo} onClick={() => command(ctx, 'redo')} />
    </ItemFrame>
  )
}

export function CanvasGuidesItem({ ctx, spec }) {
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <ToolButton symbol="guides" label={spec.label} display={ctx.display} active={Boolean(ctx.canvas?.alignmentGuides)} disabled={!editing(ctx)} onClick={() => command(ctx, 'toggle-guides')} />
    </ItemFrame>
  )
}

export function CanvasSnapItem({ ctx, spec }) {
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <ToolButton symbol="square.grid.2x2" label={spec.label} display={ctx.display} active={Boolean(ctx.canvas?.snapToGrid)} disabled={!editing(ctx)} onClick={() => command(ctx, 'toggle-grid')} />
    </ItemFrame>
  )
}

export function CanvasZoomItem({ ctx, spec }) {
  const zoom = ctx.canvas?.zoom ?? 1
  const disabled = !ctx.canvas
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <ToolButton symbol="minus.magnifyingglass" label="Zoom Out" display={ctx.display === 'label' ? 'icon' : ctx.display} disabled={disabled} onClick={() => command(ctx, 'zoom-out')} />
      <MenuButton
        label="Zoom"
        display={ctx.display}
        disabled={disabled}
        items={[
          { text: 'Zoom to Fit', accelerator: undefined, action: () => command(ctx, 'zoom-to-fit') },
          { text: 'Actual Size', action: () => command(ctx, 'reset-zoom') },
        ]}
      >
        <span className="tb-text tb-zoom-readout">{Math.round(zoom * 100)}%</span>
      </MenuButton>
      <ToolButton symbol="plus.magnifyingglass" label="Zoom In" display={ctx.display === 'label' ? 'icon' : ctx.display} disabled={disabled} onClick={() => command(ctx, 'zoom-in')} />
    </ItemFrame>
  )
}

export function CanvasDeleteItem({ ctx, spec }) {
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <ToolButton symbol="trash" label={spec.label} title="Delete (⌫)" display={ctx.display} disabled={!editing(ctx) || !ctx.canvas?.hasSelection} onClick={() => command(ctx, 'delete')} />
    </ItemFrame>
  )
}


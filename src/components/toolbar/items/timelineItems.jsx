/**
 * The timeline toolbar's items. The active timeline publishes `timelineChromeChanged`
 * and takes these back as timeline commands by surface id.
 */
import Segmented from '../../../ui/Segmented.jsx'
import { ItemFrame, ToolButton } from '../ToolbarControls'

const command = (ctx, name, detail) => {
  const surfaceId = ctx.timeline?.surfaceId
  if (surfaceId) ctx.send('timelineCommand', { surfaceId, command: name, ...(detail ? { detail } : {}) })
}

const live = (ctx) => Boolean(ctx.timeline && ctx.timeline.active !== false)

const SCALES = [
  { value: 'time', label: 'By date', title: 'The chronology along the calendar' },
  { value: 'sequence', label: 'In order', title: 'The chronology, every event one step apart' },
  { value: 'manuscript', label: 'Manuscript', title: 'Passages in reading order, joined to when they happen' },
]

export function TimelineAddItem({ ctx, spec }) {
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <ToolButton icon="add" label="Add an event" display={ctx.display} disabled={!live(ctx)} onClick={() => command(ctx, 'add-event')} />
    </ItemFrame>
  )
}

/** One choice of three, in words whatever the display mode: no glyph says "In order". */
export function TimelineShowAsItem({ ctx, spec }) {
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display} grouped={false}>
      <Segmented
        label={spec.label}
        value={ctx.timeline?.scale ?? 'time'}
        options={SCALES.map((option) => ({ ...option, disabled: !live(ctx) }))}
        onChange={(value) => command(ctx, 'scale', { value })}
      />
    </ItemFrame>
  )
}

export function TimelineUndoRedoItem({ ctx, spec }) {
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <ToolButton icon="undo" label="Undo" title="Undo (⌘Z)" display={ctx.display} disabled={!live(ctx) || !ctx.timeline.canUndo} onClick={() => command(ctx, 'undo')} />
      <ToolButton icon="redo" label="Redo" title="Redo (⇧⌘Z)" display={ctx.display} disabled={!live(ctx) || !ctx.timeline.canRedo} onClick={() => command(ctx, 'redo')} />
    </ItemFrame>
  )
}

export function TimelineZoomItem({ ctx, spec }) {
  const disabled = !live(ctx)
  const display = ctx.display === 'label' ? 'icon' : ctx.display
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <ToolButton icon="zoom-out" label="Zoom out" title="Zoom out (⌘−)" display={display} disabled={disabled} onClick={() => command(ctx, 'zoom-out')} />
      <ToolButton icon="zoom-in" label="Zoom in" title="Zoom in (⌘+)" display={display} disabled={disabled} onClick={() => command(ctx, 'zoom-in')} />
      <ToolButton icon="fit" label="Show everything" title="Show everything (⌘0)" display={display} disabled={disabled} onClick={() => command(ctx, 'fit')} />
    </ItemFrame>
  )
}

export function TimelineLensItem({ ctx, spec }) {
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <ToolButton icon="timeline" label={spec.label} title="Time lens: highlight the passages in a window of time" display={ctx.display} active={Boolean(ctx.timeline?.lensOn)} disabled={!live(ctx)} onClick={() => command(ctx, 'lens')} />
    </ItemFrame>
  )
}

export function TimelineDeleteItem({ ctx, spec }) {
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <ToolButton icon="delete" label={spec.label} display={ctx.display} disabled={!live(ctx) || !ctx.timeline.hasSelection} onClick={() => command(ctx, 'delete')} />
    </ItemFrame>
  )
}

export function TimelineInspectorItem({ ctx, spec }) {
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <ToolButton icon="sidebar" label={spec.label} display={ctx.display} active={Boolean(ctx.timeline?.inspectorOpen)} disabled={!live(ctx)} onClick={() => command(ctx, 'toggle-inspector')} />
    </ItemFrame>
  )
}

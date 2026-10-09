/**
 * The map toolbar's items. The active map publishes `mapChromeChanged` and takes
 * these back as map commands by surface id.
 */
import { MAP_TOOLS } from '../../../map/mapOptions'
import { ItemFrame, MenuButton, ToolButton } from '../ToolbarControls'

const command = (ctx, name, detail) => {
  const surfaceId = ctx.map?.surfaceId
  if (surfaceId) ctx.send('mapCommand', { surfaceId, command: name, ...(detail ? { detail } : {}) })
}

const live = (ctx) => Boolean(ctx.map && ctx.map.active !== false)

function ToolSet({ ctx, spec, ids }) {
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      {MAP_TOOLS.filter((tool) => ids.includes(tool.id)).map((tool) => (
        <ToolButton
          key={tool.id}
          icon={tool.icon}
          label={tool.label}
          title={`${tool.label} (${tool.key})`}
          display={ctx.display}
          active={ctx.map?.tool === tool.id}
          disabled={!live(ctx)}
          onClick={() => command(ctx, 'tool', { tool: tool.id })}
        />
      ))}
    </ItemFrame>
  )
}

export const MapDrawingItem = (props) => <ToolSet {...props} ids={['select', 'pin', 'route', 'region', 'label']} />
export const MapMeasureItem = (props) => <ToolSet {...props} ids={['ruler', 'area']} />

export function MapUndoRedoItem({ ctx, spec }) {
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <ToolButton icon="undo" label="Undo" title="Undo (⌘Z)" display={ctx.display} disabled={!live(ctx) || !ctx.map.canUndo} onClick={() => command(ctx, 'undo')} />
      <ToolButton icon="redo" label="Redo" title="Redo (⇧⌘Z)" display={ctx.display} disabled={!live(ctx) || !ctx.map.canRedo} onClick={() => command(ctx, 'redo')} />
    </ItemFrame>
  )
}

export function MapZoomItem({ ctx, spec }) {
  const disabled = !live(ctx)
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <ToolButton icon="zoom-out" label="Zoom out" display={ctx.display === 'label' ? 'icon' : ctx.display} disabled={disabled} onClick={() => command(ctx, 'zoom-out')} />
      <MenuButton label="Zoom" display={ctx.display} disabled={disabled} items={[{ text: 'Zoom to fit', action: () => command(ctx, 'zoom-to-fit') }]}>
        <span className="tb-text tb-zoom-readout">{ctx.map?.zoomLabel ?? '100%'}</span>
      </MenuButton>
      <ToolButton icon="zoom-in" label="Zoom in" display={ctx.display === 'label' ? 'icon' : ctx.display} disabled={disabled} onClick={() => command(ctx, 'zoom-in')} />
    </ItemFrame>
  )
}

export function MapDeleteItem({ ctx, spec }) {
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <ToolButton icon="delete" label={spec.label} display={ctx.display} disabled={!live(ctx) || !ctx.map.hasSelection} onClick={() => command(ctx, 'delete')} />
    </ItemFrame>
  )
}

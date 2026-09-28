/**
 * Items every toolbar's palette offers: shortcuts to things the inspector and the
 * tabs already have, for whoever wants them one click away. None is in a default set.
 */
import { SplitOrientation, VersionAction } from '../../../types'
import { inspectorTab } from '../../../lib/chromeLayout'
import { ItemFrame, MenuButton, ToolButton } from '../ToolbarControls'

export function SnapshotItem({ ctx, spec }) {
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <ToolButton
        symbol="clock"
        label={spec.label}
        title="Save the current state as a version you can name"
        display={ctx.display}
        disabled={!ctx.activeDoc}
        onClick={() => ctx.send('versionAction', { docPath: ctx.activeDoc, action: VersionAction.Snapshot })}
      />
    </ItemFrame>
  )
}

/** Opens the inspector on one panel, or closes it if that panel is already showing. */
export function PanelItem({ ctx, spec, tab }) {
  const on = Boolean(ctx.panel?.open && ctx.panel?.tab === tab)
  const title = inspectorTab(tab)?.title ?? spec.label
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <ToolButton symbol={spec.symbol} label={title} title={`Show the ${title} panel`} display={ctx.display} active={on} onClick={() => ctx.panel?.toggle?.(tab)} />
    </ItemFrame>
  )
}

export function TimerItem({ ctx, spec }) {
  const timer = ctx.timer
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <ToolButton
        symbol="timer"
        label={timer?.label || spec.label}
        title="Writing timer"
        display={ctx.display}
        active={Boolean(timer?.running)}
        disabled={!timer}
        onClick={() => timer?.toggle?.()}
      />
    </ItemFrame>
  )
}

export function NewTabItem({ ctx, spec }) {
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <ToolButton symbol={spec.symbol} label={spec.label} title="Open a new tab (⌘T)" display={ctx.display} disabled={!ctx.hasProject} onClick={() => ctx.send('newTab', {})} />
    </ItemFrame>
  )
}

export function SplitItem({ ctx, spec }) {
  const split = ctx.split
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <MenuButton
        symbol="rectangle.split.2x1"
        label={spec.label}
        display={ctx.display}
        disabled={!ctx.hasProject}
        items={() => [
          { text: 'Split Right', enabled: split !== 'columns', action: () => ctx.send('openInSplit', { orientation: SplitOrientation.Columns }) },
          { text: 'Split Down', enabled: split !== 'rows', action: () => ctx.send('openInSplit', { orientation: SplitOrientation.Rows }) },
          { text: 'Close Split', enabled: Boolean(split), action: () => ctx.send('closeSplit', {}) },
        ]}
      />
    </ItemFrame>
  )
}

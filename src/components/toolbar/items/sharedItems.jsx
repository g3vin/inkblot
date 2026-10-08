/**
 * Items every toolbar's palette offers: shortcuts to things the inspector and the
 * tabs already have, for whoever wants them one click away. None is in a default set.
 */
import { SplitOrientation, VersionAction } from '../../../types'
import { inspectorTab } from '../../../lib/chromeLayout'
import { ItemFrame, MenuButton, ToolButton } from '../ToolbarControls'
import Icon from '../../../ui/Icon.jsx'
import { useStats } from '../../../stats/useStats.js'
import { timerMenuItems } from '../../../stats/timerMenu.js'
import { timerClock } from '../../stats/statsText.js'

export function SnapshotItem({ ctx, spec }) {
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <ToolButton
        icon="clock"
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
      <ToolButton icon={spec.icon} label={title} title={`Show the ${title} panel`} display={ctx.display} active={on} onClick={() => ctx.panel?.toggle?.(tab)} />
    </ItemFrame>
  )
}

/**
 * The writing timer: a menu of routines while none runs, and the running segment's
 * clock while one does.
 */
export function TimerItem({ ctx, spec }) {
  const stats = useStats()
  const timer = stats.timer
  const active = timer.isActive && timer.segment
  const clock = active ? timerClock(timer, stats.now()) : null
  const icon = !active ? 'timer' : timer.state === 'paused' ? 'pause' : timer.segment.kind === 'write' ? 'edit' : 'break'
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <MenuButton
        icon={icon}
        label={spec.label}
        title={active ? 'The writing timer' : 'Start a writing timer'}
        display={ctx.display}
        items={() => timerMenuItems(stats)}
      >
        {active ? (
          <span className="tb-timer" data-state={timer.state}>
            <Icon name={icon} />
            <span className="tb-timer-clock">{clock}</span>
          </span>
        ) : undefined}
      </MenuButton>
    </ItemFrame>
  )
}

export function NewTabItem({ ctx, spec }) {
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <ToolButton icon={spec.icon} label={spec.label} title="Open a new tab (⌘T)" display={ctx.display} disabled={!ctx.hasProject} onClick={() => ctx.send('newTab', {})} />
    </ItemFrame>
  )
}

export function SplitItem({ ctx, spec }) {
  const split = ctx.split
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <MenuButton
        icon="split-columns"
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

/**
 * Paper — a project as a pile of the pages lately written in it (docs/DESIGN.md §9).
 *
 *   <PaperSheet title="Chapter two" blocks={excerpt} />
 *   <PaperPile id="Novel" label="Novel" meta="12 files · 48,200 words"
 *     sheets={[{ id, title, blocks, kind }]} menuItems={items}
 *     onOpen={(sheetId, element) => …} />
 *
 * A sheet is the document card's own paper (`--app-bg`) in miniature: its name in the
 * chrome's face at the top, its opening lines in the writer's below, ruled lines when
 * its words aren't known yet, and its kind's icon for a canvas or a map.
 *
 * A pile lies casually: each sheet's turn comes from its id, so a pile never reshuffles
 * between renders. Pointing at it (or focusing it) fans the sheets out so each can be
 * clicked; a click on a sheet opens that document, and a click anywhere else on the
 * pile, or Enter, opens the top one. Under it are the label, a typewritten meta line and
 * a ⋯ menu; a right-click offers the same items as the OS's menu.
 *
 * `dashed` draws an empty slot: one dashed outline with an icon (the "New project" pile).
 */
import { forwardRef } from 'react'
import Icon from './Icon.jsx'
import { MoreMenu } from './PanelActions.jsx'
import { popUpMenu } from './useNativeMenu.js'
import { sheetPose } from './paperPose.js'
import './Paper.css'

const RULED_LINES = [92, 84, 96, 71, 88, 63]
const KIND_ICON = { canvas: 'canvas', map: 'map', timeline: 'timeline' }

/** @param {{ title?: string, blocks?: { t: string, x: string }[] | null, kind?: string, blank?: boolean, className?: string }} props */
export const PaperSheet = forwardRef(function PaperSheet({ title, blocks, kind = 'text', blank = false, className, children, ...rest }, ref) {
  const icon = KIND_ICON[kind]
  // A document that opens on its own name as a heading doesn't need it said twice.
  const named = title && !blank && blocks?.[0]?.x?.trim().toLowerCase() !== title.trim().toLowerCase()
  return (
    <div ref={ref} className={['ib-paper-sheet', className].filter(Boolean).join(' ')} {...rest}>
      {named ? <span className="ib-paper-sheet-name">{title}</span> : null}
      {blank ? null : icon ? (
        <span className="ib-paper-sheet-kind"><Icon name={icon} size={20} /></span>
      ) : blocks?.length ? (
        <div className="ib-paper-sheet-words ib-prose">
          {blocks.map((block, index) => <p key={index} className={`is-${block.t}`}>{block.x}</p>)}
        </div>
      ) : (
        <div className="ib-paper-sheet-rules" aria-hidden="true">
          {RULED_LINES.map((width, index) => <span key={index} style={{ width: `${width}%` }} />)}
        </div>
      )}
      {children}
    </div>
  )
})

/**
 * @param {{ id: string, label: any, meta?: any, sheets?: { id: string, title?: string, blocks?: any, kind?: string, blank?: boolean }[],
 *   menuItems?: any[], menuLabel?: string, onOpen?: (sheetId: string | null, element: HTMLElement | null) => void,
 *   onPoint?: () => void, openLabel?: string, dashed?: boolean, icon?: string, active?: boolean,
 *   hiddenSheet?: string | null, className?: string, style?: object }} props
 */
export function PaperPile({
  id, label, meta, sheets = [], menuItems, menuLabel, onOpen, onPoint, openLabel,
  dashed = false, icon = 'add', active = true, hiddenSheet = null, className, style,
}) {
  const shown = sheets.slice(0, 5)
  const openTop = (event) => {
    const top = event.currentTarget.closest('.ib-paper-pile')?.querySelector('.ib-paper-sheet[data-sheet-index="0"]')
    onOpen?.(null, top ?? null)
  }
  return (
    <div
      className={['ib-paper-pile', dashed && 'is-dashed', className].filter(Boolean).join(' ')}
      style={style}
      data-pile-id={id}
      onPointerEnter={onPoint}
      onContextMenu={menuItems?.length ? (event) => popUpMenu(event, menuItems) : undefined}
    >
      <div className="ib-paper-pile-stack">
        <button
          type="button"
          className="ib-paper-pile-open"
          aria-label={openLabel ?? `Open ${typeof label === 'string' ? label : ''}`.trim()}
          tabIndex={active ? 0 : -1}
          onClick={openTop}
          onFocus={onPoint}
        />
        {dashed ? (
          <div className="ib-paper-sheet is-dashed" aria-hidden="true" onClick={openTop}>
            <Icon name={icon} size={20} />
          </div>
        ) : shown.map((sheet, index) => {
          const { rest, fan } = sheetPose(`${id}/${sheet.id}`, index, shown.length)
          return (
            <PaperSheet
              key={sheet.id}
              title={sheet.title}
              blocks={sheet.blocks}
              kind={sheet.kind}
              blank={sheet.blank}
              data-sheet-index={index}
              data-sheet-id={sheet.id}
              aria-hidden="true"
              className={hiddenSheet === sheet.id ? 'is-lifted-away' : undefined}
              style={{
                zIndex: shown.length - index,
                '--sheet-x': `${rest.x}px`,
                '--sheet-y': `${rest.y}px`,
                '--sheet-rotate': `${rest.rotate}deg`,
                '--fan-x': `${fan.x}px`,
                '--fan-y': `${fan.y}px`,
                '--fan-rotate': `${fan.rotate}deg`,
              }}
              onClick={(event) => {
                event.stopPropagation()
                onOpen?.(sheet.blank ? null : sheet.id, event.currentTarget)
              }}
            />
          )
        })}
      </div>
      <div className="ib-paper-pile-label">
        <div className="ib-paper-pile-text">
          {/* The name opens it too; a field standing in for the name (renaming) is left alone. */}
          <div className="ib-paper-pile-title" onClick={typeof label === 'string' ? openTop : undefined}>{label}</div>
          {meta ? <div className="ib-paper-pile-meta ib-meta">{meta}</div> : null}
        </div>
        {menuItems?.length ? (
          <MoreMenu label={menuLabel ?? 'More'} items={menuItems} className="ib-paper-pile-more" tabIndex={active ? 0 : -1} />
        ) : null}
      </div>
    </div>
  )
}

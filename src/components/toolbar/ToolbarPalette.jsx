/**
 * ToolbarPalette — Customize Toolbar…: every item the current toolbar can hold, drawn
 * as itself, to drag onto the page of the toolbar that shows; the toolbar's pages, to
 * add and remove; the default set to drag in whole; and how the toolbar shows its items.
 */
import { DEFAULT_TOOLBARS, FLEXIBLE_SPACE, PAGE, SPACE, toolbarItemsFor } from '../../lib/chromeLayout'
import { Button, Dialog, SelectMenu } from '../../ui'
import Icon from '../../ui/Icon.jsx'
import ToolbarItem from './ToolbarItem'
import { inToolbar } from './toolbarEdits'

const DISPLAY_OPTIONS = [
  { value: 'iconAndLabel', label: 'Icon and text' },
  { value: 'icon', label: 'Icon only' },
  { value: 'label', label: 'Text only' },
]

const CONTEXT_TITLES = { document: 'the document toolbar', canvas: 'the canvas toolbar', map: 'the map toolbar', timeline: 'the timeline toolbar', typeset: 'the Typeset toolbar' }

export default function ToolbarPalette({ context, items, ctx, display, page, pageCount, onAddPage, onRemovePage, onDisplay, onReset, onDragStart, onClose }) {
  const offered = [
    ...toolbarItemsFor(context).map((spec) => ({ id: spec.id, label: spec.label })),
    { id: SPACE, label: 'Space' },
    { id: FLEXIBLE_SPACE, label: 'Flexible space' },
    { id: PAGE, label: 'Page break' },
  ]
  // Items are previews: drawn by their real components, inert, and as they look when
  // they can act — a palette of disabled items would show nothing of what they are.
  const previewCtx = {
    ...ctx,
    toolbar: { ...ctx.toolbar, target: ctx.toolbar.target ?? 'primary' },
    canvas: ctx.canvas ?? { surfaceId: '', zoom: 1, locked: false, canGroup: true, hasSelection: true, canUndo: true, canRedo: true, canRecord: true },
    map: ctx.map ?? { surfaceId: '', tool: 'select', zoomLabel: '100%', canUndo: true, canRedo: true, hasSelection: true },
    timeline: ctx.timeline ?? { surfaceId: '', scale: 'time', canUndo: true, canRedo: true, hasSelection: true, lensOn: false, inspectorOpen: false },
    layout: ctx.layout ?? { docPath: 'preview', mode: context === 'typeset' ? 'typeset' : 'write', zoom: 1, paragraph: {} },
    activeDoc: ctx.activeDoc ?? 'preview',
    hasProject: true,
    send: () => {},
    editor: null,
    display: 'icon',
  }

  return (
    <Dialog
      eyebrow="Toolbar"
      title={`Drag the items you use into ${CONTEXT_TITLES[context] ?? 'the toolbar'}`}
      size="large"
      placement="top"
      onClose={onClose}
      className="tb-palette"
      footer={(
        <>
          <label className="tb-palette-show">
            Show
            <SelectMenu value={display} onChange={onDisplay} options={DISPLAY_OPTIONS} label="Show" />
          </label>
          <Button variant="plain" onClick={onReset}>Restore default set</Button>
          <span className="ib-dialog-footer-spacer" />
          <Button variant="filled" onClick={onClose}>Done</Button>
        </>
      )}
    >
      <div className="tb-palette-grid" role="list">
        {offered.map(({ id, label }) => {
          const used = inToolbar(items, id)
          return (
            <div
              key={id}
              role="listitem"
              className={`tb-palette-item${used ? ' is-used' : ''}`}
              title={used ? `${label} is in the toolbar` : `Drag ${label} into the toolbar`}
              onPointerDown={used ? undefined : (event) => onDragStart(event, id, { kind: 'palette', id })}
            >
              <div className="tb-palette-preview" aria-hidden="true" inert>
                {id === SPACE ? <span className="tb-palette-space" />
                  : id === FLEXIBLE_SPACE ? <span className="tb-palette-space is-flexible" />
                    : id === PAGE ? <span className="tb-palette-page"><Icon name="chevron-right" size={16} /></span>
                      : <ToolbarItem id={id} ctx={previewCtx} />}
              </div>
              <span className="tb-palette-label">{label}</span>
            </div>
          )
        })}
      </div>
      <div className="tb-palette-pages">
        <span className="ib-meta">Page {page + 1} of {pageCount}</span>
        <Button variant="plain" icon="add" onClick={onAddPage}>Add page</Button>
        <Button variant="plain" icon="delete" disabled={pageCount < 2} onClick={onRemovePage}>Remove this page</Button>
      </div>
      <p className="tb-palette-hint">Swipe the toolbar to work on another page, or drop an item on a page’s dot to move it there. Or drag the default set in whole.</p>
      <div
        className="tb-palette-defaults"
        title="Drag the default set into the toolbar"
        onPointerDown={(event) => onDragStart(event, 'defaults', { kind: 'defaults', items: DEFAULT_TOOLBARS[context] })}
      >
        {DEFAULT_TOOLBARS[context].filter((id) => id !== PAGE).map((id, index) => (
          <div key={`${id}:${index}`} className={`tb-palette-defaults-item${id === FLEXIBLE_SPACE ? ' is-flexible' : ''}`} aria-hidden="true" inert>
            {id === SPACE || id === FLEXIBLE_SPACE ? <span className="tb-space" /> : <ToolbarItem id={id} ctx={previewCtx} />}
          </div>
        ))}
      </div>
    </Dialog>
  )
}

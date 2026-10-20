/**
 * InspectorLayoutEditor — Customize Inspector Layout…: what Write's panels and
 * Typeset's are, side by side. Each row shows or hides a panel; the shown ones drag
 * to reorder and stay ahead of the hidden ones. The last panel a layout shows cannot
 * be hidden. Every change is saved as it is made.
 */
import { useRef } from 'react'
import Icon from '../../ui/Icon.jsx'
import { Button, Dialog } from '../../ui'
import usePointerReorder from '../../ui/usePointerReorder'
import { popUpNativeMenu } from '../../ui/useNativeMenu'
import { INSPECTOR_LAYOUT_INFO, INSPECTOR_LAYOUT_KINDS, inspectorTab, rowsFor, tabsOf } from '../../lib/chromeLayout'
import { useInspectorLayouts } from './useInspectorLayout'
import './InspectorLayout.css'

function LayoutColumn({ layout, layouts, setShown, move }) {
  const listRef = useRef(null)
  const shown = tabsOf(layouts, layout)
  const rows = rowsFor(layouts, layout)
  const drag = usePointerReorder({
    listRef,
    itemSelector: '[data-reorder-id]',
    axis: 'y',
    onDrop: ({ id, inside, index }) => {
      if (!inside) return
      const from = rows.indexOf(id)
      // The index counts the rows left once the dragged one is lifted; moveTab wants
      // one into the list as it was.
      const to = index >= from ? index + 1 : index
      move(layout, from, to)
    },
  })
  const info = INSPECTOR_LAYOUT_INFO[layout]

  return (
    <section className="inspector-editor-column" aria-label={`${info.title} panels`}>
      <h3 className="inspector-editor-title"><Icon name={info.icon} /> {info.title}</h3>
      <ul ref={listRef} className="inspector-editor-rows">
        {rows.map((tab) => {
          const spec = inspectorTab(tab)
          const isShown = shown.includes(tab)
          const onlyOne = isShown && shown.length === 1
          const dragging = drag.dragging === tab
          return (
            <li
              key={tab}
              className={`inspector-editor-row${isShown ? '' : ' is-hidden'}${dragging ? ' is-dragging' : ''}${shown.at(-1) === tab && shown.length < rows.length ? ' is-last-shown' : ''}`}
              data-reorder-id={isShown ? tab : undefined}
            >
              <input
                type="checkbox"
                checked={isShown}
                disabled={onlyOne}
                aria-label={`Show ${spec.title}`}
                title={onlyOne ? 'A layout shows at least one panel' : undefined}
                onChange={(event) => setShown(layout, tab, event.target.checked)}
              />
              <Icon name={spec.icon} />
              <span className="inspector-editor-row-title">{spec.title}</span>
              {isShown ? (
                <span
                  className="inspector-editor-handle"
                  aria-label={`Drag to reorder ${spec.title}`}
                  onPointerDown={(event) => drag.onPointerDown(event, tab)}
                >
                  <Icon name="list" />
                </span>
              ) : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export default function InspectorLayoutEditor({ onClose }) {
  const { layouts, setShown, move, restore } = useInspectorLayouts()
  return (
    <Dialog
      eyebrow="Inspector"
      title="Customize inspector layout"
      size="medium"
      onClose={onClose}
      className="inspector-editor"
      footer={(
        <>
          <Button
            variant="plain"
            onClick={(event) => popUpNativeMenu(event, [
              { text: 'Both layouts', action: () => restore('both') },
              { text: 'Write', action: () => restore('drafting') },
              { text: 'Typeset', action: () => restore('finishing') },
            ])}
          >
            Restore Defaults…
          </Button>
          <span className="ib-dialog-footer-spacer" />
          <Button variant="filled" onClick={onClose}>Done</Button>
        </>
      )}
    >
      <p className="inspector-editor-hint">Choose the panels each layout shows, and drag them into order. Write’s are up while you write, Typeset’s while you typeset.</p>
      <div className="inspector-editor-columns">
        {INSPECTOR_LAYOUT_KINDS.map((layout) => (
          <LayoutColumn key={layout} layout={layout} layouts={layouts} setShown={setShown} move={move} />
        ))}
      </div>
    </Dialog>
  )
}

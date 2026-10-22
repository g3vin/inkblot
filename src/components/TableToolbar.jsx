/**
 * TableToolbar — the tools for the table the caret is in, floating over its top edge.
 *
 * On the surface: rows and columns in and out, merging and splitting cells, a cell's
 * fill and the table's borders. One click away, in More: header row and column, a
 * cell's alignment, and deleting the table. Every one is also a command while the
 * caret is in a table, so ⌘K finds them and the keyboard reaches them.
 *
 * Each acts on the editor it was given (one toolbar per pane) through the table
 * extensions' own commands and TableStyles.js. It shows while that editor has the
 * caret in a table and is not holding a locked document, and while one of its menus
 * is open; it sits above the table, kept inside the pane as the table scrolls.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button, FloatingToolbar, IconButton, InkPicker, Menu, MenuItem, MenuSeparator, Popover, ToolbarSeparator } from '../ui'
import { useCommands } from '../lib/commands'
import { TABLE_BORDERS, tableAt } from '../extensions/TableStyles'
import './TableToolbar.css'

const BORDER_LABELS = { all: 'All borders', outer: 'Outside only', inner: 'Inside only', none: 'No borders' }
const BORDER_COMMANDS = { all: 'Show all table borders', outer: 'Show only the table’s outside border', inner: 'Show only the lines inside the table', none: 'Hide the table’s borders' }
const GAP = 8

/** What the toolbar reads off the editor: whether to show, and what is on. */
function readTable(editor) {
  if (!editor || editor.isDestroyed) return null
  const table = tableAt(editor)
  if (!table || editor.storage?.documentLock?.locked) return null
  return {
    pos: table.pos,
    borders: table.node.attrs.borders || 'all',
    fill: editor.getAttributes('tableCell').fill ?? editor.getAttributes('tableHeader').fill ?? null,
    // TextAlign sets a cell and its paragraphs together.
    align: editor.getAttributes('paragraph').textAlign || 'left',
    headerRow: table.node.firstChild?.firstChild?.type.name === 'tableHeader',
    headerColumn: Boolean(table.node.childCount) && [...Array(table.node.childCount).keys()]
      .every((index) => table.node.child(index).firstChild?.type.name === 'tableHeader'),
    canMerge: editor.can().mergeCells(),
    canSplit: editor.can().splitCell(),
  }
}

export default function TableToolbar({ editor }) {
  const [table, setTable] = useState(null)
  const [focused, setFocused] = useState(false)
  const [menu, setMenu] = useState(null)
  const [position, setPosition] = useState(null)
  const barRef = useRef(null)
  const fillRef = useRef(null)
  const bordersRef = useRef(null)
  const moreRef = useRef(null)

  // Follow the editor: its selection, its document, its focus.
  useEffect(() => {
    if (!editor) return undefined
    const update = () => {
      setTable(readTable(editor))
      setFocused(editor.isFocused || Boolean(barRef.current?.contains(document.activeElement)))
    }
    update()
    const events = ['transaction', 'selectionUpdate', 'focus', 'blur']
    events.forEach((name) => editor.on(name, update))
    // Focus moving between the toolbar and anything else is not the editor's to report.
    document.addEventListener('focusin', update)
    return () => {
      events.forEach((name) => editor.off(name, update))
      document.removeEventListener('focusin', update)
    }
  }, [editor])

  const shown = Boolean(table && (focused || menu))

  // Over the table's top edge, inside the pane.
  const place = useCallback(() => {
    if (!shown || !editor || editor.isDestroyed) return
    const wrapper = editor.view.nodeDOM(table.pos)
    const bar = barRef.current
    if (!(wrapper instanceof Element) || !bar) return
    const rect = wrapper.getBoundingClientRect()
    const paneElement = editor.view.dom.closest('.pane')
    const pane = paneElement?.getBoundingClientRect() ?? { top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight }
    const width = bar.offsetWidth
    const height = bar.offsetHeight
    // Clear of the window's toolbar: above the table if there is room, else below it,
    // else at the top of the pane's free space, over the table.
    const titlebar = parseFloat(getComputedStyle(paneElement ?? document.documentElement).getPropertyValue('--app-titlebar-height')) || 0
    const minTop = pane.top + titlebar + GAP
    const above = rect.top - height - GAP
    const below = rect.bottom + GAP
    const top = above >= minTop ? above : below + height <= pane.bottom - GAP ? Math.max(below, minTop) : minTop
    const left = Math.min(Math.max(rect.left, pane.left + GAP), pane.right - width - GAP)
    setPosition({ top, left })
  }, [editor, shown, table])

  useLayoutEffect(() => {
    place()
  }, [place])

  useEffect(() => {
    if (!shown) return undefined
    let frame = 0
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(place)
    }
    window.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
    }
  }, [place, shown])

  const run = useCallback((build) => {
    if (!editor || editor.isDestroyed) return
    build(editor.chain().focus()).run()
  }, [editor])

  const actions = useCallback(() => ({
    rowAbove: () => run((chain) => chain.addRowBefore()),
    rowBelow: () => run((chain) => chain.addRowAfter()),
    deleteRow: () => run((chain) => chain.deleteRow()),
    columnLeft: () => run((chain) => chain.addColumnBefore()),
    columnRight: () => run((chain) => chain.addColumnAfter()),
    deleteColumn: () => run((chain) => chain.deleteColumn()),
    merge: () => run((chain) => chain.mergeCells()),
    split: () => run((chain) => chain.splitCell()),
    headerRow: () => run((chain) => chain.toggleHeaderRow()),
    headerColumn: () => run((chain) => chain.toggleHeaderColumn()),
    align: (alignment) => run((chain) => chain.setTextAlign(alignment)),
    fill: (ink) => run((chain) => chain.setCellAttribute('fill', ink)),
    borders: (borders) => run((chain) => chain.setTableBorders(borders)),
    deleteTable: () => run((chain) => chain.deleteTable()),
  }), [run])

  useCommands(() => {
    if (!shown) return []
    const act = actions()
    const command = (id, title, icon, runIt, extra = {}) => ({ id: `table.${id}`, section: 'Table', title, icon, run: runIt, ...extra })
    return [
      command('row-above', 'Add row above', 'row-above', act.rowAbove),
      command('row-below', 'Add row below', 'row-below', act.rowBelow),
      command('row-delete', 'Delete row', 'row-delete', act.deleteRow),
      command('column-left', 'Add column left', 'column-left', act.columnLeft),
      command('column-right', 'Add column right', 'column-right', act.columnRight),
      command('column-delete', 'Delete column', 'column-delete', act.deleteColumn),
      command('merge', 'Merge cells', 'cell-merge', act.merge, { when: () => Boolean(editor?.can().mergeCells()) }),
      command('split', 'Split cell', 'cell-split', act.split, { when: () => Boolean(editor?.can().splitCell()) }),
      command('header-row', 'Toggle header row', 'table', act.headerRow, { keywords: ['heading', 'title row'] }),
      command('header-column', 'Toggle header column', 'table', act.headerColumn, { keywords: ['heading'] }),
      command('fill-none', 'Clear cell fill', 'cell-fill', () => act.fill(null), { keywords: ['colour', 'background', 'shading'] }),
      ...TABLE_BORDERS.map((borders) => command(`borders-${borders}`, BORDER_COMMANDS[borders], 'borders', () => act.borders(borders), { keywords: ['lines', 'grid', 'frame'] })),
      command('delete', 'Delete table', 'delete', act.deleteTable),
    ]
  }, [actions, editor, shown])

  if (!shown) return null
  const act = actions()
  const closeMenu = () => setMenu(null)

  return createPortal(
    <div
      ref={barRef}
      className="table-toolbar"
      style={position ? { top: position.top, left: position.left } : { visibility: 'hidden' }}
      // Clicking a tool must not take the caret out of the table.
      onMouseDown={(event) => { if (!event.target.closest('input')) event.preventDefault() }}
    >
      <FloatingToolbar label="Table">
        <IconButton icon="row-above" label="Add row above" size="capsule" onClick={act.rowAbove} />
        <IconButton icon="row-below" label="Add row below" size="capsule" onClick={act.rowBelow} />
        <IconButton icon="delete" label="Delete row" size="capsule" onClick={act.deleteRow} />
        <ToolbarSeparator />
        <IconButton icon="column-left" label="Add column left" size="capsule" onClick={act.columnLeft} />
        <IconButton icon="column-right" label="Add column right" size="capsule" onClick={act.columnRight} />
        <IconButton icon="delete" label="Delete column" size="capsule" onClick={act.deleteColumn} />
        <ToolbarSeparator />
        <IconButton icon="cell-merge" label="Merge cells" size="capsule" disabled={!table.canMerge} onClick={act.merge} />
        <IconButton icon="cell-split" label="Split cell" size="capsule" disabled={!table.canSplit} onClick={act.split} />
        <ToolbarSeparator />
        <IconButton ref={fillRef} icon="cell-fill" label="Cell fill" size="capsule" filled={Boolean(table.fill)} aria-haspopup="dialog" aria-expanded={menu === 'fill'} onClick={() => setMenu(menu === 'fill' ? null : 'fill')} />
        <IconButton ref={bordersRef} icon="borders" label="Borders" size="capsule" aria-haspopup="menu" aria-expanded={menu === 'borders'} onClick={() => setMenu(menu === 'borders' ? null : 'borders')} />
        <IconButton ref={moreRef} icon="more" label="More table tools" size="capsule" aria-haspopup="menu" aria-expanded={menu === 'more'} onClick={() => setMenu(menu === 'more' ? null : 'more')} />
      </FloatingToolbar>

      <Popover anchorRef={fillRef} open={menu === 'fill'} onClose={closeMenu} className="table-fill-popover">
        <InkPicker label="Cell fill" value={table.fill} onChange={(ink) => act.fill(ink)} />
        <Button disabled={!table.fill} onClick={() => act.fill(null)}>No fill</Button>
      </Popover>

      <Menu open={menu === 'borders'} onClose={closeMenu} anchorRef={bordersRef} label="Borders">
        {TABLE_BORDERS.map((borders) => (
          <MenuItem key={borders} checked={table.borders === borders} onSelect={() => act.borders(borders)}>
            {BORDER_LABELS[borders]}
          </MenuItem>
        ))}
      </Menu>

      <Menu open={menu === 'more'} onClose={closeMenu} anchorRef={moreRef} label="More table tools">
        <MenuItem checked={table.headerRow} onSelect={act.headerRow}>Header row</MenuItem>
        <MenuItem checked={table.headerColumn} onSelect={act.headerColumn}>Header column</MenuItem>
        <MenuSeparator />
        <MenuItem icon="align-left" checked={table.align === 'left'} onSelect={() => act.align('left')}>Align left</MenuItem>
        <MenuItem icon="align-center" checked={table.align === 'center'} onSelect={() => act.align('center')}>Align center</MenuItem>
        <MenuItem icon="align-right" checked={table.align === 'right'} onSelect={() => act.align('right')}>Align right</MenuItem>
        <MenuSeparator />
        <MenuItem icon="delete" danger onSelect={act.deleteTable}>Delete table</MenuItem>
      </Menu>
    </div>,
    document.body,
  )
}

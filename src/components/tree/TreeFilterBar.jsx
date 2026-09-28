/**
 * TreeFilterBar — the field under the file tree, as Xcode's navigator has under its
 * lists (FileTreeSidebar.swift's FilterBar): a menu of what to show, the text to
 * match, and buttons for recent files and expanding every folder.
 */
import { useRef } from 'react'
import SFIcon from '../SFIcon'
import { popUpNativeMenu } from '../../ui/useNativeMenu.js'
import { TREE_KINDS } from '../../lib/treeFilter'
import './TreeFilterBar.css'

export default function TreeFilterBar({ filter, onChange, onToggleFolders }) {
  const inputRef = useRef(null)
  const set = (patch) => onChange({ ...filter, ...patch })
  return (
    <div className="tree-filter floating-capsule" onClick={(event) => { if (event.target === event.currentTarget) inputRef.current?.focus() }}>
      <button
        type="button"
        className="tree-filter-button"
        data-on={filter.kind !== 'all'}
        aria-label="Filter Options"
        title="Filter Options"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          popUpNativeMenu({ preventDefault() {}, stopPropagation() {}, clientX: rect.left, clientY: rect.top },
            TREE_KINDS.map(({ value, label }) => ({ text: label, checked: filter.kind === value, action: () => set({ kind: value }) })))
        }}
      >
        <SFIcon name="line.3.horizontal.decrease.circle" size={13} />
      </button>
      <input
        ref={inputRef}
        className="tree-filter-input"
        aria-label="Filter"
        placeholder="Filter"
        value={filter.text}
        onChange={(event) => set({ text: event.target.value })}
        onKeyDown={(event) => { if (event.key === 'Escape') set({ text: '' }) }}
      />
      {filter.text ? (
        <button type="button" className="tree-filter-button" aria-label="Clear Filter" title="Clear Filter" onClick={() => set({ text: '' })}>
          <SFIcon name="xmark" size={10} />
        </button>
      ) : null}
      <button
        type="button"
        className="tree-filter-button"
        data-on={filter.recentOnly}
        aria-pressed={filter.recentOnly}
        aria-label="Show Only Recent Files"
        title="Show Only Recent Files"
        onClick={() => set({ recentOnly: !filter.recentOnly })}
      >
        <SFIcon name="clock" size={13} />
      </button>
      <button type="button" className="tree-filter-button" aria-label="Expand or Collapse All Folders" title="Expand or Collapse All Folders" onClick={onToggleFolders}>
        <SFIcon name="plusminus.circle" size={13} />
      </button>
    </div>
  )
}

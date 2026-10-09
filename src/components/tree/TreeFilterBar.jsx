/**
 * TreeFilterBar — the field under the file tree, as Xcode's navigator has under its
 * lists (FileTreeSidebar.swift's FilterBar): a menu of what to show, the text to
 * match, and buttons for recent files and expanding every folder.
 */
import { useRef } from 'react'
import Icon from '../../ui/Icon.jsx'
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
        aria-label="Filter options"
        title="Filter options"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          popUpNativeMenu({ preventDefault() {}, stopPropagation() {}, clientX: rect.left, clientY: rect.top },
            TREE_KINDS.map(({ value, label }) => ({ text: label, checked: filter.kind === value, action: () => set({ kind: value }) })))
        }}
      >
        <Icon name="filter" />
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
        <button type="button" className="tree-filter-button" aria-label="Clear filter" title="Clear filter" onClick={() => set({ text: '' })}>
          <Icon name="close" />
        </button>
      ) : null}
      <button
        type="button"
        className="tree-filter-button"
        data-on={filter.recentOnly}
        aria-pressed={filter.recentOnly}
        aria-label="Show only recent files"
        title="Show only recent files"
        onClick={() => set({ recentOnly: !filter.recentOnly })}
      >
        <Icon name="clock" />
      </button>
      <button type="button" className="tree-filter-button" aria-label="Expand or collapse all folders" title="Expand or collapse all folders" onClick={onToggleFolders}>
        <Icon name="plus-minus" />
      </button>
    </div>
  )
}

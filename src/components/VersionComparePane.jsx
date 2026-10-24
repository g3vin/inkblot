/**
 * VersionComparePane.jsx — side-by-side comparison of any two document states,
 * git style, with merge. Rendered inside the editor area rather than over it:
 * comparing is a way of reading the document, so it takes the editor's own space
 * and leaves the rest of the app (sidebars, tabs, titlebar) usable around it.
 *
 * Either side can be any version checkpoint or the current document. Text
 * documents diff paragraph-by-paragraph (unchanged runs collapse like a git hunk
 * header; changed runs show word-level marks). Canvases diff card-by-card: added
 * / removed / edited / moved cards and arrows. Maps diff item-by-item (places,
 * routes, regions, labels, travelers, …) and section-by-section for the settings
 * that belong to the whole map (style, scale, timeline, …) — see lib/map/mapDiff.js.
 *
 * Merge mode puts a Left/Right (or Both, for text) choice on every difference and
 * builds a new state from the answers — applied straight to the open document
 * (with a safety checkpoint first, and the result saved as a named "Merged"
 * version) or written out as a brand-new document.
 *
 * The controls live in the titlebar, portaled into the slot the text and canvas
 * toolbars share (see compareToolbarSlot.js), so version options sit exactly
 * where every other toolbar in the app does.
 */
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { generateJSON } from '@tiptap/core'
import {
  appendVersionEntry,
  buildCanvasVersionEntry,
  buildMapVersionEntry,
  buildTextVersionEntry,
  createDocumentFromVersion,
  getVersions,
  loadDocument,
} from '../lib/FileSystem'
import { getDocPreviewExtensions } from '../lib/editorExtensions'
import { readDocPageSetup, setContentKeepingPageSetup, withPageSetup } from '../print/DocPageSetup'
import { getDocDisplayName, isCanvasDoc, isMapDoc } from '../lib/docKind'
import { countMapWords, isMapPayload, normalizeMap } from '../lib/map/mapModel'
import {
  MAP_COLLECTIONS,
  MAP_SETTINGS,
  briefValue,
  changedKeys,
  diffMaps,
  mapChangeKey,
  mapItemTitle,
  mergeMaps,
} from '../lib/map/mapDiff'
import {
  canvasNodeText,
  countCanvasWords,
  diffCanvases,
  diffHtmlDocuments,
  diffWords,
  formatFullTimestamp,
  htmlToText,
  mergeCanvases,
  mergeChunksToHtml,
  textWords,
  wordDelta,
} from '../lib/versionHistory'
import { dispatchCanvasRestore } from '../canvas/canvasEvents'
import { dispatchMapRestore } from '../map/mapEvents'
import { CompareToolbarSlotContext } from './compareToolbarSlot'
import Icon from '../ui/Icon.jsx'
import { Skeleton, SkeletonOverlay, SkeletonRows } from '../ui/Reveal.jsx'
import { useReveal } from '../ui/revealState.js'
import './VersionComparePane.css'

const CURRENT = 'current'

// Matches the split-pane clamp: neither column may be squeezed out of reach.
const MIN_RATIO = 0.2
const MAX_RATIO = 0.8

// Must track --vcp-pad in VersionComparePane.css: the drag inverts the same mapping
// the stylesheet uses to place the divider.
const COLUMN_PADDING = 16

const sideLabel = (entry) => entry.name || formatFullTimestamp(entry.timestamp)

/** A map as the diff reads it: normalized, so a raw file and its saved form agree. */
const readMap = (raw) => (isMapPayload(raw) ? normalizeMap(raw) : null)

// What a map item's fields are called in a compare row; anything else shows its key.
const MAP_FIELD_LABELS = {
  at: 'position',
  body: 'on body',
  nodes: 'stops',
  rings: 'outline',
  doc: 'linked document',
  legs: 'journey',
  startPin: 'starts at',
  startDay: 'start day',
  startOffset: 'along route',
  kmPerUnit: 'km per unit',
  displayUnit: 'unit',
  kmh: 'speed (km/h)',
  hoursPerDay: 'hours a day',
  minZoom: 'shown from zoom',
  maxZoom: 'hidden past zoom',
}

const mapCollection = (key) => MAP_COLLECTIONS.find((entry) => entry.key === key)
const mapSettingLabel = (key) => MAP_SETTINGS.find((entry) => entry.key === key)?.label || key

/** Word-diff tokens rendered for one side: equal + this side's own changes. */
function DiffText({ ops, side }) {
  const keep = side === 'left' ? 'removed' : 'added'
  return (
    <p className="vcp-difftext">
      {ops.map((op, index) => {
        if (op.type === 'equal') return <span key={index}>{op.tokens.join(' ')} </span>
        if (op.type !== keep) return null
        return op.type === 'removed'
          ? <del key={index} className="vcp-mark-removed">{op.tokens.join(' ')} </del>
          : <mark key={index} className="vcp-mark-added">{op.tokens.join(' ')} </mark>
      })}
    </p>
  )
}

/**
 * The keep/discard choice on one difference, in merge mode.
 *
 * One toggle per column, each centered under the side it acts on, rather than a
 * segmented control in the middle: the divider runs down the centre line, and a
 * control sitting on it belongs to neither side while covering both.
 *
 * For text, both sides can be kept at once ('both'); the toggles behave as
 * checkboxes and the last one standing cannot be switched off — a difference has
 * to resolve to something. For canvas cards and map items there is no "both" (a
 * card is either the old one or the new one), so they behave as a radio pair.
 */
function ChoicePicker({ value, onChange, allowBoth = false }) {
  const leftOn = value === 'left' || value === 'both'
  const rightOn = value === 'right' || value === 'both'

  const toggle = (side) => {
    if (!allowBoth) {
      onChange(side)
      return
    }
    const isOn = side === 'left' ? leftOn : rightOn
    const otherOn = side === 'left' ? rightOn : leftOn

    if (isOn && !otherOn) return // keeping neither side is not a choice
    if (isOn) onChange(side === 'left' ? 'right' : 'left')
    else onChange(otherOn ? 'both' : side)
  }

  const button = (side, on) => (
    <button
      className={`vcp-keep${on ? ' is-on' : ''}`}
      role={allowBoth ? 'checkbox' : 'radio'}
      aria-checked={on}
      aria-label={`Keep the ${side} side`}
      onClick={() => toggle(side)}
    >
      {on ? <Icon name="check" /> : null}
      {on ? 'Keeping' : 'Keep'} {side}
    </button>
  )

  return (
    <div
      className="vcp-choice-row"
      role={allowBoth ? 'group' : 'radiogroup'}
      aria-label="Which side to keep"
    >
      {button('left', leftOn)}
      {button('right', rightOn)}
    </div>
  )
}

export default function VersionComparePane({
  projectName,
  docName,
  editor,
  initialLeftId,
  initialRightId,
  onClose,
  refreshFiles,
  onOpenDocInTab,
  setVersions,
  initialVersions,
}) {
  const isCanvas = isCanvasDoc(docName)
  const isMap = isMapDoc(docName)
  // A canvas or a map: listed difference by difference, with no editor behind it.
  const isStructured = isCanvas || isMap
  const toolbarSlot = useContext(CompareToolbarSlotContext)

  // The open document's versions, when the pane that opened it already holds them:
  // the comparison is then right on its first frame, with no read.
  const [versions, setLocalVersions] = useState(() => (Array.isArray(initialVersions) ? initialVersions : []))
  // Until the versions are read, a side naming one has nothing to show, and a diff
  // drawn from that would be wrong; whose list `versions` is says when it is right.
  const [versionsReadFor, setVersionsReadFor] = useState(() => (Array.isArray(initialVersions) ? docName : null))
  const [leftId, setLeftId] = useState(String(initialLeftId ?? CURRENT))
  const [rightId, setRightId] = useState(String(initialRightId ?? CURRENT))
  const [mergeMode, setMergeMode] = useState(false)
  const [choices, setChoices] = useState({})
  const [expandedEqual, setExpandedEqual] = useState(() => new Set())
  const [currentCanvas, setCurrentCanvas] = useState(null)
  const [currentMap, setCurrentMap] = useState(null)
  const [busy, setBusy] = useState(false)
  const [ratio, setRatio] = useState(0.5)
  const [resizing, setResizing] = useState(false)
  const bodyRef = useRef(null)

  /* ---------------- version list ---------------- */

  const refreshVersions = useCallback(async () => {
    if (!projectName || !docName) return
    try {
      const next = await getVersions(projectName, docName)
      setLocalVersions(next || [])
      setVersions?.(docName, next || [])
    } catch {
      void 0
    } finally {
      setVersionsReadFor(docName)
    }
  }, [docName, projectName, setVersions])

  const initialVersionsRef = useRef(initialVersions)
  useEffect(() => {
    // Given the versions, the `versions:changed` listener below is what keeps them current.
    if (Array.isArray(initialVersionsRef.current)) return
    void refreshVersions()
  }, [refreshVersions])

  useEffect(() => {
    const handler = (event) => {
      const detail = event?.detail || {}
      if (detail.projectName !== projectName || detail.docName !== docName) return
      void refreshVersions()
    }
    window.addEventListener('versions:changed', handler)
    return () => window.removeEventListener('versions:changed', handler)
  }, [docName, projectName, refreshVersions])

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose?.()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

  // The "current" side of a canvas or map is whatever autosave last wrote (≤1s stale).
  useEffect(() => {
    if (!isStructured) return undefined
    let cancelled = false
    ;(async () => {
      const raw = await loadDocument(projectName, docName)
      if (cancelled) return
      if (isMap) setCurrentMap(readMap(raw))
      else setCurrentCanvas(raw)
    })()
    return () => {
      cancelled = true
    }
  }, [isMap, isStructured, projectName, docName])

  // A new pair of sides is a new comparison: stale choices must not apply.
  useEffect(() => {
    setChoices({})
    setExpandedEqual(new Set())
  }, [leftId, rightId])

  const byId = useMemo(() => {
    const map = new Map()
    for (const entry of versions || []) map.set(String(entry.id), entry)
    return map
  }, [versions])

  // Normalized once per list, not per render: normalizing gives an item without an id
  // a fresh one, and a fresh id every render would make every item look new.
  const mapsById = useMemo(() => {
    const out = new Map()
    if (!isMap) return out
    for (const entry of versions || []) {
      if (entry.map) out.set(String(entry.id), readMap(entry.map))
    }
    return out
  }, [isMap, versions])

  const resolveSide = useCallback((id) => {
    if (isMap) {
      if (id === CURRENT) return { label: 'Current map', map: currentMap }
      const entry = byId.get(id)
      if (!entry) return { label: '—', map: null }
      return { label: sideLabel(entry), timestamp: entry.timestamp, map: mapsById.get(id) || null }
    }
    if (id === CURRENT) {
      return isCanvas
        ? { label: 'Current canvas', canvas: currentCanvas }
        : { label: 'Current document', html: editor?.getHTML() || '' }
    }
    const entry = byId.get(id)
    if (!entry) return isCanvas ? { label: '—', canvas: null } : { label: '—', html: '' }
    return {
      label: sideLabel(entry),
      timestamp: entry.timestamp,
      html: entry.contentHtml || '',
      canvas: entry.canvas || null,
    }
  }, [byId, currentCanvas, currentMap, editor, isCanvas, isMap, mapsById])

  const left = resolveSide(leftId)
  const right = resolveSide(rightId)

  /* ---------------- text diff ---------------- */

  const chunks = useMemo(
    () => (isStructured ? null : diffHtmlDocuments(left.html, right.html)),
    [isStructured, left.html, right.html]
  )

  const chunkOps = useMemo(() => {
    if (!chunks) return null
    return chunks.map((chunk) => {
      if (chunk.type !== 'changed') return null
      return diffWords(
        chunk.left.map((b) => b.text).join(' '),
        chunk.right.map((b) => b.text).join(' ')
      )
    })
  }, [chunks])

  const textStats = useMemo(() => {
    if (isStructured) return null
    return wordDelta(htmlToText(left.html), htmlToText(right.html))
  }, [isStructured, left.html, right.html])

  /* ---------------- canvas diff ---------------- */

  const canvasDiff = useMemo(() => {
    if (!isCanvas || !left.canvas || !right.canvas) return null
    return diffCanvases(left.canvas, right.canvas)
  }, [isCanvas, left.canvas, right.canvas])

  const canvasItems = useMemo(() => {
    if (!canvasDiff) return []
    return [
      ...canvasDiff.added.map((node) => ({ key: `added:${node.id}`, kind: 'Added card', left: null, right: node })),
      ...canvasDiff.removed.map((node) => ({ key: `removed:${node.id}`, kind: 'Removed card', left: node, right: null })),
      ...canvasDiff.edited.map((edit) => ({ key: `edited:${edit.after.id}`, kind: 'Edited card', left: edit.before, right: edit.after })),
      ...canvasDiff.moved.map((move) => ({ key: `moved:${move.after.id}`, kind: 'Moved card', left: move.before, right: move.after })),
      ...canvasDiff.edgesAdded.map((edge) => ({ key: `edgeAdded:${edge.id}`, kind: 'Added arrow', left: null, right: edge, isEdge: true })),
      ...canvasDiff.edgesRemoved.map((edge) => ({ key: `edgeRemoved:${edge.id}`, kind: 'Removed arrow', left: edge, right: null, isEdge: true })),
    ]
  }, [canvasDiff])

  /* ---------------- map diff ---------------- */

  const mapDiff = useMemo(() => {
    if (!isMap || !left.map || !right.map) return null
    return diffMaps(left.map, right.map)
  }, [isMap, left.map, right.map])

  const mapChanges = useMemo(() => {
    if (!mapDiff) return []
    const noun = (collection) => mapCollection(collection)?.one || 'item'
    return [
      ...mapDiff.added.map((change) => ({ key: mapChangeKey('added', change), kind: `Added ${noun(change.collection)}`, collection: change.collection, left: null, right: change.item })),
      ...mapDiff.removed.map((change) => ({ key: mapChangeKey('removed', change), kind: `Removed ${noun(change.collection)}`, collection: change.collection, left: change.item, right: null })),
      ...mapDiff.edited.map((change) => ({ key: mapChangeKey('edited', change), kind: `Edited ${noun(change.collection)}`, collection: change.collection, left: change.before, right: change.after })),
      ...mapDiff.moved.map((change) => ({ key: mapChangeKey('moved', change), kind: `Moved ${noun(change.collection)}`, collection: change.collection, left: change.before, right: change.after })),
      ...mapDiff.settings.map((change) => ({ key: mapChangeKey('setting', change), kind: mapSettingLabel(change.section), section: change.section, left: change.before, right: change.after })),
    ]
  }, [mapDiff])

  /* ---------------- merge actions ---------------- */

  const mergedName = 'Merged versions'

  const applyTextMerge = useCallback(async () => {
    if (!editor || !chunks) return
    setBusy(true)
    try {
      const merged = mergeChunksToHtml(chunks, choices)

      // Safety checkpoint of what's being replaced, then apply, then pin the result.
      await appendVersionEntry(projectName, docName, buildTextVersionEntry({
        contentHtml: editor.getHTML(),
        contentJson: editor.getJSON(),
        auto: true,
      }))
      setContentKeepingPageSetup(editor, merged)
      await appendVersionEntry(projectName, docName, buildTextVersionEntry({
        contentHtml: editor.getHTML(),
        contentJson: editor.getJSON(),
        name: mergedName,
        auto: false,
      }))
      await refreshVersions()
      onClose?.()
    } finally {
      setBusy(false)
    }
  }, [chunks, choices, docName, editor, onClose, projectName, refreshVersions])

  const applyCanvasMerge = useCallback(async () => {
    if (!canvasDiff) return
    setBusy(true)
    try {
      const merged = mergeCanvases(left.canvas, right.canvas, canvasDiff, choices)

      const current = await loadDocument(projectName, docName)
      if (current) {
        await appendVersionEntry(projectName, docName, buildCanvasVersionEntry({
          canvas: current,
          auto: true,
        }))
      }
      dispatchCanvasRestore(docName, merged)
      await appendVersionEntry(projectName, docName, buildCanvasVersionEntry({
        canvas: merged,
        name: mergedName,
        auto: false,
      }))
      await refreshVersions()
      onClose?.()
    } finally {
      setBusy(false)
    }
  }, [canvasDiff, choices, docName, left.canvas, onClose, projectName, refreshVersions, right.canvas])

  const applyMapMerge = useCallback(async () => {
    if (!mapDiff) return
    setBusy(true)
    try {
      const merged = normalizeMap(mergeMaps(left.map, right.map, mapDiff, choices))

      const current = await loadDocument(projectName, docName)
      if (current) {
        await appendVersionEntry(projectName, docName, buildMapVersionEntry({ map: current, auto: true }))
      }
      dispatchMapRestore(docName, merged)
      await appendVersionEntry(projectName, docName, buildMapVersionEntry({
        map: merged,
        name: mergedName,
        auto: false,
      }))
      await refreshVersions()
      onClose?.()
    } finally {
      setBusy(false)
    }
  }, [choices, docName, left.map, mapDiff, onClose, projectName, refreshVersions, right.map])

  const saveMergeAsCopy = useCallback(async () => {
    setBusy(true)
    try {
      let newPath = null
      if (isMap) {
        if (!mapDiff) return
        const merged = normalizeMap(mergeMaps(left.map, right.map, mapDiff, choices))
        newPath = await createDocumentFromVersion(projectName, docName, { map: merged }, 'merged')
      } else if (isCanvas) {
        if (!canvasDiff) return
        const merged = mergeCanvases(left.canvas, right.canvas, canvasDiff, choices)
        newPath = await createDocumentFromVersion(projectName, docName, { canvas: merged }, 'merged')
      } else {
        if (!chunks) return
        const merged = mergeChunksToHtml(chunks, choices)
        // Built from HTML, so it has no doc attributes: carry the live document's
        // page setup onto the copy, or the copy opens on the default page.
        const contentJson = withPageSetup(
          generateJSON(merged, getDocPreviewExtensions()),
          editor ? readDocPageSetup(editor.state.doc) : null
        )
        newPath = await createDocumentFromVersion(projectName, docName, { contentJson }, 'merged')
      }
      if (newPath) {
        await refreshFiles?.()
        onOpenDocInTab?.(newPath)
        onClose?.()
      }
    } finally {
      setBusy(false)
    }
  }, [canvasDiff, chunks, choices, docName, editor, isCanvas, isMap, left.canvas, left.map, mapDiff, onClose, onOpenDocInTab, projectName, refreshFiles, right.canvas, right.map])

  /* ---------------- divider ---------------- */

  const startResize = (event) => {
    if (event.button !== 0) return
    event.preventDefault()
    const container = bodyRef.current
    if (!container) return

    setResizing(true)

    const onMove = (moveEvent) => {
      const rect = container.getBoundingClientRect()
      // Inverse of the seam position in the stylesheet (pad + ratio × usable width).
      // Measuring against the full width instead would make the divider drift away
      // from the cursor everywhere except the midpoint.
      const usable = rect.width - COLUMN_PADDING * 2
      if (usable <= 0) return
      const next = (moveEvent.clientX - rect.left - COLUMN_PADDING) / usable
      setRatio(Math.min(MAX_RATIO, Math.max(MIN_RATIO, next)))
    }
    const onUp = () => {
      setResizing(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  /* ---------------- toolbar ---------------- */

  const swapSides = () => {
    setLeftId(rightId)
    setRightId(leftId)
  }

  const changedCount = isMap
    ? mapChanges.length
    : isCanvas
      ? canvasItems.length
      : (chunks || []).filter((chunk) => chunk.type === 'changed').length

  const identical = changedCount === 0 && Boolean(isMap ? mapDiff : isCanvas ? canvasDiff : chunks)

  // A canvas or map only lists differences, so an identical pair leaves the body empty.
  // Text still shows its unchanged paragraphs side by side, so it keeps its columns.
  const hasBodyContent = isStructured ? changedCount > 0 : (chunks || []).length > 0

  const differences = `${changedCount} difference${changedCount === 1 ? '' : 's'}`
  const statsLine = isMap
    ? (mapDiff ? `${differences} · ${countMapWords(left.map)} → ${countMapWords(right.map)} words` : 'Loading…')
    : isCanvas
    ? (canvasDiff
        ? `${changedCount} difference${changedCount === 1 ? '' : 's'} · ${countCanvasWords(left.canvas)} → ${countCanvasWords(right.canvas)} words`
        : 'Loading…')
    : `${changedCount} difference${changedCount === 1 ? '' : 's'} · +${textStats.added} −${textStats.removed} words · ${textWords(htmlToText(left.html)).length} → ${textWords(htmlToText(right.html)).length}`

  const ready = versionsReadFor === docName && (!isStructured || (isMap ? currentMap : currentCanvas) !== null)
  const reveal = useReveal(ready, { gated: false })
  const showBody = ready && reveal.phase !== 'hidden'

  const canApply = ready && (isMap ? Boolean(mapDiff) : isCanvas ? Boolean(canvasDiff) : Boolean(editor && chunks))

  const sideOptions = (
    <>
      <option value={CURRENT}>{isMap ? 'Current map' : isCanvas ? 'Current canvas' : 'Current document'}</option>
      {(versions || []).map((entry) => (
        <option key={entry.id} value={String(entry.id)}>
          {entry.name ? `★ ${entry.name}` : formatFullTimestamp(entry.timestamp)}
        </option>
      ))}
    </>
  )

  // The same segmented-group markup the text and canvas toolbars use, so the
  // version controls are visually indistinguishable from the rest of the titlebar.
  const toolbar = (
    <div className="toolbar-wrapper">
      <div className="toolbar">
        <div className="toolbar-group toolbar-group-compare">
          <select
            className="toolbar-select toolbar-select-version"
            value={leftId}
            onChange={(event) => setLeftId(event.target.value)}
            aria-label="Left version"
            title={`Left: ${left.label}`}
          >
            {sideOptions}
          </select>
          <button
            type="button"
            onClick={swapSides}
            aria-label="Swap sides"
            title="Swap sides"
          >
            <Icon name="move-left-right" />
          </button>
          <select
            className="toolbar-select toolbar-select-version"
            value={rightId}
            onChange={(event) => setRightId(event.target.value)}
            aria-label="Right version"
            title={`Right: ${right.label}`}
          >
            {sideOptions}
          </select>
        </div>

        <div className="toolbar-group toolbar-group-merge">
          <button
            type="button"
            className={mergeMode ? 'active' : ''}
            onClick={() => setMergeMode((current) => !current)}
            aria-pressed={mergeMode}
            aria-label="Merge"
            title="Choose, difference by difference, which side to keep"
          >
            <Icon name="compare" />
          </button>
          {mergeMode ? (
            <>
              <span className="toolbar-group-divider" />
              <button
                type="button"
                disabled={busy}
                onClick={() => void saveMergeAsCopy()}
                title="Write the merged result as a brand-new document"
              >
                Save as copy
              </button>
              <button
                type="button"
                className="vcp-apply"
                disabled={busy || !canApply}
                onClick={() => void (isMap ? applyMapMerge() : isCanvas ? applyCanvasMerge() : applyTextMerge())}
                title="Replace the open document with the merged result (a backup version is kept)"
              >
                Apply merge
              </button>
            </>
          ) : null}
        </div>

        <div className="toolbar-group toolbar-group-compare-close">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close comparison"
            title="Close comparison (Esc)"
          >
            <Icon name="close" />
          </button>
        </div>
      </div>
    </div>
  )

  /* ---------------- body: text ---------------- */

  const renderTextBody = () => (
    <div className="vcp-rows">
      {chunks.map((chunk, index) => {
        if (chunk.type === 'equal') {
          const expanded = expandedEqual.has(index)
          if (!expanded && chunk.blocks.length > 2) {
            // Collapsed on both sides, like a git hunk header — a single strip across
            // the middle would sit on the divider and belong to neither version.
            const expand = () => setExpandedEqual((current) => new Set(current).add(index))
            const label = `⋯ ${chunk.blocks.length} unchanged paragraphs`
            return (
              <div key={index} className="vcp-row">
                <button className="vcp-equal-collapsed" onClick={expand} title="Click to show">
                  {label}
                </button>
                <button className="vcp-equal-collapsed" onClick={expand} title="Click to show">
                  {label}
                </button>
              </div>
            )
          }
          const html = chunk.blocks.map((block) => block.html).join('')
          return (
            <div key={index} className="vcp-row vcp-row-equal">
              <div className="vcp-cell vcp-html" dangerouslySetInnerHTML={{ __html: html }} />
              <div className="vcp-cell vcp-html" dangerouslySetInnerHTML={{ __html: html }} />
            </div>
          )
        }

        const ops = chunkOps[index] || []
        return (
          <div key={index} className="vcp-changed">
            <div className="vcp-row vcp-row-changed">
              <div className={`vcp-cell vcp-cell-left${chunk.left.length ? '' : ' vcp-cell-empty'}`}>
                {chunk.left.length ? <DiffText ops={ops} side="left" /> : <span className="vcp-empty-hint">(nothing)</span>}
              </div>
              <div className={`vcp-cell vcp-cell-right${chunk.right.length ? '' : ' vcp-cell-empty'}`}>
                {chunk.right.length ? <DiffText ops={ops} side="right" /> : <span className="vcp-empty-hint">(nothing)</span>}
              </div>
            </div>
            {mergeMode ? (
              <ChoicePicker
                allowBoth
                value={choices[index] || 'right'}
                onChange={(choice) => setChoices((current) => ({ ...current, [index]: choice }))}
              />
            ) : null}
          </div>
        )
      })}
    </div>
  )

  /* ---------------- body: canvas ---------------- */

  const canvasCell = (item, side) => {
    const value = item[side]
    if (!value) return <span className="vcp-empty-hint">(not present)</span>

    if (item.isEdge) {
      return <span className="vcp-card-text">{value.label ? `Arrow “${value.label}”` : 'Arrow'}</span>
    }

    if (item.kind === 'Moved card') {
      return (
        <span className="vcp-card-text">
          “{textWords(canvasNodeText(value)).slice(0, 8).join(' ') || value.type}” at ({Math.round(value.x)}, {Math.round(value.y)})
        </span>
      )
    }

    if (item.kind === 'Edited card' && item.left && item.right) {
      const ops = diffWords(canvasNodeText(item.left), canvasNodeText(item.right))
      return <DiffText ops={ops} side={side} />
    }

    const text = textWords(canvasNodeText(value)).slice(0, 40).join(' ')
    return <span className="vcp-card-text">{text || `(${value.type} card)`}</span>
  }

  const renderCanvasBody = () => (
    <div className="vcp-rows">
      {canvasItems.map((item) => (
        <div key={item.key} className="vcp-changed">
          <div className="vcp-kind">{item.kind}</div>
          <div className="vcp-row vcp-row-changed">
            <div className={`vcp-cell vcp-cell-left${item.left ? '' : ' vcp-cell-empty'}`}>
              {canvasCell(item, 'left')}
            </div>
            <div className={`vcp-cell vcp-cell-right${item.right ? '' : ' vcp-cell-empty'}`}>
              {canvasCell(item, 'right')}
            </div>
          </div>
          {mergeMode ? (
            <ChoicePicker
              value={choices[item.key] || 'right'}
              onChange={(choice) => setChoices((current) => ({ ...current, [item.key]: choice }))}
            />
          ) : null}
        </div>
      ))}
    </div>
  )

  /* ---------------- body: map ---------------- */

  /** The fields that differ, as this side has them. */
  const mapFields = (keys, value) => (
    <ul className="vcp-map-fields">
      {keys.map((key) => (
        <li key={key}>
          <span className="vcp-map-field">{MAP_FIELD_LABELS[key] || key}</span> {briefValue(value?.[key])}
        </li>
      ))}
    </ul>
  )

  const mapCell = (item, side) => {
    const value = item[side]
    const other = item[side === 'left' ? 'right' : 'left']

    if (item.section) {
      if (value === null) return <span className="vcp-empty-hint">(not set)</span>
      const isRecord = value && typeof value === 'object' && !Array.isArray(value)
      if (!isRecord) return <span className="vcp-card-text">{briefValue(value)}</span>
      return mapFields(changedKeys(value, other), value)
    }

    if (!value) return <span className="vcp-empty-hint">(not present)</span>
    const title = <span className="vcp-card-text">“{mapItemTitle(item.collection, value, getDocDisplayName)}”</span>
    if (!other) return title
    return (
      <>
        {title}
        {mapFields(changedKeys(item.left, item.right), value)}
      </>
    )
  }

  const renderMapBody = () => (
    <div className="vcp-rows">
      {mapChanges.map((item) => (
        <div key={item.key} className="vcp-changed">
          <div className="vcp-kind">{item.kind}</div>
          <div className="vcp-row vcp-row-changed">
            <div className={`vcp-cell vcp-cell-left${item.left === null ? ' vcp-cell-empty' : ''}`}>
              {mapCell(item, 'left')}
            </div>
            <div className={`vcp-cell vcp-cell-right${item.right === null ? ' vcp-cell-empty' : ''}`}>
              {mapCell(item, 'right')}
            </div>
          </div>
          {mergeMode ? (
            <ChoicePicker
              value={choices[item.key] || 'right'}
              onChange={(choice) => setChoices((current) => ({ ...current, [item.key]: choice }))}
            />
          ) : null}
        </div>
      ))}
    </div>
  )

  const renderBody = () => {
    if (isMap) return mapDiff ? renderMapBody() : null
    if (isCanvas) return canvasDiff ? renderCanvasBody() : null
    return renderTextBody()
  }

  return (
    <>
      {toolbarSlot ? createPortal(toolbar, toolbarSlot) : null}

      <div
        className={`vcp-pane${resizing ? ' is-resizing' : ''}`}
        // The two columns and the divider are one grid, so the ratio sizes them
        // without the gutter ever being counted twice.
        style={{ '--vcp-ratio': ratio, '--vcp-ratio-rest': 1 - ratio }}
        role="region"
        aria-label="Version comparison"
      >
        <div className="vcp-headers">
          <div className="vcp-column-label" title={left.label}>{left.label}</div>
          <div className="vcp-column-label" title={right.label}>{right.label}</div>
        </div>

        <div className="vcp-stats">
          {showBody ? statsLine : <Skeleton width="40%" className="vcp-stats-skeleton" />}
          {mergeMode ? (
            <span className="vcp-stats-hint">Unpicked differences keep the right side.</span>
          ) : null}
        </div>

        {/* The "no differences" notice belongs up here rather than in the diff area:
            down there it would land in the middle of the columns, across the divider. */}
        {showBody && identical ? (
          <div className="vcp-notice">These two states are identical.</div>
        ) : null}

        <div ref={bodyRef} className="vcp-body">
          <div className="vcp-scroll" {...reveal.contentProps}>
            {showBody ? renderBody() : null}
          </div>
          <SkeletonOverlay visible={reveal.skeleton} label="Comparing versions">
            <div className="vcp-skeleton">
              <SkeletonRows count={6} />
              <SkeletonRows count={6} widths={['64%', '70%', '48%', '58%', '44%', '66%']} />
            </div>
          </SkeletonOverlay>
          {/* Nothing to divide when there are no columns below — a bare line down an
              empty pane reads as a rendering fault. */}
          {showBody && hasBodyContent ? (
            <div
              className="vcp-divider"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize comparison columns"
              title="Drag to resize · double-click to even out"
              onMouseDown={startResize}
              onDoubleClick={() => setRatio(0.5)}
            >
              <span className="vcp-divider-grip" />
            </div>
          ) : null}
        </div>
      </div>
    </>
  )
}

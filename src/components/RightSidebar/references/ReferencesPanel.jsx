/**
 * ReferencesPanel — the References tab: the project's sources, and the document's
 * bibliography (ReferencesPanelView.swift).
 *
 * Built for speed first. The field at the top takes anything — a URL, a DOI, an ISBN,
 * an arXiv id, a PMID, or a title — and ⏎ adds it: the source appears at once and
 * fills itself in when the lookup returns. The same field filters the list as it is
 * typed into, and in cite mode (Insert ▸ Citation…) ⏎ cites the highlighted source
 * instead, or adds and cites what was typed when nothing matches.
 *
 * Everything shown is what the page published (`referencesChanged`, `referenceSchema`),
 * formatted by the same citeproc run that formats the document; every edit is a
 * command useReferences answers.
 */
import { useEffect, useRef, useState } from 'react'
import { shellBridge, useBridgeEvent, useLatestBridgeState } from '../../../bridge'
import { BibliographyInclude } from '../../../types'
import { Segmented, Toggle } from '../../../ui'
import { popUpNativeMenu } from '../../../ui/useNativeMenu'
import Icon from '../../../ui/Icon.jsx'
import ReferenceEditor from './ReferenceEditor'
import { badgesFor, newReferenceId, referenceTitle, sourceUrl, visibleReferences } from './referenceText'
import { CITE_SOURCE_EVENT } from './citeEvent'
import './References.css'

const send = (type, payload) => shellBridge.send(type, payload)

export default function ReferencesPanel({ query: panelQuery = '' }) {
  const state = useLatestBridgeState('referencesChanged', null)
  const schema = useLatestBridgeState('referenceSchema', null)
  const [scope, setScope] = useState('document')
  const [input, setInput] = useState('')
  const [citing, setCiting] = useState(false)
  const [highlighted, setHighlighted] = useState(null)
  const [expanded, setExpanded] = useState(null)
  const inputRef = useRef(null)
  const listRef = useRef(null)

  const docPath = state?.docPath
  const shown = visibleReferences(state, input ? 'project' : scope, input || panelQuery)
  const matches = input ? shown : (citing ? visibleReferences(state, scope) : [])

  // A citation ⌥-clicked, or "Show in References": open that source.
  useBridgeEvent('revealReference', ({ id }) => {
    if (!id) return
    setExpanded(id)
    if (state?.references.find((view) => view.reference.id === id)?.attached === false) setScope('project')
    requestAnimationFrame(() => listRef.current?.querySelector(`[data-reference-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
  })

  // Insert ▸ Citation…: the field, in cite mode; Insert ▸ Add Reference…: the field.
  useEffect(() => {
    const cite = (event) => {
      setCiting(event?.detail?.cite !== false)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
    window.addEventListener(CITE_SOURCE_EVENT, cite)
    return () => window.removeEventListener(CITE_SOURCE_EVENT, cite)
  }, [])

  const cite = (ids) => { if (ids.length) send('insertCitation', { refIds: ids }) }

  const addReference = (text, alsoCite = false) => {
    const id = newReferenceId()
    send('addReference', { id, docPath, input: text, cite: alsoCite })
    setExpanded(id)
    return id
  }

  const submit = () => {
    const text = input.trim()
    if (citing) {
      const id = highlighted ?? matches[0]?.reference.id
      if (id) cite([id])
      else if (text) addReference(text, true)
      else return
      setInput('')
      setCiting(false)
      return
    }
    if (!text) return
    addReference(text)
    setInput('')
  }

  const move = (step) => {
    if (!matches.length) return
    const at = matches.findIndex((view) => view.reference.id === highlighted)
    setHighlighted(matches[Math.max(0, Math.min(matches.length - 1, at + step))].reference.id)
  }

  const kinds = schema?.kinds ?? []
  const groups = [...new Set(kinds.map((kind) => kind.group))]
  const newSource = (event) => popUpNativeMenu(event, groups.flatMap((group, index) => [
    index ? { separator: true } : null,
    { text: group, enabled: false },
    ...kinds.filter((kind) => kind.group === group).map((kind) => ({
      text: kind.label,
      action: () => {
        const id = newReferenceId()
        send('createReference', { id, docPath, kind: kind.id })
        setExpanded(id)
      },
    })),
  ]))

  const styles = schema?.styles ?? []
  const currentStyle = styles.find((style) => style.id === state?.style)
  const styleMenu = (event) => popUpNativeMenu(event, [
    ...styles.map((style) => ({
      text: style.label,
      checked: state?.style === style.id,
      action: () => send('setCitationStyle', { docPath, style: style.id, makeProjectDefault: !docPath }),
    })),
    { separator: true },
    {
      text: `Use ${currentStyle?.short ?? 'This Style'} for New Documents`,
      enabled: Boolean(currentStyle) && state?.projectStyle !== currentStyle?.id,
      action: () => currentStyle && send('setCitationStyle', { docPath, style: currentStyle.id, makeProjectDefault: true }),
    },
  ])

  const emptyTitle = input ? 'No Matching Sources' : !state ? 'No Project Open' : scope === 'document' && docPath ? 'No Sources in This Document' : 'No Sources Yet'
  const emptyMessage = input
    ? (citing ? `Press Return to add “${input}” and cite it.` : 'Press Return to look it up and add it.')
    : state ? 'Paste a link, DOI or ISBN above, or type a title. Sources you add here belong to the document you are in.' : ''

  return (
    <div className="sidebar-panel references-panel">
      <div className={`references-quick-add${citing ? ' is-citing' : ''}`}>
        <Icon name={citing ? 'comment' : 'zoom-in'} />
        <input
          ref={inputRef}
          value={input}
          placeholder={citing ? 'Find a source to cite…' : 'Paste a URL, DOI or ISBN — or type a title'}
          aria-label={citing ? 'Find a source to cite' : 'Add a source'}
          onChange={(event) => {
            setInput(event.target.value)
            setHighlighted(visibleReferences(state, 'project', event.target.value)[0]?.reference.id ?? null)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') { event.preventDefault(); submit() }
            else if (event.key === 'ArrowDown') { event.preventDefault(); move(1) }
            else if (event.key === 'ArrowUp') { event.preventDefault(); move(-1) }
            else if (event.key === 'Escape' && (citing || input)) { event.preventDefault(); setInput(''); setCiting(false) }
          }}
        />
        {input ? (
          <button type="button" className="reference-icon-button" aria-label="Clear" onClick={() => setInput('')}><Icon name="close" /></button>
        ) : null}
        <button type="button" className="reference-icon-button" aria-label="Enter a source by hand" title="Enter a source by hand" onClick={newSource}>
          <Icon name="write" />
        </button>
      </div>

      <div className="references-controls">
        <button type="button" className="references-style ui-button" data-variant="tinted" data-size="capsule" onClick={styleMenu} title="Citation style">
          <Icon name="type-style" /> {currentStyle?.short ?? 'Style'}
        </button>
        <Segmented
          value={scope}
          onChange={setScope}
          label="Show sources in"
          options={[
            { value: 'document', label: 'Document', disabled: !docPath },
            { value: 'project', label: 'Project' },
          ]}
        />
      </div>

      <div ref={listRef} className="references-list sidebar-list">
        {shown.length ? shown.map((view) => (
          <ReferenceRow
            key={view.reference.id}
            view={view}
            schema={schema}
            scope={scope}
            docPath={docPath}
            highlighted={Boolean(input) && highlighted === view.reference.id}
            expanded={expanded === view.reference.id}
            onToggle={() => setExpanded((open) => (open === view.reference.id ? null : view.reference.id))}
            onCite={() => cite([view.reference.id])}
          />
        )) : (
          <div className="inspector-placeholder">
            <Icon name="books" size={20} />
            <strong>{emptyTitle}</strong>
            <span>{emptyMessage}</span>
          </div>
        )}
      </div>

      {docPath && state ? <BibliographyFooter state={state} /> : null}
    </div>
  )
}

function ReferenceRow({ view, schema, scope, docPath, highlighted, expanded, onToggle, onCite }) {
  const { reference } = view
  const icon = schema?.kinds.find((kind) => kind.id === reference.kind)?.icon ?? 'file'
  const resolving = reference.status === 'resolving' && (!view.entryHtml || !referenceTitle(reference))
  const url = sourceUrl(reference)

  const menu = (event) => popUpNativeMenu(event, [
    { text: 'Cite', action: onCite },
    { text: expanded ? 'Done Editing' : 'Edit', action: onToggle },
    { separator: true },
    url ? { text: 'Open Source', action: () => import('@tauri-apps/plugin-opener').then(({ openUrl }) => openUrl(url)).catch(() => window.open(url)) } : null,
    { text: 'Copy Entry', enabled: Boolean(view.entryText), action: () => navigator.clipboard?.writeText(view.entryText) },
    { text: 'Copy In-Text Citation', enabled: Boolean(view.inText), action: () => navigator.clipboard?.writeText(view.inText) },
    docPath ? { separator: true } : null,
    docPath && view.attached ? { text: 'Remove from This Document', enabled: !view.cited, action: () => send('setReferenceAttached', { docPath, id: reference.id, attached: false }) } : null,
    docPath && !view.attached ? { text: 'Add to This Document', action: () => send('setReferenceAttached', { docPath, id: reference.id, attached: true }) } : null,
    reference.origin?.input ? { text: 'Look Up Again', action: () => send('retryReferenceLookup', { id: reference.id }) } : null,
    { separator: true },
    {
      text: 'Delete…',
      action: () => {
        const message = view.cited
          ? 'Delete this source? It is cited in this document. Its citations will show as a missing source.'
          : 'Delete this source? It will be removed from every document in the project.'
        if (window.confirm?.(message) ?? true) send('deleteReference', { id: reference.id })
      },
    },
  ])

  return (
    <article
      className={`reference-row${highlighted ? ' is-highlighted' : ''}${expanded ? ' is-expanded' : ''}`}
      data-reference-id={reference.id}
      onContextMenu={menu}
      draggable
      onDragStart={(event) => event.dataTransfer.setData('text/plain', view.inText || referenceTitle(reference))}
    >
      <div className="reference-row-main">
        <span className="reference-kind"><Icon name={icon} /></span>
        <div className="reference-entry" onClick={onToggle} onDoubleClick={onCite} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') onToggle() }}>
          {resolving ? (
            <span className="reference-resolving">Looking up {reference.origin?.input ?? 'source'}…</span>
          ) : view.entryHtml ? (
            // citeproc's own output: only i, b, sup, sub and span.sc.
            <span className="reference-entry-text" dangerouslySetInnerHTML={{ __html: view.entryHtml }} />
          ) : (
            <span className="reference-entry-text">{referenceTitle(reference) || 'Untitled source'}</span>
          )}
          <span className="reference-badges">
            {badgesFor(view, scope).map((badge) => <span key={badge.text} className="reference-badge" data-tone={badge.tone}>{badge.text}</span>)}
          </span>
        </div>
        <div className="reference-actions">
          <button type="button" className="reference-icon-button" aria-label="Cite" title="Cite at the caret (or double-click the source)" onClick={onCite}>
            <Icon name="comment" />
          </button>
          <button type="button" className="reference-icon-button" aria-label="More" onClick={menu}>
            <Icon name="more" />
          </button>
        </div>
      </div>
      {expanded ? <ReferenceEditor view={view} schema={schema} /> : null}
    </article>
  )
}

function BibliographyFooter({ state }) {
  const options = state.bibliography
  const set = (change) => send('setBibliographyOptions', { docPath: state.docPath, options: { ...options, ...change } })
  return (
    <footer className="references-bibliography">
      <div className="references-bibliography-head">
        <strong>Bibliography</strong>
        <button
          type="button"
          className="ui-button"
          data-variant="tinted"
          data-size="capsule"
          onClick={() => send('insertBibliography', {})}
          title={state.hasBibliography ? 'Move the live bibliography to the end of the document' : 'Add a live bibliography at the end of the document — it updates as you cite'}
        >
          {state.hasBibliography ? 'Move to End' : 'Insert at End'}
        </button>
      </div>
      <select className="ui-select" value={options.include} aria-label="List" onChange={(event) => set({ include: event.target.value })}>
        <option value={BibliographyInclude.Cited}>Sources cited in the text</option>
        <option value={BibliographyInclude.Attached}>Every source in this document</option>
      </select>
      <label className="references-toggle">
        <Toggle checked={options.annotated} onChange={(annotated) => set({ annotated })} label="Annotated" />
        Annotated (show each source’s annotation)
      </label>
      <label className="references-toggle" title={state.hasBibliography ? 'The bibliography is in the document, so it prints with it' : undefined}>
        <Toggle checked={state.hasBibliography || options.inPrint} disabled={state.hasBibliography} onChange={(inPrint) => set({ inPrint })} label="Add to printouts and exports" />
        Add to printouts and exports
      </label>
    </footer>
  )
}

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
import { Button, EmptyState, FormRow, IconButton, MenuItem, MenuLabel, MenuSeparator, MoreMenu, PanelActions, ScopeMenu, Section, SelectMenu, SkeletonRows, Toggle, useReveal } from '../../../ui'
import { popUpNativeMenu } from '../../../ui/useNativeMenu'
import Icon from '../../../ui/Icon.jsx'
import ReferenceEditor from './ReferenceEditor'
import { badgesFor, newReferenceId, referenceTitle, sourceUrl, visibleReferences } from './referenceText'
import { CITE_SOURCE_EVENT } from './citeEvent'
import './References.css'

const send = (type, payload) => shellBridge.send(type, payload)

export default function ReferencesPanel({ query: panelQuery = '' }) {
  const state = useLatestBridgeState('referencesChanged', null)
  // The panel lives inside an open project, so no state yet means not yet published.
  const listReveal = useReveal(state !== null)
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

  const emptyTitle = input ? 'No matching sources.' : !state ? 'No project open.' : scope === 'document' && docPath ? 'No sources in this document.' : 'No sources yet.'
  const emptyMessage = input
    ? (citing ? `Press Return to add “${input}” and cite it.` : 'Press Return to look it up and add it.')
    : state ? 'Paste a link, DOI or ISBN above, or type a title.' : ''

  return (
    <div className="sidebar-panel references-panel" data-help="references.panel">
      <PanelActions>
        <ScopeMenu
          label="Show sources in"
          value={scope}
          onChange={setScope}
          options={[
            { value: 'document', label: 'This document', disabled: !docPath },
            { value: 'project', label: 'This project' },
          ]}
        />
        <MoreMenu label="More reference options">
          <MenuLabel>Citation style</MenuLabel>
          {styles.map((style) => (
            <MenuItem key={style.id} checked={state?.style === style.id} onSelect={() => send('setCitationStyle', { docPath, style: style.id, makeProjectDefault: !docPath })}>{style.label}</MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem
            disabled={!currentStyle || state?.projectStyle === currentStyle?.id}
            onSelect={() => currentStyle && send('setCitationStyle', { docPath, style: currentStyle.id, makeProjectDefault: true })}
          >
            Use {currentStyle?.short ?? 'this style'} for new documents
          </MenuItem>
          <MenuItem icon="write" onSelect={newSource}>Enter a source by hand…</MenuItem>
        </MoreMenu>
      </PanelActions>
      <div className={`references-quick-add${citing ? ' is-citing' : ''}`} data-help="references.lookup">
        <Icon name={citing ? 'quote' : 'add'} />
        <input
          ref={inputRef}
          value={input}
          placeholder={citing ? 'Find a source to cite…' : 'Add a source…'}
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
        {input ? <IconButton icon="close" label="Clear" size="capsule" onClick={() => setInput('')} /> : null}
      </div>

      <div ref={listRef} className="references-list sidebar-list" data-reveal={listReveal.phase === 'hidden' ? undefined : listReveal.phase}>
        {listReveal.phase === 'hidden' ? (
          <div className="ib-skeleton-host" data-visible={listReveal.skeleton ? 'true' : 'false'} aria-busy="true">
            <SkeletonRows count={4} />
          </div>
        ) : shown.length ? shown.map((view) => (
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
          <EmptyState icon="books" title={emptyTitle} hint={emptyMessage || undefined} />
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
    { text: expanded ? 'Done editing' : 'Edit', action: onToggle },
    { separator: true },
    url ? { text: 'Open source', action: () => import('@tauri-apps/plugin-opener').then(({ openUrl }) => openUrl(url)).catch(() => window.open(url)) } : null,
    { text: 'Copy entry', enabled: Boolean(view.entryText), action: () => navigator.clipboard?.writeText(view.entryText) },
    { text: 'Copy in-text citation', enabled: Boolean(view.inText), action: () => navigator.clipboard?.writeText(view.inText) },
    docPath ? { separator: true } : null,
    docPath && view.attached ? { text: 'Remove from this document', enabled: !view.cited, action: () => send('setReferenceAttached', { docPath, id: reference.id, attached: false }) } : null,
    docPath && !view.attached ? { text: 'Add to this document', action: () => send('setReferenceAttached', { docPath, id: reference.id, attached: true }) } : null,
    reference.origin?.input ? { text: 'Look up again', action: () => send('retryReferenceLookup', { id: reference.id }) } : null,
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
          <IconButton icon="quote" label="Cite" title="Cite at the caret (or double-click the source)" size="capsule" onClick={onCite} />
          <IconButton icon="more" label="More source actions" size="capsule" onClick={menu} />
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
      <Section
        id="references.bibliography"
        title="Bibliography"
        help="references.bibliography"
        accessory={(
          <Button
            variant="tinted"
            onClick={() => send('insertBibliography', {})}
            title={state.hasBibliography ? 'Move the live bibliography to the end of the document' : 'Add a live bibliography at the end of the document; it updates as you cite'}
          >
            {state.hasBibliography ? 'Move to end' : 'Insert at end'}
          </Button>
        )}
      >
        <FormRow label="List">
          <SelectMenu
            label="List"
            value={options.include}
            onChange={(include) => set({ include })}
            options={[
              { value: BibliographyInclude.Cited, label: 'Sources cited' },
              { value: BibliographyInclude.Attached, label: 'Every source here' },
            ]}
          />
        </FormRow>
        <FormRow label="Annotated">
          <Toggle checked={options.annotated} onChange={(annotated) => set({ annotated })} label="Annotated" />
        </FormRow>
        <FormRow label="In printouts and exports">
          <Toggle checked={state.hasBibliography || options.inPrint} disabled={state.hasBibliography} onChange={(inPrint) => set({ inPrint })} label="In printouts and exports" />
        </FormRow>
      </Section>
    </footer>
  )
}

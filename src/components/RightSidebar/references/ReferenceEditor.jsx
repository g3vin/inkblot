/**
 * ReferenceEditor — a source's details, edited in place under its entry
 * (ReferenceEditorView.swift).
 *
 * The form is the kind's (`ReferenceKindSpec`), so a court case asks for the court and
 * a podcast for the episode. Required fields that are empty are marked. Edits are
 * committed a pause after the last keystroke, and on leaving the form. Two texts are
 * the writer's own: the annotation, printed under the entry in an annotated
 * bibliography, and the note, which is private and never printed.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { shellBridge } from '../../../bridge'
import { popUpNativeMenu } from '../../../ui/useNativeMenu'
import Icon from '../../../ui/Icon.jsx'
import { displayName, isOrganization, referencePatch } from './referenceText'

const COMMIT_DELAY_MS = 450
/** Kept by lookups for the record, not asked for in any form. */
const HIDDEN = new Set(['abstract', 'language', 'ISSN', 'citation-number'])

const draftOf = (reference) => ({
  fields: { ...reference.fields },
  contributors: reference.contributors.map((person) => ({ ...person })),
  annotation: reference.annotation ?? '',
  note: reference.note ?? '',
})

const today = () => new Date().toISOString().slice(0, 10)

export default function ReferenceEditor({ view, schema }) {
  const { reference } = view
  const [draft, setDraft] = useState(() => draftOf(reference))
  const [otherOpen, setOtherOpen] = useState(false)
  const focused = useRef(false)
  const timer = useRef(0)
  const latest = useRef({ reference, draft })
  useEffect(() => { latest.current = { reference, draft } })

  // A lookup filling the source in while the form is not being typed into.
  useEffect(() => { if (!focused.current) setDraft(draftOf(reference)) }, [reference])

  const commit = useCallback(() => {
    window.clearTimeout(timer.current)
    const { reference: current, draft: edited } = latest.current
    const patch = referencePatch(current, edited)
    if (patch) shellBridge.send('updateReference', { id: current.id, patch })
  }, [])
  useEffect(() => () => commit(), [commit])

  const change = (next) => {
    setDraft((was) => ({ ...was, ...next }))
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(commit, COMMIT_DELAY_MS)
  }
  const setField = (key, value) => change({ fields: { ...draft.fields, [key]: value } })
  const setPerson = (index, person) => change({ contributors: draft.contributors.map((p, i) => (i === index ? person : p)) })

  const kinds = schema?.kinds ?? []
  const kind = kinds.find((k) => k.id === reference.kind)
  const roles = kind?.roles?.length ? kind.roles : ['author']
  const roleLabels = Object.fromEntries((schema?.roles ?? []).map((role) => [role.id, role.label]))
  const roleLabel = (role) => roleLabels[role] ?? role.charAt(0).toUpperCase() + role.slice(1)
  const groups = [...new Set(kinds.map((k) => k.group))]
  const specs = kind?.fields ?? []
  const known = new Set(specs.map((spec) => spec.key))
  const extra = Object.keys(draft.fields).filter((key) => !known.has(key) && !HIDDEN.has(key)).sort()

  const personMenu = (event, index) => {
    const person = draft.contributors[index]
    const allRoles = roles.includes(person.role) ? roles : [person.role, ...roles]
    popUpNativeMenu(event, [
      ...allRoles.map((role) => ({ text: roleLabel(role), checked: person.role === role, action: () => setPerson(index, { ...person, role }) })),
      { separator: true },
      {
        text: isOrganization(person) ? 'A Person' : 'An Organization',
        action: () => setPerson(index, isOrganization(person)
          ? { role: person.role, family: person.literal ?? '', given: '' }
          : { role: person.role, literal: displayName(person) }),
      },
      index > 0 ? {
        text: 'Move Up',
        action: () => {
          const next = [...draft.contributors]
          ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
          change({ contributors: next })
        },
      } : null,
      { text: 'Remove', action: () => change({ contributors: draft.contributors.filter((_, i) => i !== index) }) },
    ])
  }

  const addPerson = (event) => popUpNativeMenu(event, [
    ...roles.map((role) => ({ text: roleLabel(role), action: () => change({ contributors: [...draft.contributors, { role, family: '', given: '' }] }) })),
    { separator: true },
    { text: 'Organization', action: () => change({ contributors: [...draft.contributors, { role: roles[0], literal: '' }] }) },
  ])

  const fieldInput = (spec) => {
    const value = draft.fields[spec.key] ?? ''
    const props = {
      value,
      placeholder: spec.placeholder,
      'aria-label': spec.label,
      onChange: (event) => setField(spec.key, event.target.value),
    }
    return spec.input === 'multiline' ? <textarea rows={3} {...props} /> : <input type={spec.input === 'url' ? 'url' : 'text'} {...props} />
  }

  return (
    <div
      className="reference-editor"
      onFocus={() => { focused.current = true }}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return
        focused.current = false
        commit()
      }}
    >
      {reference.error ? <p className="reference-error"><Icon name="warning" /> {reference.error}</p> : null}

      {reference.candidates?.length ? (
        <div className="reference-candidates">
          <p className="reference-hint">Which one did you mean?</p>
          {reference.candidates.map((candidate, index) => (
            <button key={index} type="button" className="reference-candidate" onClick={() => shellBridge.send('chooseReferenceCandidate', { id: reference.id, index })}>
              <span>{candidate.title}</span>
              <small>{candidate.detail}</small>
            </button>
          ))}
          <p className="reference-hint">None of these? Fill the details in below.</p>
        </div>
      ) : null}

      <label className="reference-field">
        <span className="reference-label">Type</span>
        <select
          className="ui-select"
          value={reference.kind}
          onChange={(event) => shellBridge.send('updateReference', { id: reference.id, patch: { kind: event.target.value } })}
        >
          {groups.map((group) => (
            <optgroup key={group} label={group}>
              {kinds.filter((k) => k.group === group).map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
            </optgroup>
          ))}
        </select>
      </label>

      <div className="reference-people">
        <div className="reference-people-head">
          <span className="reference-label">Contributors</span>
          <button type="button" className="reference-icon-button" aria-label="Add a contributor" title="Add an author, editor or other contributor" onClick={addPerson}>
            <Icon name="add" />
          </button>
        </div>
        {draft.contributors.map((person, index) => (
          <div key={index} className="reference-person">
            <button type="button" className="reference-role" onClick={(event) => personMenu(event, index)}>{roleLabel(person.role)}</button>
            {isOrganization(person) ? (
              <input value={person.literal ?? ''} placeholder="Organization" aria-label="Organization" onChange={(event) => setPerson(index, { ...person, literal: event.target.value })} />
            ) : (
              <>
                <input value={person.given ?? ''} placeholder="Given" aria-label="Given name" onChange={(event) => setPerson(index, { ...person, given: event.target.value })} />
                <input value={person.family ?? ''} placeholder="Family" aria-label="Family name" onChange={(event) => setPerson(index, { ...person, family: event.target.value })} />
              </>
            )}
          </div>
        ))}
      </div>

      {specs.map((spec) => {
        const missing = spec.required && !String(draft.fields[spec.key] ?? '').trim()
        return (
          <label key={spec.key} className={`reference-field${missing ? ' is-missing' : ''}`}>
            <span className="reference-label">
              {spec.label}
              {missing ? <Icon name="warning" /> : null}
              {spec.input === 'date' && spec.key === 'accessed' ? (
                <button type="button" className="reference-link" onClick={(event) => { event.preventDefault(); setField(spec.key, today()) }}>Today</button>
              ) : null}
            </span>
            {fieldInput(spec)}
          </label>
        )
      })}

      {extra.length ? (
        <div className="reference-extra">
          <button type="button" className="reference-link" onClick={() => setOtherOpen((open) => !open)}>
            {otherOpen ? 'Hide' : 'Other details'} ({extra.length})
          </button>
          {otherOpen ? extra.map((key) => (
            <label key={key} className="reference-field">
              <span className="reference-label">{key}</span>
              <input value={draft.fields[key] ?? ''} aria-label={key} onChange={(event) => setField(key, event.target.value)} />
            </label>
          )) : null}
        </div>
      ) : null}

      <label className="reference-field">
        <span className="reference-label">Annotation</span>
        <textarea rows={2} value={draft.annotation} placeholder="A summary or evaluation of the source" onChange={(event) => change({ annotation: event.target.value })} />
        <small className="reference-hint">Printed under the entry when the bibliography is annotated.</small>
      </label>
      <label className="reference-field">
        <span className="reference-label">Note</span>
        <textarea rows={2} value={draft.note} placeholder="Why it matters, what to check, where the good quote is" onChange={(event) => change({ note: event.target.value })} />
        <small className="reference-hint">Private — never printed.</small>
      </label>
    </div>
  )
}

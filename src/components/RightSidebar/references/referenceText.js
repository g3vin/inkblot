/** Small facts about a source, as the References panel shows them (ReferenceSupport.swift). */

export const referenceTitle = (reference) => reference?.fields?.title ?? ''

export const isOrganization = (contributor) => contributor?.literal != null

/** "Jane Austen", or the organisation. */
export const displayName = (contributor) => (
  contributor?.literal ?? [contributor?.given, contributor?.family].filter((part) => part).join(' ')
)

/** A source's own link: its URL, or its DOI as one. */
export function sourceUrl(reference) {
  const url = reference?.fields?.URL
  if (url && /^https?:\/\//i.test(url)) return url
  const doi = reference?.fields?.DOI
  return doi ? `https://doi.org/${doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')}` : null
}

/** What a filter reads of a source. */
export const searchText = (view) => [
  view.entryText, view.inText, view.reference.note, view.reference.annotation, ...(view.reference.tags ?? []),
].join(' ').toLowerCase()

/** The document's own sources, or all of them. */
export function visibleReferences(state, scope, query = '') {
  if (!state) return []
  const needle = query.trim().toLowerCase()
  let list = state.references
  if (scope === 'document' && state.docPath) list = list.filter((view) => view.attached || view.cited)
  if (needle) list = list.filter((view) => searchText(view).includes(needle))
  return list
}

/** The badges under an entry. */
export function badgesFor(view, scope) {
  const { reference } = view
  const out = []
  if (reference.status === 'resolving') out.push({ text: 'Looking up', tone: 'muted' })
  else if (reference.status === 'failed') out.push({ text: 'Not found', tone: 'warning' })
  else if (reference.status === 'incomplete' && reference.candidates?.length) out.push({ text: 'Choose a match', tone: 'accent' })
  else if (reference.status === 'incomplete') out.push({ text: `Missing ${view.missingFields.length}`, tone: 'warning' })
  if (view.cited) out.push({ text: 'Cited', tone: 'accent' })
  if (scope === 'project' && view.usedIn.length) {
    const names = view.usedIn.map((path) => path.split('/').pop())
    out.push({ text: names.length === 1 ? names[0] : `${names.length} documents`, tone: 'muted' })
  }
  if (reference.note) out.push({ text: 'Note', tone: 'muted' })
  if (reference.annotation) out.push({ text: 'Annotated', tone: 'muted' })
  return out
}

export const newReferenceId = () => `ref-${(globalThis.crypto?.randomUUID?.() ?? Math.random().toString(16).slice(2)).replace(/-/g, '').slice(0, 13).toLowerCase()}`

/** A patch of what changed in a source being edited, or null when nothing did. */
export function referencePatch(reference, draft) {
  const fields = {}
  for (const key of new Set([...Object.keys(draft.fields), ...Object.keys(reference.fields)])) {
    const value = String(draft.fields[key] ?? '').trim()
    if (value !== (reference.fields[key] ?? '')) fields[key] = value
  }
  const people = draft.contributors.filter((person) => displayName(person).trim())
  const patch = {}
  if (JSON.stringify(people) !== JSON.stringify(reference.contributors)) patch.contributors = people
  if (Object.keys(fields).length) patch.fields = fields
  if (draft.annotation !== reference.annotation) patch.annotation = draft.annotation
  if (draft.note !== reference.note) patch.note = draft.note
  return Object.keys(patch).length ? patch : null
}

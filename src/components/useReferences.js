/**
 * useReferences — the project's sources, for the editors and for the shell's panel.
 *
 * Three jobs:
 *
 *   1. Every open editor gets what its citations are formatted from — the library, its
 *      document's style and bibliography options, and what the document has attached
 *      (`setCitationContext`). This runs under either host: a citation pasted into a
 *      document formats whether or not a References panel is drawn.
 *   2. Under the Swift shell, the panel is told everything it shows (`referenceSchema`
 *      once; `referencesChanged` whenever the library, the document, its style or its
 *      citations change) and its commands are carried out here, since the page owns
 *      the library file as it owns the documents.
 *   3. Quick add: a source is written at once, `resolving`, and filled in when the lookup
 *      returns — so the writer never waits on the network to keep writing. Citing a
 *      source attaches it to the document, wherever the citation came from.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { documentSurface } from '../bridge'
import { nativeOwns } from '../lib/host'
import { collectCitations, setCitationContext } from '../extensions/Citation'
import { CITATION_REVEAL_EVENT } from '../extensions/citationPopover'
import { isCanvasDoc } from '../lib/docKind'
import { formatLibrary } from '../lib/references/format'
import { fetchText } from '../lib/references/fetchText'
import { resolveInput } from '../lib/references/resolve'
import { identify } from '../lib/references/identify'
import { CONTRIBUTOR_ROLES, kindSpec, missingFields, publishedKinds } from '../lib/references/referenceKinds'
import { loadStyle, publishedStyles, styleSpec } from '../lib/references/styles'
import { todayIso } from '../lib/references/csl'
import {
  REFERENCES_CHANGED_EVENT,
  addReference,
  changeReference,
  getDocCitations,
  loadLibrary,
  normalizeReference,
  patchReference,
  removeReference,
  setAttached,
  setDefaultStyle,
  settledStatus,
  updateDocCitations,
} from '../lib/references/referenceStore'

const live = (editor) => (editor && !editor.isDestroyed && editor.view && !editor.view.isDestroyed ? editor : null)

const EMPTY_LIBRARY = { defaultStyle: 'apa', references: [], attachments: {} }

/** A lookup's result as a patch onto the resolving record. */
const settle = (ref, found) => {
  if (found.candidates) {
    return {
      ...ref,
      origin: found.origin,
      candidates: found.candidates,
      status: found.candidates.length ? 'incomplete' : 'failed',
      ...(found.candidates.length ? {} : { error: 'Nothing matched that title. Fill it in below.' }),
      fields: { title: ref.fields.title || found.origin.input },
    }
  }
  const next = {
    ...ref,
    kind: kindSpec(found.kind).id,
    contributors: found.contributors?.length ? found.contributors : ref.contributors,
    fields: { ...found.fields, ...Object.fromEntries(Object.entries(ref.fields).filter(([key]) => key === 'accessed')) },
    origin: found.origin,
    candidates: [],
  }
  delete next.error
  return { ...next, status: settledStatus(next) }
}

export async function lookUp(projectName, id, input) {
  let found
  try {
    found = await resolveInput(input, (url, options) => fetchText(url, options))
  } catch (error) {
    const kind = identify(input)?.kind || 'manual'
    await changeReference(projectName, id, (ref) => ({
      ...ref,
      status: 'failed',
      error: `${error?.message || 'The lookup failed'}. Fill it in below.`,
      ...(kind === 'url' ? { fields: { ...ref.fields, URL: identify(input).value, accessed: todayIso() } } : {}),
    }))
    return
  }
  await changeReference(projectName, id, (ref) => settle(ref, found))
}

export function useReferences({ projectName, activeDoc, panes }) {
  const native = nativeOwns('rightSidebar')
  const [library, setLibrary] = useState(EMPTY_LIBRARY)
  const [settingsByDoc, setSettingsByDoc] = useState({})
  const [citedByDoc, setCitedByDoc] = useState({})
  const panesRef = useRef(panes)
  useEffect(() => { panesRef.current = panes })

  const docPath = activeDoc && !isCanvasDoc(activeDoc) ? activeDoc : null
  const openDocs = [...new Set((panes || []).map((pane) => pane.path).filter((path) => path && !isCanvasDoc(path)))]
  const openKey = openDocs.join('\u0000')

  /* ---------------- reading ---------------- */

  useEffect(() => {
    if (!projectName) {
      setLibrary(EMPTY_LIBRARY)
      return undefined
    }
    let alive = true
    const reload = async () => {
      const next = await loadLibrary(projectName)
      if (alive) setLibrary(next)
    }
    const reloadSettings = async (docName) => {
      const settings = await getDocCitations(projectName, docName)
      if (alive) setSettingsByDoc((current) => ({ ...current, [docName]: settings }))
    }
    const onChanged = (event) => {
      const detail = event?.detail || {}
      if (detail.projectName && detail.projectName !== projectName) return
      reload()
      if (detail.docName) reloadSettings(detail.docName)
    }
    reload()
    window.addEventListener(REFERENCES_CHANGED_EVENT, onChanged)
    return () => {
      alive = false
      window.removeEventListener(REFERENCES_CHANGED_EVENT, onChanged)
    }
  }, [projectName])

  useEffect(() => {
    if (!projectName) return undefined
    let alive = true
    for (const path of openKey ? openKey.split('\u0000') : []) {
      getDocCitations(projectName, path).then((settings) => {
        if (alive) setSettingsByDoc((current) => ({ ...current, [path]: settings }))
      })
    }
    return () => { alive = false }
  }, [projectName, openKey])

  /* ---------------- 1. the editors ---------------- */

  useEffect(() => {
    const references = new Map(library.references.map((ref) => [ref.id, ref]))
    for (const pane of panes || []) {
      const editor = live(pane.editor)
      if (!editor || !pane.path || isCanvasDoc(pane.path)) continue
      const settings = settingsByDoc[pane.path]
      if (!settings) continue
      setCitationContext(editor, {
        docPath: pane.path,
        references,
        style: styleSpec(settings.style || library.defaultStyle).id,
        bibliography: settings.bibliography,
        attachedIds: library.attachments[pane.path] || [],
      })
    }
    // `panes` changes identity every render; what matters is which editors show what.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library, settingsByDoc, openKey, ...(panes || []).map((pane) => pane.editor)])

  /* What each open document cites, and attaching what it newly cites. */
  useEffect(() => {
    const editors = (panes || []).map((pane) => ({ editor: live(pane.editor), path: pane.path }))
      .filter(({ editor, path }) => editor && path && !isCanvasDoc(path))
    const cleanups = editors.map(({ editor, path }) => {
      const read = () => {
        const { citedIds, bibliography } = collectCitations(editor.state.doc)
        setCitedByDoc((current) => {
          const previous = current[path]
          const next = { citedIds, hasBibliography: Boolean(bibliography) }
          if (previous && previous.hasBibliography === next.hasBibliography && previous.citedIds.join() === citedIds.join()) return current
          return { ...current, [path]: next }
        })
      }
      read()
      editor.on('update', read)
      return () => editor.off('update', read)
    })
    return () => cleanups.forEach((cleanup) => cleanup())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openKey, ...(panes || []).map((pane) => pane.editor)])

  useEffect(() => {
    if (!projectName) return
    const known = new Set(library.references.map((ref) => ref.id))
    for (const [path, { citedIds }] of Object.entries(citedByDoc)) {
      const attached = new Set(library.attachments[path] || [])
      const missing = citedIds.filter((id) => known.has(id) && !attached.has(id))
      if (missing.length) setAttached(projectName, path, missing, true)
    }
  }, [projectName, library, citedByDoc])

  /* ---------------- 2. the panel ---------------- */

  useEffect(() => {
    if (!native) return
    documentSurface.publishReferenceSchema({ kinds: publishedKinds(), roles: CONTRIBUTOR_ROLES, styles: publishedStyles() })
  }, [native])

  useEffect(() => {
    if (!native || !projectName) return undefined
    let alive = true
    const settings = (docPath && settingsByDoc[docPath]) || null
    const style = styleSpec(settings?.style || library.defaultStyle).id
    const cited = new Set(citedByDoc[docPath]?.citedIds || [])
    const attached = new Set(docPath ? library.attachments[docPath] || [] : [])
    const usedIn = new Map()
    for (const [path, ids] of Object.entries(library.attachments)) {
      for (const id of ids) usedIn.set(id, [...(usedIn.get(id) || []), path])
    }
    loadStyle(style).then(() => {
      if (!alive) return
      let formatted = new Map()
      try {
        formatted = formatLibrary({ styleId: style, references: library.references })
      } catch (error) {
        console.error('[references] could not format the library', error)
      }
      documentSurface.publishReferencesChanged({
        docPath: docPath || undefined,
        style,
        projectStyle: styleSpec(library.defaultStyle).id,
        bibliography: settings?.bibliography || { include: 'cited', annotated: false, inPrint: true },
        hasBibliography: Boolean(citedByDoc[docPath]?.hasBibliography),
        references: library.references.map((reference) => {
          const view = formatted.get(reference.id) || { entryHtml: '', entryText: '', inText: '' }
          return {
            reference,
            entryHtml: view.entryHtml,
            entryText: view.entryText,
            inText: view.inText,
            missingFields: missingFields(reference.kind, reference.fields),
            usedIn: usedIn.get(reference.id) || [],
            attached: attached.has(reference.id),
            cited: cited.has(reference.id),
          }
        }),
      })
    })
    return () => { alive = false }
  }, [native, projectName, docPath, library, settingsByDoc, citedByDoc])

  const citeInActive = useCallback((refIds, locator) => {
    const pane = (panesRef.current || []).find((candidate) => candidate.path === docPath) || panesRef.current?.[0]
    const editor = live(pane?.editor)
    if (editor) editor.chain().focus().insertCitation({ refIds, locator: locator || '' }).run()
  }, [docPath])

  useEffect(() => {
    if (!projectName) return undefined
    const off = [
      documentSurface.onCommand('addReference', async ({ id, docPath: path, input, cite }) => {
        const text = String(input || '').trim()
        if (!text) return
        const found = identify(text)
        await addReference(projectName, normalizeReference({
          id,
          kind: found?.kind === 'isbn' ? 'book' : found?.kind === 'doi' || found?.kind === 'pmid' ? 'journalArticle' : 'webpage',
          fields: found?.kind === 'search' ? { title: text } : found?.kind === 'url' ? { URL: found.value, accessed: todayIso() } : {},
          status: 'resolving',
          origin: { kind: found?.kind || 'manual', input: text },
        }), path || null)
        if (cite) citeInActive([id])
        await lookUp(projectName, id, text)
      }),
      documentSurface.onCommand('createReference', async ({ id, docPath: path, kind }) => {
        const spec = kindSpec(kind)
        await addReference(projectName, normalizeReference({
          id,
          kind: spec.id,
          fields: { ...spec.defaults, ...(spec.fields.some((field) => field.key === 'accessed') ? { accessed: todayIso() } : {}) },
          status: 'incomplete',
          origin: { kind: 'manual', input: '' },
        }), path || null)
      }),
      documentSurface.onCommand('updateReference', ({ id, patch }) => patchReference(projectName, id, patch)),
      documentSurface.onCommand('deleteReference', ({ id }) => removeReference(projectName, id)),
      documentSurface.onCommand('retryReferenceLookup', async ({ id }) => {
        const current = (await loadLibrary(projectName)).references.find((ref) => ref.id === id)
        const input = current?.origin?.input || current?.fields?.URL || current?.fields?.DOI || current?.fields?.title
        if (!input) return
        await changeReference(projectName, id, (ref) => ({ ...ref, status: 'resolving', error: undefined }))
        await lookUp(projectName, id, input)
      }),
      documentSurface.onCommand('chooseReferenceCandidate', async ({ id, index }) => {
        const current = (await loadLibrary(projectName)).references.find((ref) => ref.id === id)
        const candidate = current?.candidates?.[index]
        if (!candidate) return
        const next = {
          ...current,
          kind: kindSpec(candidate.kind).id,
          contributors: candidate.contributors || [],
          fields: { ...candidate.fields },
          candidates: [],
        }
        await changeReference(projectName, id, () => ({ ...next, status: settledStatus(next) }))
        // A chosen article has a DOI; its registrar has the full record.
        if (candidate.fields?.DOI) await lookUp(projectName, id, candidate.fields.DOI)
      }),
      documentSurface.onCommand('setReferenceAttached', ({ docPath: path, id, attached }) => setAttached(projectName, path, [id], attached)),
      documentSurface.onCommand('setCitationStyle', async ({ docPath: path, style, makeProjectDefault }) => {
        if (makeProjectDefault) await setDefaultStyle(projectName, style)
        if (path) await updateDocCitations(projectName, path, (current) => ({ ...current, style }))
      }),
      documentSurface.onCommand('setBibliographyOptions', ({ docPath: path, options }) => (
        updateDocCitations(projectName, path, (current) => ({ ...current, bibliography: { ...current.bibliography, ...options } }))
      )),
    ]
    return () => off.forEach((unsubscribe) => unsubscribe())
  }, [projectName, citeInActive])

  /* ⌥-click on a citation, or "Show in References". */
  useEffect(() => {
    const onReveal = (event) => {
      const id = event?.detail?.refId
      if (!id) return
      if (native) {
        documentSurface.publishShowSidebarTab({ tab: 'references' })
        documentSurface.publishRevealReference({ id })
      }
    }
    window.addEventListener(CITATION_REVEAL_EVENT, onReveal)
    return () => window.removeEventListener(CITATION_REVEAL_EVENT, onReveal)
  }, [native])
}

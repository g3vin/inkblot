/**
 * versionStore.js — reading and writing a document's version history.
 *
 * Text documents carry their history inside their own file; canvases keep theirs
 * in a `.versions/` sidecar, because a canvas file is spec-shaped JSON Canvas and
 * must stay that way (it round-trips with Obsidian). The sidecar is also read as a
 * fallback for text documents that have no embedded history.
 *
 * Retention: at most 200 unnamed entries, evicted oldest first; named versions are
 * never evicted.
 */
import { writeTextFile, readTextFile, mkdir } from '@tauri-apps/plugin-fs'
import { isTextDoc } from './docKind'
import { EDIT_SESSION_ID, countWords, countCanvasWords } from './versionHistory'
import { countMapWords } from './map/mapModel'
import { getProjectRoot, joinPath, normalizePath, parentOf } from './projectPaths'
import { withDocLock } from './docLock'


// Unnamed checkpoints beyond this are dropped oldest-first. Named versions are
// landmarks the user placed deliberately and are NEVER evicted by the cap.
const VERSION_CAP = 200

const newVersionId = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

export const emitVersionsChanged = (projectName, docName) => {
  try {
    if (typeof window !== 'undefined' && window?.dispatchEvent) {
      window.dispatchEvent(new CustomEvent('versions:changed', { detail: { projectName, docName } }))
    }
  } catch {
    void 0
  }
}

/** A version entry for a text document, stamped with session + word count. */
export const buildTextVersionEntry = ({ contentHtml, contentJson, name = null, auto = true }) => ({
  id: newVersionId(),
  timestamp: new Date().toISOString(),
  kind: 'text',
  name: name || null,
  auto,
  sessionId: EDIT_SESSION_ID,
  words: countWords(contentHtml || ''),
  contentHtml: contentHtml || null,
  contentJson: contentJson || null,
})

/** A version entry holding a full serialized canvas. */
export const buildCanvasVersionEntry = ({ canvas, name = null, auto = true }) => ({
  id: newVersionId(),
  timestamp: new Date().toISOString(),
  kind: 'canvas',
  name: name || null,
  auto,
  sessionId: EDIT_SESSION_ID,
  words: countCanvasWords(canvas),
  canvas,
})

/** A version entry holding a full serialized map. */
export const buildMapVersionEntry = ({ map, name = null, auto = true }) => ({
  id: newVersionId(),
  timestamp: new Date().toISOString(),
  kind: 'map',
  name: name || null,
  auto,
  sessionId: EDIT_SESSION_ID,
  words: countMapWords(map),
  map,
})

/** A map as written, minus where the view was looking. */
const mapContent = (entry) => {
  if (!entry?.map) return null
  const { viewport: _viewport, ...content } = entry.map
  return content
}

/** Two entries hold the same document state (viewport and metadata aside). */
const sameVersionContent = (a, b) => {
  if (!a || !b) return false
  if (a.map || b.map) {
    try {
      return JSON.stringify(mapContent(a)) === JSON.stringify(mapContent(b))
    } catch {
      return false
    }
  }
  if (a.canvas || b.canvas) {
    try {
      return JSON.stringify({ n: a.canvas?.nodes, e: a.canvas?.edges }) ===
        JSON.stringify({ n: b.canvas?.nodes, e: b.canvas?.edges })
    } catch {
      return false
    }
  }
  return Boolean(a.contentHtml) && a.contentHtml === b.contentHtml
}

/**
 * Push `entry` onto a newest-first version list. Consecutive duplicates fold
 * away — naming a state identical to the latest checkpoint names that
 * checkpoint instead of stacking a twin on top of it. The cap only ever evicts
 * unnamed entries.
 */
export const pushVersionEntry = (versions, entry) => {
  const next = Array.isArray(versions) ? versions.slice() : []

  if (next[0] && sameVersionContent(next[0], entry)) {
    if (entry.name && !next[0].name) {
      next[0] = { ...next[0], name: entry.name, auto: false }
      return next
    }
    if (!entry.name) return next
  }

  next.unshift(entry)

  let unnamed = next.reduce((count, v) => count + (v.name ? 0 : 1), 0)
  for (let i = next.length - 1; i >= 0 && unnamed > VERSION_CAP; i--) {
    if (!next[i].name) {
      next.splice(i, 1)
      unnamed--
    }
  }

  return next
}

export const versionsSidecarPath = (root, docName) => {
  const rel = normalizePath(docName)
  return joinPath(root, '.versions', `${rel || docName}.versions.json`)
}

export async function readSidecarVersions(root, docName) {
  try {
    const raw = await readTextFile(versionsSidecarPath(root, docName))
    const parsed = JSON.parse(raw || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export async function writeSidecarVersions(root, docName, versions) {
  const filePath = versionsSidecarPath(root, docName)
  await mkdir(parentOf(filePath), { recursive: true })
  await writeTextFile(filePath, JSON.stringify(versions))
}

/**
 * Load a document's version history.
 *
 * Text documents embed their versions in the document file; canvases keep
 * theirs in a `.versions/` sidecar (the canvas file itself is spec-shaped JSON
 * Canvas and must stay that way). The sidecar is also the legacy fallback for
 * text documents written by older app versions.
 */
export async function getVersions(projectName, docName) {
  try {
    const root = await getProjectRoot(projectName)

    if (isTextDoc(docName)) {
      try {
        const raw = await readTextFile(joinPath(root, `${docName}.json`))
        const parsed = JSON.parse(raw || '{}')
        if (Array.isArray(parsed.versions) && parsed.versions.length) return parsed.versions
        // fallthrough to the sidecar fallback
      } catch {
        void 0
      }
    }

    return await readSidecarVersions(root, docName)
  } catch (e) {
    console.error('[getVersions] failed:', e)
    return []
  }
}

/**
 * Where a document's versions live and what they currently are — the one place
 * that knows embedded-vs-sidecar, so every mutation below shares it.
 */
async function readVersionStore(projectName, docName) {
  const root = await getProjectRoot(projectName)

  if (!isTextDoc(docName)) {
    return { root, store: 'sidecar', doc: null, versions: await readSidecarVersions(root, docName) }
  }

  let doc = null
  try {
    const raw = await readTextFile(joinPath(root, `${docName}.json`))
    doc = JSON.parse(raw || '{}')
  } catch {
    doc = null
  }

  if (doc && Array.isArray(doc.versions) && doc.versions.length) {
    return { root, store: 'embedded', doc, versions: doc.versions }
  }

  // No embedded history yet: legacy sidecar if present, otherwise start
  // embedding (a text doc must exist to version).
  const legacy = await readSidecarVersions(root, docName)
  if (legacy.length) return { root, store: 'sidecar', doc, versions: legacy }
  return doc ? { root, store: 'embedded', doc, versions: [] } : null
}

async function writeVersionStore(projectName, docName, location, versions) {
  if (location.store === 'sidecar') {
    await writeSidecarVersions(location.root, docName, versions)
  } else {
    await writeTextFile(
      joinPath(location.root, `${docName}.json`),
      JSON.stringify({ ...location.doc, versions })
    )
  }
  emitVersionsChanged(projectName, docName)
}

/**
 * Append a version entry outside the autosave path — manual snapshots, the
 * safety checkpoint taken before a restore, and canvas checkpoints all land
 * here. Returns the entry actually stored (deduping may fold it into the
 * latest one) or null on failure.
 */
export async function appendVersionEntry(projectName, docName, entry) {
  return withDocLock(projectName, docName, async () => {
    try {
      const location = await readVersionStore(projectName, docName)
      if (!location) return null

      const versions = pushVersionEntry(location.versions, entry)
      await writeVersionStore(projectName, docName, location, versions)
      return versions[0] || null
    } catch (e) {
      console.error('[appendVersionEntry] failed:', e)
      return null
    }
  })
}

/** Debounced canvas checkpoint: store the full serialized canvas as a version. */
export async function appendCanvasVersion(projectName, docPath, canvas, { name = null, auto = true } = {}) {
  return appendVersionEntry(projectName, docPath, buildCanvasVersionEntry({ canvas, name, auto }))
}

/** Rename (or un-name) a version, or patch any of its metadata. */
export async function updateVersionEntry(projectName, docName, versionId, patch) {
  return withDocLock(projectName, docName, async () => {
    try {
      const location = await readVersionStore(projectName, docName)
      if (!location) return false

      let found = false
      const versions = location.versions.map((entry) => {
        if (String(entry.id) !== String(versionId)) return entry
        found = true
        return { ...entry, ...patch }
      })
      if (!found) return false

      await writeVersionStore(projectName, docName, location, versions)
      return true
    } catch (e) {
      console.error('[updateVersionEntry] failed:', e)
      return false
    }
  })
}

export async function deleteVersionEntry(projectName, docName, versionId) {
  return withDocLock(projectName, docName, async () => {
    try {
      const location = await readVersionStore(projectName, docName)
      if (!location) return false

      const versions = location.versions.filter((entry) => String(entry.id) !== String(versionId))
      if (versions.length === location.versions.length) return false

      await writeVersionStore(projectName, docName, location, versions)
      return true
    } catch (e) {
      console.error('[deleteVersionEntry] failed:', e)
      return false
    }
  })
}

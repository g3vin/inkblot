/**
 * releaseNotes.ts — what changed in this version, for the banner after an update.
 *
 * The notes are the version's GitHub Release (`RELEASES_REPO`, tag `v<version>`): its
 * body is read for highlights — the bullets under a heading that says what was added,
 * and under one that says what was fixed, or bullets that say so themselves
 * (`feat: …`, `fix: …`). The banner links to the release itself for the rest.
 *
 * Shown once per version: the version last seen is kept in the preferences, and a
 * first launch (nothing kept yet) is not an update, so it shows nothing.
 */
import { getPreference, setPreference } from './preferences'

export const RELEASES_REPO = 'g3vin/inkblot'
export const RELEASES_URL = `https://github.com/${RELEASES_REPO}/releases`
export const LAST_SEEN_VERSION_KEY = 'inkblot-last-seen-version'

/** How many of each kind of highlight the banner shows. */
const MAX_HIGHLIGHTS = 4

export interface ReleaseNotes {
  version: string
  /** The release's own page, or the list of releases when it could not be read. */
  url: string
  added: string[]
  fixed: string[]
}

/** The version to tell the writer about, or null: this launch is not after an update. */
export function updatedVersion(current: string | null | undefined): string | null {
  if (!current) return null
  const seen = getPreference(LAST_SEEN_VERSION_KEY)
  if (!seen) {
    // A first launch: nothing to say, but the next update is one.
    setPreference(LAST_SEEN_VERSION_KEY, current)
    return null
  }
  return seen === current ? null : current
}

/** The banner was seen (or dismissed) for `version`. */
export const markVersionSeen = (version: string) => setPreference(LAST_SEEN_VERSION_KEY, version)

/* ---------------- reading a release ---------------- */

const ADDED_HEADING = /\b(feat|features?|new|added|adds|highlights?|improve(?:d|ments?)?)\b/i
const FIXED_HEADING = /\b(fix(?:es|ed)?|bugs?)\b/i

/** A bullet as the writer reads it: no commit prefix, credit or links. */
function cleanBullet(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+by @[\w-]+(?: in \S+)?\s*$/i, '')
    .replace(/\s+in https?:\/\/\S+\s*$/i, '')
    .replace(/^(feat|fix|perf|refactor|docs|chore|style|test|build|ci)(\([^)]*\))?!?:\s*/i, '')
    .replace(/[*_`]/g, '')
    .trim()
    .replace(/^./, (first) => first.toUpperCase())
}

/** Highlights from a release's Markdown body. */
export function readHighlights(body: string): { added: string[]; fixed: string[] } {
  const added: string[] = []
  const fixed: string[] = []
  let section: 'added' | 'fixed' | null = null
  for (const line of (body || '').split(/\r?\n/)) {
    const heading = line.match(/^#{1,6}\s+(.*)$/) || line.match(/^\*\*(.+)\*\*\s*$/)
    if (heading) {
      section = FIXED_HEADING.test(heading[1]) ? 'fixed' : ADDED_HEADING.test(heading[1]) ? 'added' : null
      continue
    }
    const bullet = line.match(/^\s{0,3}[-*+]\s+(.+)$/)
    if (!bullet) continue
    const raw = bullet[1]
    const kind = section ?? (/^fix(\(|:|!)/i.test(raw) ? 'fixed' : /^feat(\(|:|!)/i.test(raw) ? 'added' : null)
    const text = cleanBullet(raw)
    if (!kind || !text) continue
    const list = kind === 'added' ? added : fixed
    if (list.length < MAX_HIGHLIGHTS) list.push(text)
  }
  return { added, fixed }
}

/**
 * The notes for `version`. Without a release to read (offline, not published, or not
 * readable from here) it is the version alone, with the list of releases to look in.
 */
export async function fetchReleaseNotes(version: string, fetcher: typeof fetch = fetch): Promise<ReleaseNotes> {
  const fallback: ReleaseNotes = { version, url: RELEASES_URL, added: [], fixed: [] }
  try {
    const response = await fetcher(`https://api.github.com/repos/${RELEASES_REPO}/releases/tags/v${version}`, {
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!response.ok) return fallback
    const release = await response.json()
    return {
      version,
      url: typeof release?.html_url === 'string' ? release.html_url : RELEASES_URL,
      ...readHighlights(typeof release?.body === 'string' ? release.body : ''),
    }
  } catch {
    return fallback
  }
}

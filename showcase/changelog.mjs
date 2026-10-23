/**
 * changelog.mjs — CHANGELOG.md (Keep a Changelog) as data, for the website.
 *
 *   [{ version, date, sections: { Added: [{ title, text }], Changed: […], … } }]
 *
 * An entry is a top-level bullet with its wrapped lines joined. "- **Focus mode:** its
 * controls…" becomes { title: 'Focus mode', text: 'its controls…' }; an entry with no
 * bold lead has no title. Nested bullets and paragraphs inside an entry join its text.
 */
export function parseChangelog(markdown) {
  const releases = []
  let release = null
  let section = null
  let entry = null
  const finish = () => {
    if (entry && section) {
      const text = entry.join(' ').replace(/\s+/g, ' ').trim()
      const lead = /^\*\*(.+?)[:.]?\*\*[:.]?\s*(.*)$/.exec(text)
      section.push(lead ? { title: lead[1], text: lead[2] } : { title: null, text })
    }
    entry = null
  }
  for (const line of markdown.split('\n')) {
    const heading = /^## \[([^\]]+)\](?:\s*-\s*(\d{4}-\d{2}-\d{2}))?/.exec(line)
    if (heading) {
      finish()
      release = { version: heading[1], date: heading[2] ?? null, sections: {} }
      releases.push(release)
      section = null
      continue
    }
    const sub = /^### (.+)$/.exec(line)
    if (sub && release) {
      finish()
      section = release.sections[sub[1].trim()] = []
      continue
    }
    // The version links at the foot ("[0.1.0]: https://…") belong to no entry.
    if (/^\[[^\]]+\]:\s/.test(line)) { finish(); section = null; continue }
    if (!section) continue
    if (/^- /.test(line)) { finish(); entry = [line.slice(2)]; continue }
    if (entry && line.trim()) entry.push(line.trim().replace(/^- /, ''))
  }
  finish()
  return releases
}

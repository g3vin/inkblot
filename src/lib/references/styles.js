/**
 * styles.js — the citation styles, and their official CSL definitions.
 *
 * The .csl files in `csl-styles/` are the Citation Style Language project's own
 * (github.com/citation-style-language/styles, CC BY-SA 3.0; each keeps its header),
 * so the formatting is the one Zotero and Mendeley produce. They are loaded when a
 * style is first used, not with the app.
 */

export const DEFAULT_STYLE = 'apa'

export const CITATION_STYLES = [
  { id: 'apa', label: 'APA 7th edition', short: 'APA', heading: 'References', noteStyle: false, file: 'apa' },
  { id: 'mla', label: 'MLA 9th edition', short: 'MLA', heading: 'Works Cited', noteStyle: false, file: 'modern-language-association' },
  { id: 'chicago-author-date', label: 'Chicago 18th edition (author-date)', short: 'Chicago A-D', heading: 'References', noteStyle: false, file: 'chicago-author-date' },
  { id: 'chicago-notes', label: 'Chicago 18th edition (notes and bibliography)', short: 'Chicago Notes', heading: 'Bibliography', noteStyle: true, file: 'chicago-notes-bibliography' },
  { id: 'harvard', label: 'Harvard (Cite Them Right)', short: 'Harvard', heading: 'Reference list', noteStyle: false, file: 'harvard-cite-them-right' },
  { id: 'ieee', label: 'IEEE', short: 'IEEE', heading: 'References', noteStyle: false, file: 'ieee' },
  { id: 'ama', label: 'AMA 11th edition', short: 'AMA', heading: 'References', noteStyle: false, file: 'american-medical-association' },
  { id: 'vancouver', label: 'Vancouver (NLM)', short: 'Vancouver', heading: 'References', noteStyle: false, file: 'vancouver' },
  { id: 'asa', label: 'ASA 7th edition', short: 'ASA', heading: 'References', noteStyle: false, file: 'american-sociological-association' },
]

const BY_ID = new Map(CITATION_STYLES.map((style) => [style.id, style]))

export const styleSpec = (id) => BY_ID.get(id) || BY_ID.get(DEFAULT_STYLE)

/** The styles as the shell receives them (`CitationStyleSpec`). */
export const publishedStyles = () => CITATION_STYLES.map(({ id, label, short, heading, noteStyle }) => ({
  id, label, short, heading, noteStyle,
}))

/* Each is a separate chunk; Vite resolves `?raw` to the file's text. */
const LOADERS = {
  apa: () => import('./csl-styles/apa.csl?raw'),
  'modern-language-association': () => import('./csl-styles/modern-language-association.csl?raw'),
  'chicago-author-date': () => import('./csl-styles/chicago-author-date.csl?raw'),
  'chicago-notes-bibliography': () => import('./csl-styles/chicago-notes-bibliography.csl?raw'),
  'harvard-cite-them-right': () => import('./csl-styles/harvard-cite-them-right.csl?raw'),
  ieee: () => import('./csl-styles/ieee.csl?raw'),
  'american-medical-association': () => import('./csl-styles/american-medical-association.csl?raw'),
  vancouver: () => import('./csl-styles/vancouver.csl?raw'),
  'american-sociological-association': () => import('./csl-styles/american-sociological-association.csl?raw'),
}

const loaded = new Map()
let localeXml = null

/** The style's CSL XML, once `loadStyle` has fetched it; null before. */
export const styleXml = (id) => loaded.get(styleSpec(id).id) || null
export const enLocaleXml = () => localeXml

/** Fetch a style (and the English locale) so formatting in it can run synchronously. */
export async function loadStyle(id) {
  const spec = styleSpec(id)
  if (!localeXml) localeXml = (await import('./csl-styles/locales-en-US.xml?raw')).default
  if (!loaded.has(spec.id)) loaded.set(spec.id, (await LOADERS[spec.file]()).default)
  return spec
}

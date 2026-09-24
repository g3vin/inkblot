/**
 * References: what quick add takes a paste to be, what a page says about itself, the
 * CSL round trip, citeproc's output in the real bundled styles, the lookups against
 * canned answers, and the library file — the parts where a mistake is a wrong entry in
 * someone's bibliography, which nobody notices until a marker does.
 */
import { JSDOM } from 'jsdom'
import { installGlobals } from './install-globals.mjs'
import { files } from './stub-fs.mjs'

const dom = new JSDOM('<!doctype html><html><body></body></html>')
installGlobals(dom.window, ['document', 'navigator', 'DOMParser', 'Node', 'Element', 'HTMLElement', 'CustomEvent'])
Object.defineProperty(globalThis, 'window', { value: dom.window, writable: true, configurable: true })

const R = '../../src/lib/references'
const { identify, isbnIsValid } = await import(`${R}/identify.js`)
const { extractFromHtml } = await import(`${R}/metadata.js`)
const { toCsl, fromCsl, normalizeDate, parseName } = await import(`${R}/csl.js`)
const { loadStyle, CITATION_STYLES } = await import(`${R}/styles.js`)
const { formatDocument, formatLibrary, tidy } = await import(`${R}/format.js`)
const { resolveInput } = await import(`${R}/resolve.js`)
const { REFERENCE_KINDS, missingFields } = await import(`${R}/referenceKinds.js`)
const store = await import(`${R}/referenceStore.js`)
const { saveDocument, renameEntry, duplicateEntry, deleteEntry } = await import('../../src/lib/FileSystem.js')

const ok = (l, c, detail) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); if (!c) { process.exitCode = 1; if (detail !== undefined) console.log('      got:', detail) } }

/* ---------------- identify ---------------- */

ok('a bare DOI', identify('10.1038/nature14539')?.kind === 'doi')
ok('a doi: prefix', identify('doi:10.1038/nature14539')?.value === '10.1038/nature14539')
ok('a doi.org link is the DOI, not a page', identify('https://doi.org/10.1038/nature14539')?.kind === 'doi')
ok('a trailing full stop is not part of a DOI', identify('https://doi.org/10.1000/xyz123.')?.value === '10.1000/xyz123')
ok('an ISBN-13 with hyphens', identify('978-0-14-143951-8')?.value === '9780141439518')
ok('an ISBN-10 with an X check digit', isbnIsValid('080442957X'))
ok('thirteen digits that fail the checksum are a search', identify('9780141439519')?.kind === 'search')
ok('an arXiv id', identify('2106.09685')?.kind === 'arxiv')
ok('an arXiv link', identify('https://arxiv.org/abs/2106.09685v2')?.value === '2106.09685')
ok('a PMID', identify('PMID: 26017442')?.value === '26017442')
ok('a PubMed link', identify('https://pubmed.ncbi.nlm.nih.gov/26017442/')?.kind === 'pmid')
ok('a URL without a scheme', identify('example.com/post')?.value === 'https://example.com/post')
ok('a title is a search', identify('Pride and Prejudice')?.kind === 'search')
ok('nothing is nothing', identify('   ') === null)

/* ---------------- dates and names ---------------- */

ok('ISO timestamp', normalizeDate('2021-03-04T10:00:00Z') === '2021-03-04')
ok('long-form date', normalizeDate('March 4, 2021') === '2021-03-04')
ok('day month year', normalizeDate('4 Mar 2021') === '2021-03-04')
ok('PubMed date', normalizeDate('2015 May 28') === '2015-05-28')
ok('year and month', normalizeDate('2021/03') === '2021-03')
ok('a year alone', normalizeDate('c. 1813') === '1813')
ok('CSL date-parts', normalizeDate({ 'date-parts': [[2015, 5]] }) === '2015-05')
ok('no year, no date', normalizeDate('last Tuesday') === '')
ok('family, given', JSON.stringify(parseName('Austen, Jane')) === JSON.stringify({ role: 'author', family: 'Austen', given: 'Jane' }))
ok('given family', parseName('Jane Q. Austen').family === 'Austen')
ok('a particle stays with the family name', parseName('Ludwig van Beethoven').family === 'van Beethoven')
ok('a suffix is dropped', parseName('Martin Luther King Jr.').family === 'King')
ok('an organisation is a literal', parseName('World Health Organization').literal === 'World Health Organization')
ok('a byline prefix is dropped', parseName('By Maria Cruz').given === 'Maria')

/* ---------------- CSL both ways ---------------- */

const book = {
  id: 'b', kind: 'book',
  contributors: [{ role: 'author', family: 'Austen', given: 'Jane' }, { role: 'editor', literal: 'Penguin Editors' }],
  fields: { title: 'Pride and prejudice', publisher: 'Penguin Classics', 'publisher-place': 'London', issued: '2003' },
}
const csl = toCsl(book)
ok('the kind becomes its CSL type', csl.type === 'book')
ok('names are grouped by role', csl.author[0].family === 'Austen' && csl.editor[0].literal === 'Penguin Editors')
ok('a date becomes date-parts', JSON.stringify(csl.issued) === JSON.stringify({ 'date-parts': [[2003]] }))
const back = fromCsl({ ...csl, type: 'book' })
ok('and back again', back.kind === 'book' && back.fields.issued === '2003' && back.contributors.length === 2)
const crossref = fromCsl({ type: 'article-journal', title: 'Deep <i>learning</i>', 'container-title': ['Nature'], published: { 'date-parts': [[2015, 5, 27]] }, reference: [{}] })
ok('tags come out of a title, an array field takes its first', crossref.fields.title === 'Deep learning' && crossref.fields['container-title'] === 'Nature')
ok('a missing issued falls back on published', crossref.fields.issued === '2015-05-27')

/* ---------------- a page's metadata ---------------- */

const highwire = `<html><head><title>Deep learning | Nature</title>
  <meta name="citation_title" content="Deep learning">
  <meta name="citation_author" content="LeCun, Yann"><meta name="citation_author" content="Bengio, Yoshua">
  <meta name="citation_journal_title" content="Nature"><meta name="citation_volume" content="521">
  <meta name="citation_firstpage" content="436"><meta name="citation_lastpage" content="444">
  <meta name="citation_publication_date" content="2015/05/28"><meta name="citation_doi" content="10.1038/nature14539">
</head></html>`
let page = extractFromHtml(highwire, 'https://www.nature.com/articles/nature14539', { today: '2026-09-23' })
ok('Highwire: a journal article', page.kind === 'journalArticle')
ok('Highwire: authors in order', page.contributors.map((c) => c.family).join() === 'LeCun,Bengio')
ok('Highwire: a page range', page.fields.page === '436–444')
ok('Highwire: the DOI is offered', page.doi === '10.1038/nature14539')

const news = `<html><head><title>City council approves budget - The Daily Planet</title>
  <meta property="og:site_name" content="The Daily Planet">
  <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebSite","name":"x"},
    {"@type":"NewsArticle","headline":"City council approves budget","datePublished":"2024-02-11T08:00:00-05:00",
     "author":[{"@type":"Person","name":"Lois Lane"},{"@type":"Person","name":"Clark Kent"}],
     "publisher":{"@type":"Organization","name":"The Daily Planet"}}]}</script>
</head></html>`
page = extractFromHtml(news, 'https://dailyplanet.example/2024/budget', { today: '2026-09-23' })
ok('JSON-LD in a @graph: a news article', page.kind === 'newsArticle', page.kind)
ok('JSON-LD: the headline, not the <title>', page.fields.title === 'City council approves budget')
ok('JSON-LD: people', page.contributors.length === 2 && page.contributors[1].family === 'Kent')
ok('JSON-LD: the date', page.fields.issued === '2024-02-11')
ok('the site is the container', page.fields['container-title'] === 'The Daily Planet')
ok('accessed is today', page.fields.accessed === '2026-09-23')

page = extractFromHtml(`<html><head><title>Ten tips for writers | Ink &amp; Quill</title>
  <meta property="og:site_name" content="Ink &amp; Quill"><meta name="author" content="Sam Rivera">
  <meta property="article:published_time" content="2023-07-01"></head></html>`, 'https://inkandquill.example/tips')
ok('OpenGraph: the site suffix is taken off the title', page.fields.title === 'Ten tips for writers', page.fields.title)
ok('a loose author tag', page.contributors[0]?.family === 'Rivera')
ok('a page with nothing else is a web page', page.kind === 'webpage')
ok('<title> alone still gives a title', extractFromHtml('<title>Just a page</title>', 'https://x.example/').fields.title === 'Just a page')
ok('a YouTube link is a video', extractFromHtml('<title>x</title>', 'https://www.youtube.com/watch?v=abc').kind === 'video')

/* ---------------- the kinds ---------------- */

ok('every kind has a title-like field first or a required one', REFERENCE_KINDS.every((kind) => kind.fields.some((f) => f.required)))
ok('kind ids are unique', new Set(REFERENCE_KINDS.map((k) => k.id)).size === REFERENCE_KINDS.length)
ok('thirty-odd kinds', REFERENCE_KINDS.length >= 30, REFERENCE_KINDS.length)
ok('missing fields are named', missingFields('journalArticle', { title: 'x' }).includes('container-title'))

/* ---------------- formatting, in the real styles ---------------- */

for (const style of CITATION_STYLES) await loadStyle(style.id)
const article = {
  id: 'a', kind: 'journalArticle',
  contributors: ['LeCun, Yann', 'Bengio, Yoshua', 'Hinton, Geoffrey'].map((name) => parseName(name)),
  fields: { title: 'Deep learning', 'container-title': 'Nature', volume: '521', issue: '7553', page: '436-444', issued: '2015-05-28', DOI: '10.1038/nature14539' },
  annotation: 'The review that named the field.',
}
const site = {
  id: 'w', kind: 'webpage', contributors: [{ role: 'author', literal: 'Purdue OWL' }],
  fields: { title: 'How to cite a website', 'container-title': 'Purdue Online Writing Lab', URL: 'https://owl.purdue.edu', issued: '2021-03' },
}
const library = new Map([['a', article], ['b', book], ['w', site]])
const clusters = [
  { id: 'c1', items: [{ refId: 'a', locator: '437' }] },
  { id: 'c2', items: [{ refId: 'b' }, { refId: 'w' }] },
  { id: 'c3', items: [{ refId: 'gone' }] },
]

let out = formatDocument({ styleId: 'apa', references: library, clusters, annotated: true })
ok('APA: a citation with a page', out.citations.get('c1') === '(LeCun et al., 2015, p. 437)', out.citations.get('c1'))
ok('APA: two sources in one citation', out.citations.get('c2') === '(Austen, 2003; Purdue OWL, 2021)', out.citations.get('c2'))
ok('a deleted source reads as missing', out.citations.get('c3') === '[missing source]')
ok('APA: entries sorted by author', out.entries.map((e) => e.id).join() === 'b,a,w', out.entries.map((e) => e.id))
ok('APA: the book entry, its editor after the title', out.entries[0].html === 'Austen, J. (2003). <i>Pride and prejudice</i> (Penguin Editors, Ed.). Penguin Classics.', out.entries[0].html)
ok('APA: an ampersand survives, escaped', out.entries[1].html.includes('Bengio, Y., &amp; Hinton, G. (2015)'), out.entries[1].html)
ok('an annotated bibliography carries the annotation', out.entries[1].annotation === 'The review that named the field.')

out = formatDocument({ styleId: 'mla', references: library, clusters })
ok('MLA: author and page', out.citations.get('c1') === '(LeCun et al. 437)', out.citations.get('c1'))
ok('MLA: the Works Cited entry, title-cased', out.entries[0].html === 'Austen, Jane. <i>Pride and Prejudice</i>. Edited by Penguin Editors, Penguin Classics, 2003.', out.entries[0].html)

out = formatDocument({ styleId: 'chicago-notes', references: library, clusters })
ok('Chicago notes: citations are note numbers', out.citations.get('c1') === '<sup>1</sup>' && out.citations.get('c2') === '<sup>2</sup>')
ok('Chicago notes: the first note is full', out.notes[0].html.startsWith('Yann LeCun et al., “Deep Learning,” <i>Nature</i> 521'), out.notes[0]?.html)

out = formatDocument({ styleId: 'ieee', references: library, clusters })
ok('IEEE: numbered in order of first citation', out.citations.get('c1') === '[1, p. 437]' && out.citations.get('c2') === '[2], [3]', [...out.citations])
ok('IEEE: the number leads the entry', out.entries[0].html.startsWith('[1] Y. LeCun'), out.entries[0].html)

out = formatDocument({ styleId: 'apa', references: library, clusters: [clusters[0]], include: 'attached', attachedIds: ['a', 'b'] })
ok('"attached" adds uncited attached sources, and only those', out.entries.map((e) => e.id).sort().join() === 'a,b')

const twins = new Map([
  ['s1', { id: 's1', kind: 'book', contributors: [parseName('Smith, Ann')], fields: { title: 'First', publisher: 'P', issued: '2020' } }],
  ['s2', { id: 's2', kind: 'book', contributors: [parseName('Smith, Ann')], fields: { title: 'Second', publisher: 'P', issued: '2020' } }],
])
out = formatDocument({ styleId: 'apa', references: twins, clusters: [{ id: 'x', items: [{ refId: 's1' }] }, { id: 'y', items: [{ refId: 's2' }] }] })
ok('APA: same author, same year is disambiguated', out.citations.get('x') === '(Smith, 2020a)' && out.citations.get('y') === '(Smith, 2020b)', [...out.citations])

const panel = formatLibrary({ styleId: 'apa', references: [article, book, site] })
ok('the panel gets every entry', panel.size === 3 && panel.get('b').entryText.startsWith('Austen, J. (2003)'))
ok('the panel gets how each is cited', panel.get('w').inText === '(Purdue OWL, 2021)', panel.get('w').inText)
ok('tidy keeps only inline formatting', tidy('<div class="csl-entry"><span style="font-variant:small-caps;">x</span> <a href="y">z</a> &#38; <i>w</i></div>') === '<span class="sc">x</span> z &amp; <i>w</i>')

/* ---------------- lookups, against canned answers ---------------- */

const answers = new Map()
const fetcher = async (url, { accept = '' } = {}) => {
  for (const [pattern, answer] of answers) {
    if (url.startsWith(pattern)) return { status: 200, finalUrl: url, contentType: answer.type || 'application/json', body: answer.body, accept }
  }
  return { status: 404, finalUrl: url, contentType: 'text/plain', body: '' }
}
answers.set('https://doi.org/10.1038/nature14539', { body: JSON.stringify({
  type: 'journal-article', title: 'Deep learning', 'container-title': 'Nature', volume: '521', issue: '7553', page: '436-444',
  author: [{ family: 'LeCun', given: 'Yann' }], issued: { 'date-parts': [[2015, 5, 27]] }, DOI: '10.1038/nature14539',
  URL: 'https://doi.org/10.1038/nature14539',
}) })
let found = await resolveInput('10.1038/nature14539', fetcher)
ok('DOI: Crossref\'s type becomes a journal article', found.kind === 'journalArticle')
ok('DOI: the doi.org URL is dropped (the DOI says it)', !found.fields.URL && found.fields.DOI === '10.1038/nature14539')
ok('DOI: origin kept', found.origin.kind === 'doi')

answers.set('https://www.nature.com/articles/nature14539', { type: 'text/html', body: highwire })
found = await resolveInput('https://www.nature.com/articles/nature14539', fetcher)
ok('a page that names its DOI is resolved by the DOI', found.fields.DOI === '10.1038/nature14539' && found.fields['container-title'] === 'Nature' && found.fields.URL === 'https://www.nature.com/articles/nature14539')

answers.set('https://openlibrary.org/api/books?bibkeys=ISBN:9780141439518', { body: JSON.stringify({
  'ISBN:9780141439518': { title: 'Pride and Prejudice', authors: [{ name: 'Jane Austen' }], publishers: [{ name: 'Penguin Classics' }], publish_date: 'April 29, 2003' },
}) })
found = await resolveInput('978-0-14-143951-8', fetcher)
ok('ISBN: a book from Open Library', found.kind === 'book' && found.fields.publisher === 'Penguin Classics' && found.fields.issued === '2003-04-29')

answers.set('https://api.crossref.org/works', { body: JSON.stringify({ message: { items: [
  { type: 'journal-article', title: ['Pride and prejudice in the novel'], author: [{ family: 'Doe', given: 'J' }], 'container-title': ['Lit Q'], issued: { 'date-parts': [[1999]] }, DOI: '10.1/x' },
] } }) })
answers.set('https://openlibrary.org/search.json', { body: JSON.stringify({ docs: [
  { title: 'Pride and Prejudice', author_name: ['Jane Austen'], first_publish_year: 1813, publisher: ['T. Egerton'] },
] }) })
found = await resolveInput('Pride and Prejudice', fetcher)
ok('a title: candidates from both, the book first', found.candidates.length === 2 && found.candidates[0].kind === 'book')
ok('a candidate says who and when', found.candidates[0].detail === 'Austen · 1813 · T. Egerton', found.candidates[0].detail)

let failed = null
try {
  await resolveInput('https://nowhere.example/gone', fetcher)
} catch (error) {
  failed = error
}
ok('a page that cannot be read fails with a reason', failed && /404/.test(failed.message), failed?.message)

/* ---------------- the library file ---------------- */

const P = 'Novel'
await saveDocument(P, 'Part/one', { content: { type: 'doc', content: [] }, notes: [] })
await saveDocument(P, 'Part/two', { content: { type: 'doc', content: [] }, notes: [] })
let events = 0
window.addEventListener(store.REFERENCES_CHANGED_EVENT, () => { events += 1 })

await store.addReference(P, { id: 'r1', kind: 'book', fields: { title: 'A' }, status: 'complete' }, 'Part/one')
await store.addReference(P, { id: 'r2', kind: 'webpage', fields: { title: 'B' } }, 'Part/one')
let lib = await store.loadLibrary(P)
ok('the library is a dotfile at the project root', files.has('/appdata/Novel/.inkblot-references.json'))
ok('newest first', lib.references.map((r) => r.id).join() === 'r2,r1')
ok('attached to the document it was added in', lib.attachments['Part/one'].join() === 'r1,r2')
ok('every write says so', events === 2)

await store.patchReference(P, 'r1', { fields: { publisher: 'Penguin', issued: '2003' }, note: 'check the edition' })
lib = await store.loadLibrary(P)
const r1 = lib.references.find((r) => r.id === 'r1')
ok('a patch merges fields', r1.fields.title === 'A' && r1.fields.publisher === 'Penguin')
ok('a patch sets the note', r1.note === 'check the edition')
ok('a patch settles the status by the kind', r1.status === 'complete')
await store.patchReference(P, 'r1', { fields: { publisher: '' } })
ok('an empty value removes a field, and the source is incomplete again', (await store.loadLibrary(P)).references.find((r) => r.id === 'r1').status === 'incomplete')

await store.setAttached(P, 'Part/two', ['r1', 'nope'], true)
ok('attach only knows real sources', (await store.loadLibrary(P)).attachments['Part/two'].join() === 'r1')

await renameEntry(P, 'Part/one', 'uno')
lib = await store.loadLibrary(P)
ok('a rename carries the attachments', !lib.attachments['Part/one'] && lib.attachments['Part/uno']?.join() === 'r1,r2')
const copy = await duplicateEntry(P, 'Part/uno')
ok('a duplicate gets the same attachments', (await store.loadLibrary(P)).attachments[copy]?.join() === 'r1,r2')
await deleteEntry(P, copy)
ok('a delete drops them', !(await store.loadLibrary(P)).attachments[copy])

await store.removeReference(P, 'r1')
lib = await store.loadLibrary(P)
ok('removing a source takes it off every document', lib.attachments['Part/uno'].join() === 'r2' && !lib.attachments['Part/two'])

await store.updateDocCitations(P, 'Part/uno', (current) => ({ ...current, style: 'mla', bibliography: { ...current.bibliography, annotated: true } }))
ok('a document keeps its own style', (await store.getDocCitations(P, 'Part/uno')).style === 'mla')
await saveDocument(P, 'Part/uno', { content: { type: 'doc', content: [] }, notes: [] })
const settings = await store.getDocCitations(P, 'Part/uno')
ok('an autosave carries the settings forward', settings.style === 'mla' && settings.bibliography.annotated === true && settings.bibliography.include === 'cited')

/**
 * resolve.js — turn what was pasted into a source.
 *
 * Every identifier goes to the service that is the authority for it: doi.org answers
 * in CSL-JSON itself (Crossref, DataCite and mEDRA all behind it), Open Library and
 * Google Books for ISBNs, arXiv's API, PubMed's E-utilities. A web page is read for its
 * own metadata (`metadata.js`), and handed to doi.org when it names a DOI. A title is
 * searched in Crossref and Open Library, and the writer picks.
 *
 * The fetcher is passed in, so the suites drive all of this with canned responses.
 */
import { fromCsl, normalizeDate, parseName, parsePubmedName, describe, todayIso } from './csl'
import { extractFromHtml } from './metadata'
import { identify } from './identify'

const CSL_ACCEPT = 'application/vnd.citationstyles.csl+json'

const json = async (fetcher, url, accept) => {
  const result = await fetcher(url, { accept })
  if (!result || result.status >= 400) throw new Error(`HTTP ${result?.status ?? '?'}`)
  return JSON.parse(result.body)
}

const CROSSREF_TYPES = {
  'journal-article': 'article-journal', 'book-chapter': 'chapter', 'proceedings-article': 'paper-conference',
  'posted-content': 'article', 'reference-entry': 'entry-encyclopedia', monograph: 'book', 'edited-book': 'book',
  'reference-book': 'book', dissertation: 'thesis', 'report-component': 'report',
}

/* ---------------- one per identifier ---------------- */

export async function resolveDoi(doi, fetcher) {
  const item = await json(fetcher, `https://doi.org/${encodeURI(doi)}`, CSL_ACCEPT)
  const record = fromCsl({ ...item, type: CROSSREF_TYPES[item.type] || item.type })
  record.fields.DOI = record.fields.DOI || doi
  // doi.org gives the resolver's own URL; the DOI already says where it is.
  if (/^https?:\/\/(dx\.)?doi\.org\//i.test(record.fields.URL || '')) delete record.fields.URL
  return record
}

export async function resolveIsbn(isbn, fetcher) {
  try {
    const data = await json(fetcher, `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`)
    const book = data[`ISBN:${isbn}`]
    if (book?.title) {
      const fields = { title: [book.title, book.subtitle].filter(Boolean).join(': '), ISBN: isbn }
      const publisher = book.publishers?.[0]?.name
      const place = book.publish_places?.[0]?.name
      const issued = normalizeDate(book.publish_date)
      if (publisher) fields.publisher = publisher
      if (place) fields['publisher-place'] = place
      if (issued) fields.issued = issued
      if (book.number_of_pages) fields['number-of-pages'] = String(book.number_of_pages)
      return {
        kind: 'book',
        contributors: (book.authors || []).map((author) => parseName(author.name)).filter(Boolean),
        fields,
      }
    }
  } catch {
    // Open Library is down or does not know it; Google Books may.
  }
  const data = await json(fetcher, `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`)
  const info = data.items?.[0]?.volumeInfo
  if (!info?.title) throw new Error('No book with that ISBN was found')
  const fields = { title: [info.title, info.subtitle].filter(Boolean).join(': '), ISBN: isbn }
  if (info.publisher) fields.publisher = info.publisher
  const issued = normalizeDate(info.publishedDate)
  if (issued) fields.issued = issued
  if (info.pageCount) fields['number-of-pages'] = String(info.pageCount)
  return { kind: 'book', contributors: (info.authors || []).map((name) => parseName(name)).filter(Boolean), fields }
}

export async function resolveArxiv(id, fetcher) {
  const result = await fetcher(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`, {})
  const doc = new DOMParser().parseFromString(result.body, 'application/xml')
  const entry = doc.getElementsByTagName('entry')[0]
  const text = (el, tag) => (el?.getElementsByTagName(tag)[0]?.textContent || '').replace(/\s+/g, ' ').trim()
  const title = text(entry, 'title')
  if (!entry || !title || /^error$/i.test(title)) throw new Error('No arXiv paper with that id was found')
  const doi = text(entry, 'arxiv:doi')
  if (doi) {
    try {
      return await resolveDoi(doi, fetcher)
    } catch {
      // The published version's DOI did not resolve; the preprint's record will do.
    }
  }
  const contributors = [...entry.getElementsByTagName('author')].map((a) => parseName(text(a, 'name'))).filter(Boolean)
  return {
    kind: 'preprint',
    contributors,
    fields: {
      title,
      publisher: 'arXiv',
      number: `arXiv:${id}`,
      issued: normalizeDate(text(entry, 'published')),
      DOI: `10.48550/arXiv.${id}`,
      URL: `https://arxiv.org/abs/${id}`,
    },
  }
}

export async function resolvePmid(pmid, fetcher) {
  const data = await json(fetcher, `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${pmid}&retmode=json`)
  const item = data.result?.[pmid]
  if (!item?.title) throw new Error('No PubMed record with that id was found')
  const doi = (item.articleids || []).find((id) => id.idtype === 'doi')?.value
  if (doi) {
    try {
      return await resolveDoi(doi, fetcher)
    } catch {
      // Fall back on PubMed's own summary.
    }
  }
  return {
    kind: 'journalArticle',
    contributors: (item.authors || []).map((a) => parsePubmedName(a.name)).filter(Boolean),
    fields: {
      title: item.title.replace(/\.$/, ''),
      'container-title': item.fulljournalname || item.source,
      volume: item.volume || '',
      issue: item.issue || '',
      page: item.pages || '',
      issued: normalizeDate(item.pubdate),
      URL: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
    },
  }
}

const OEMBED = [
  [/(^|\.)youtube\.com$|(^|\.)youtu\.be$/, (url) => `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`],
  [/(^|\.)vimeo\.com$/, (url) => `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`],
]

export async function resolveUrl(url, fetcher, { today = todayIso() } = {}) {
  const host = new URL(url).hostname.replace(/^www\.|^m\./, '')
  let page = null
  let error = null
  try {
    const result = await fetcher(url, { accept: 'text/html,application/xhtml+xml' })
    if (result.status < 400 && /html|xml|^$/i.test(result.contentType || '')) page = result
    else if (result.status >= 400) error = new Error(`The page answered ${result.status}`)
  } catch (caught) {
    error = caught
  }
  const record = page
    ? extractFromHtml(page.body, page.finalUrl || url, { today })
    : { kind: 'webpage', contributors: [], fields: { URL: url, accessed: today }, doi: '' }

  // A page that names its DOI is better described by the DOI's registrar.
  if (record.doi && ['journalArticle', 'conferencePaper', 'book', 'report', 'thesis', 'preprint', 'webpage'].includes(record.kind)) {
    try {
      const better = await resolveDoi(record.doi, fetcher)
      better.fields.URL = better.fields.URL || url
      return better
    } catch {
      // Keep what the page said.
    }
  }

  const oembed = OEMBED.find(([pattern]) => pattern.test(host))
  if (oembed) {
    try {
      const data = await json(fetcher, oembed[1](url))
      if (data.title) record.fields.title = data.title
      if (data.author_name && !record.contributors.length) record.contributors = [{ role: 'author', literal: data.author_name }]
      record.fields['container-title'] = host.includes('vimeo') ? 'Vimeo' : 'YouTube'
      record.kind = 'video'
    } catch {
      // The page's own tags are enough.
    }
  }
  if (!page && !record.fields.title) throw error || new Error('The page could not be read')
  delete record.doi
  return record
}

/* ---------------- a title ---------------- */

const crossrefToRecord = (item) => {
  const record = fromCsl({
    ...item,
    type: CROSSREF_TYPES[item.type] || item.type,
    title: [].concat(item.title || [])[0],
    'container-title': [].concat(item['container-title'] || [])[0],
  })
  if (item.DOI) record.fields.DOI = item.DOI
  delete record.fields.URL
  return record
}

export async function searchTitle(query, fetcher) {
  const q = encodeURIComponent(query)
  const [crossref, books] = await Promise.allSettled([
    json(fetcher, `https://api.crossref.org/works?rows=4&query.bibliographic=${q}&select=DOI,title,author,editor,issued,container-title,type,publisher,volume,issue,page,ISBN`),
    json(fetcher, `https://openlibrary.org/search.json?limit=3&q=${q}&fields=title,subtitle,author_name,first_publish_year,publisher,isbn,publish_place`),
  ])
  const articles = crossref.status === 'fulfilled'
    ? (crossref.value.message?.items || []).filter((item) => item.title?.length).map(crossrefToRecord)
    : []
  const volumes = books.status === 'fulfilled'
    ? (books.value.docs || []).filter((doc) => doc.title).map((doc) => {
      const fields = { title: [doc.title, doc.subtitle].filter(Boolean).join(': ') }
      if (doc.first_publish_year) fields.issued = String(doc.first_publish_year)
      if (doc.publisher?.[0]) fields.publisher = doc.publisher[0]
      if (doc.isbn?.[0]) fields.ISBN = doc.isbn[0]
      return { kind: 'book', contributors: (doc.author_name || []).map((name) => parseName(name)).filter(Boolean), fields }
    })
    : []
  // Interleave so a book title is not buried under four articles, and vice versa.
  const merged = []
  for (let i = 0; merged.length < 5 && (i < articles.length || i < volumes.length); i += 1) {
    if (volumes[i]) merged.push(volumes[i])
    if (articles[i] && merged.length < 5) merged.push(articles[i])
  }
  return merged.map((record) => ({ ...record, title: record.fields.title || '', detail: describe(record) }))
}

/* ---------------- the entry point ---------------- */

/**
 * What quick add found for `input`: `{ origin, kind, contributors, fields }` for an
 * identifier or a URL, `{ origin, candidates }` for a title. Throws with a message
 * fit for the writer when a lookup fails.
 */
export async function resolveInput(input, fetcher, options = {}) {
  const found = identify(input)
  if (!found) throw new Error('Nothing to look up')
  const origin = { kind: found.kind, input: String(input).trim() }
  switch (found.kind) {
    case 'doi': return { origin, ...(await resolveDoi(found.value, fetcher)) }
    case 'isbn': return { origin, ...(await resolveIsbn(found.value, fetcher)) }
    case 'arxiv': return { origin, ...(await resolveArxiv(found.value, fetcher)) }
    case 'pmid': return { origin, ...(await resolvePmid(found.value, fetcher)) }
    case 'url': return { origin, ...(await resolveUrl(found.value, fetcher, options)) }
    default: return { origin, candidates: await searchTitle(found.value, fetcher) }
  }
}

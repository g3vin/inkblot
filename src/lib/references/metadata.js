/**
 * metadata.js — what a web page says about itself, as a source.
 *
 * Pages describe themselves in several vocabularies, of varying trust. In order:
 *
 *   1. Highwire Press `citation_*` tags — put there for Google Scholar, by publishers
 *      who mean them. A `citation_doi` sends the lookup to doi.org instead.
 *   2. JSON-LD (schema.org) — what news sites and blogs fill in for search engines.
 *   3. Dublin Core — libraries, repositories, older academic sites.
 *   4. OpenGraph, Twitter cards and loose `author` / date tags — every site, loosely.
 *   5. `<title>`.
 *
 * Earlier vocabularies win field by field, so a page with a good JSON-LD author and
 * only an OpenGraph site name gets both.
 */
import { normalizeDate, parseName, todayIso } from './csl'

const NEWS_HOSTS = /(^|\.)(nytimes|washingtonpost|theguardian|guardian|bbc|reuters|apnews|cnn|wsj|npr|ft|economist|bloomberg|latimes|nbcnews|cbsnews|abcnews|aljazeera|usatoday|politico|axios|theatlantic|newyorker|time|vox|foxnews|independent|telegraph|thetimes|nypost|chicagotribune|bostonglobe|sfchronicle|cnbc|forbes|businessinsider|huffpost|slate|salon|vice|wired|theverge|arstechnica|techcrunch)\.(com|co\.uk|org|net)$/i
const SOCIAL_HOSTS = /(^|\.)(twitter\.com|x\.com|facebook\.com|instagram\.com|threads\.net|bsky\.app|reddit\.com|linkedin\.com|tiktok\.com|mastodon\.social)$/i
const VIDEO_HOSTS = /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com|ted\.com)$/i
const PODCAST_HOSTS = /(^|\.)(podcasts\.apple\.com|open\.spotify\.com|overcast\.fm|pca\.st)$/i
const PLATFORM_NAMES = { 'youtube.com': 'YouTube', 'youtu.be': 'YouTube', 'vimeo.com': 'Vimeo', 'x.com': 'X', 'twitter.com': 'X',
  'reddit.com': 'Reddit', 'instagram.com': 'Instagram', 'facebook.com': 'Facebook', 'tiktok.com': 'TikTok',
  'linkedin.com': 'LinkedIn', 'threads.net': 'Threads', 'bsky.app': 'Bluesky', 'en.wikipedia.org': 'Wikipedia' }

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim()

/* ---------------- reading the page ---------------- */

const metaAll = (doc, names) => {
  const wanted = names.map((name) => name.toLowerCase())
  const out = []
  for (const el of doc.querySelectorAll('meta')) {
    const key = (el.getAttribute('name') || el.getAttribute('property') || el.getAttribute('itemprop') || '').toLowerCase()
    if (wanted.includes(key)) {
      const content = clean(el.getAttribute('content'))
      if (content) out.push(content)
    }
  }
  return out
}
const meta = (doc, ...names) => metaAll(doc, names)[0] || ''

const LD_TYPES = ['NewsArticle', 'ReportageNewsArticle', 'AnalysisNewsArticle', 'Article', 'BlogPosting', 'ScholarlyArticle',
  'TechArticle', 'Report', 'Book', 'Chapter', 'VideoObject', 'PodcastEpisode', 'SocialMediaPosting', 'WebPage', 'Movie',
  'Dataset', 'SoftwareApplication', 'Thesis', 'CreativeWork', 'MusicRecording']

const typesOf = (node) => [].concat(node?.['@type'] || [])

function jsonLd(doc) {
  const nodes = []
  const walk = (value) => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) { value.forEach(walk); return }
    if (value['@graph']) walk(value['@graph'])
    if (value['@type']) nodes.push(value)
  }
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      walk(JSON.parse(script.textContent || ''))
    } catch {
      // A broken block is common; the page's other vocabularies still count.
    }
  }
  for (const type of LD_TYPES) {
    const hit = nodes.find((node) => typesOf(node).includes(type))
    if (hit) return { node: hit, nodes }
  }
  return { node: null, nodes }
}

const ldText = (value) => {
  if (!value) return ''
  if (typeof value === 'string') return clean(value)
  if (Array.isArray(value)) return ldText(value[0])
  return clean(value.name || value['@value'] || '')
}

const ldPeople = (value) => [].concat(value || [])
  .map((person) => (typeof person === 'string' ? person : person?.name))
  .map(clean)
  .filter((name) => name && !/^https?:/i.test(name))

/* ---------------- the result ---------------- */

const stripSiteSuffix = (title, site) => {
  let out = clean(title)
  if (site) {
    const escaped = site.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    out = out.replace(new RegExp(`\\s*[|\\-–—:·]\\s*${escaped}\\s*$`, 'i'), '').replace(new RegExp(`^${escaped}\\s*[|\\-–—:·]\\s*`, 'i'), '')
  }
  return out
}

const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\.|^m\./, '')
  } catch {
    return ''
  }
}

/** A readable site name from a host: "nytimes.com" → "Nytimes" is worse than nothing,
 *  so only well-known ones are named and the rest keep the host. */
const siteFromHost = (host) => PLATFORM_NAMES[host] || host

function kindFor({ url, ldTypes, ogType, highwire }) {
  const host = hostOf(url)
  if (highwire.journal) return 'journalArticle'
  if (highwire.conference) return 'conferencePaper'
  if (highwire.thesis) return 'thesis'
  if (highwire.report) return 'report'
  if (VIDEO_HOSTS.test(host) || ldTypes.includes('VideoObject') || /^video/.test(ogType)) return 'video'
  if (PODCAST_HOSTS.test(host) || ldTypes.includes('PodcastEpisode')) return 'podcast'
  if (SOCIAL_HOSTS.test(host) || ldTypes.includes('SocialMediaPosting')) return 'socialPost'
  if (/wikipedia\.org$/.test(host)) return 'encyclopediaEntry'
  if (ldTypes.includes('ScholarlyArticle')) return 'journalArticle'
  if (ldTypes.includes('Book') || ogType === 'book') return 'book'
  if (ldTypes.includes('Movie')) return 'film'
  if (ldTypes.includes('Dataset')) return 'dataset'
  if (ldTypes.includes('SoftwareApplication')) return 'software'
  if (ldTypes.includes('BlogPosting')) return 'blogPost'
  if (ldTypes.some((type) => /NewsArticle$/.test(type)) || NEWS_HOSTS.test(host)) return 'newsArticle'
  return 'webpage'
}

/**
 * A source from a page's HTML: `{ kind, contributors, fields, doi }`. `doi` is set
 * when the page names one, for the caller to prefer.
 */
export function extractFromHtml(html, url, { today = todayIso() } = {}) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html')
  const host = hostOf(url)
  const { node: ld } = jsonLd(doc)
  const ldTypes = typesOf(ld)

  const highwire = {
    title: meta(doc, 'citation_title'),
    authors: metaAll(doc, ['citation_author']),
    date: meta(doc, 'citation_publication_date', 'citation_date', 'citation_online_date', 'citation_cover_date'),
    journal: meta(doc, 'citation_journal_title'),
    conference: meta(doc, 'citation_conference_title'),
    thesis: meta(doc, 'citation_dissertation_institution'),
    report: meta(doc, 'citation_technical_report_institution'),
    volume: meta(doc, 'citation_volume'),
    issue: meta(doc, 'citation_issue'),
    first: meta(doc, 'citation_firstpage'),
    last: meta(doc, 'citation_lastpage'),
    publisher: meta(doc, 'citation_publisher'),
    doi: meta(doc, 'citation_doi', 'dc.identifier.doi', 'prism.doi').replace(/^(https?:\/\/(dx\.)?doi\.org\/|doi:)/i, ''),
    isbn: meta(doc, 'citation_isbn'),
    book: meta(doc, 'citation_inbook_title', 'citation_book_title'),
  }
  const dc = {
    title: meta(doc, 'dc.title', 'dcterms.title'),
    creators: metaAll(doc, ['dc.creator', 'dcterms.creator', 'dc.contributor.author']),
    date: meta(doc, 'dc.date', 'dcterms.date', 'dcterms.issued', 'dc.date.issued'),
    publisher: meta(doc, 'dc.publisher', 'dcterms.publisher'),
  }
  const og = {
    title: meta(doc, 'og:title', 'twitter:title'),
    site: meta(doc, 'og:site_name', 'application-name'),
    type: meta(doc, 'og:type').toLowerCase(),
    date: meta(doc, 'article:published_time', 'og:published_time', 'datePublished', 'uploadDate', 'date', 'pubdate',
      'publish-date', 'parsely-pub-date', 'sailthru.date', 'article.published'),
    authors: metaAll(doc, ['author', 'article:author', 'parsely-author', 'sailthru.author', 'byl', 'twitter:creator'])
      .filter((name) => !/^https?:|^@/.test(name)),
  }

  const site = clean(highwire.journal || ldText(ld?.isPartOf) || ldText(ld?.publisher) || og.site || dc.publisher)
    || siteFromHost(host)
  const rawTitle = highwire.title || ldText(ld?.headline) || ldText(ld?.name) || dc.title || og.title
    || clean(doc.querySelector('title')?.textContent)
  const title = stripSiteSuffix(rawTitle, og.site || site)

  const people = highwire.authors.length ? highwire.authors
    : ldPeople(ld?.author || ld?.creator).length ? ldPeople(ld?.author || ld?.creator)
      : dc.creators.length ? dc.creators : og.authors.flatMap((a) => a.split(/\s*(?:,| and |&)\s*(?=[A-Z])/))
  const kind = kindFor({ url, ldTypes, ogType: og.type, highwire })
  const contributors = [...new Set(people)].map((name) => parseName(name)).filter(Boolean)

  const fields = {}
  const set = (key, value) => { if (clean(value)) fields[key] = clean(value) }
  set('title', title)
  set('issued', normalizeDate(highwire.date || ldText(ld?.datePublished) || ldText(ld?.uploadDate) || dc.date || og.date))
  set('URL', meta(doc, 'og:url') && hostOf(meta(doc, 'og:url')) === host ? url : url)
  set('accessed', today)
  if (kind === 'journalArticle' || kind === 'conferencePaper') {
    set('container-title', highwire.journal || highwire.conference)
    set('volume', highwire.volume)
    set('issue', highwire.issue)
    set('page', highwire.first && highwire.last ? `${highwire.first}–${highwire.last}` : highwire.first)
    set('publisher', highwire.publisher)
    if (kind === 'conferencePaper') set('event-title', highwire.conference)
  } else if (kind === 'thesis') {
    set('publisher', highwire.thesis)
    set('genre', 'Doctoral dissertation')
  } else if (kind === 'report') {
    set('publisher', highwire.report || site)
  } else if (kind === 'book') {
    set('publisher', highwire.publisher || ldText(ld?.publisher) || site)
    set('ISBN', highwire.isbn || ldText(ld?.isbn))
  } else if (kind === 'encyclopediaEntry') {
    set('container-title', site === host ? 'Wikipedia' : site)
  } else {
    set('container-title', site)
    if (kind === 'webpage' && ldText(ld?.publisher) && ldText(ld?.publisher) !== site) set('publisher', ldText(ld?.publisher))
  }
  if (kind === 'video' && ld?.duration) {
    const m = String(ld.duration).match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
    if (m) set('dimensions', [m[1], m[2] || '0', (m[3] || '0').padStart(2, '0')].filter((part, i) => i || part).join(':'))
  }
  if (highwire.doi) set('DOI', highwire.doi)

  return { kind, contributors, fields, doi: highwire.doi || '' }
}

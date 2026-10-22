/**
 * identify.js — what a writer pasted into quick add.
 *
 * Order matters: a doi.org or arxiv.org link is its identifier, not a web page, and an
 * ISBN is checked by its checksum so a thirteen-digit number that is not one falls
 * through to a title search rather than failing a lookup.
 */

const DOI = /\b(10\.\d{4,9}\/[^\s"<>]+)/i

const cleanDoi = (doi) => decodeURIComponent(doi).replace(/[.,;)\]]+$/, '')

export function isbnIsValid(digits) {
  if (/^\d{9}[\dX]$/i.test(digits)) {
    const sum = digits.split('').reduce((acc, ch, i) => acc + (ch.toUpperCase() === 'X' ? 10 : Number(ch)) * (10 - i), 0)
    return sum % 11 === 0
  }
  if (/^\d{13}$/.test(digits)) {
    const sum = digits.split('').reduce((acc, ch, i) => acc + Number(ch) * (i % 2 ? 3 : 1), 0)
    return sum % 10 === 0 && /^97[89]/.test(digits)
  }
  return false
}

/**
 * `{ kind: 'url' | 'doi' | 'isbn' | 'arxiv' | 'pmid' | 'search', value }`, or null for
 * nothing at all.
 */
export function identify(raw) {
  const input = String(raw || '').trim()
  if (!input) return null

  const url = input.match(/^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?(\/\S*)?$/i) && !/\s/.test(input)
    ? (/^https?:\/\//i.test(input) ? input : `https://${input}`)
    : null
  if (url) {
    let parsed
    try {
      parsed = new URL(url)
    } catch {
      parsed = null
    }
    if (parsed) {
      const host = parsed.hostname.replace(/^www\./, '')
      if (host === 'doi.org' || host === 'dx.doi.org') {
        const doi = parsed.pathname.slice(1)
        if (DOI.test(doi)) return { kind: 'doi', value: cleanDoi(doi.match(DOI)[1]) }
      }
      if (host === 'arxiv.org') {
        const id = parsed.pathname.match(/\/(?:abs|pdf)\/([^/?#]+?)(?:v\d+)?(?:\.pdf)?$/)
        if (id) return { kind: 'arxiv', value: id[1] }
      }
      if (host === 'pubmed.ncbi.nlm.nih.gov') {
        const id = parsed.pathname.match(/^\/(\d+)/)
        if (id) return { kind: 'pmid', value: id[1] }
      }
      return { kind: 'url', value: parsed.href }
    }
  }

  const doi = input.replace(/^doi:\s*/i, '').match(/^(10\.\d{4,9}\/\S+)$/i)
  if (doi) return { kind: 'doi', value: cleanDoi(doi[1]) }

  const arxiv = input.match(/^(?:arxiv:\s*)?(\d{4}\.\d{4,5})(?:v\d+)?$/i) || input.match(/^arxiv:\s*([a-z-]+(?:\.[A-Z]{2})?\/\d{7})$/i)
  if (arxiv) return { kind: 'arxiv', value: arxiv[1] }

  const pmid = input.match(/^(?:pmid:?\s*)(\d{1,9})$/i)
  if (pmid) return { kind: 'pmid', value: pmid[1] }

  const isbn = input.replace(/^isbn(?:-1[03])?:?\s*/i, '').replace(/[\s-]/g, '')
  if (isbnIsValid(isbn)) return { kind: 'isbn', value: isbn.toUpperCase() }

  return { kind: 'search', value: input }
}

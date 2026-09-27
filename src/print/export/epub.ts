/**
 * epub.ts — a document or a book as an EPUB 3 file.
 *
 * One XHTML file per chapter, a navigation document (and an NCX, which older
 * readers and some Kindle converters still look for), the package document with its
 * required metadata, and every embedded image written out as a file of its own.
 *
 * An EPUB is reflowable: the reader chooses the page size and the font size, so the
 * page setup's paper, margins and columns are deliberately not carried over. What is
 * carried over is structure — chapters, headings, page breaks as `break-after`.
 */
import { createZip } from './zip'
import type { ZipEntry } from './zip'
import type { FrontSection } from '../bookMatter'
import { chapterBodyHtml, escapeHtml, frontSectionHtml, PROSE_CSS } from './html'
import type { ExportChapter } from './html'
import { collectImageSources, mapImageSources } from './portable'
import { isRemote } from './images'
import type { ResolvedImage } from './images'

const XHTML_NS = 'http://www.w3.org/1999/xhtml'

/** The EPUB structural semantics of each front-matter page. */
const FRONT_TYPES: Record<FrontSection['kind'], string> = {
  halfTitle: 'halftitlepage',
  titlePage: 'titlepage',
  copyright: 'copyright-page',
  dedication: 'dedication',
  epigraph: 'epigraph',
}

export interface EpubOptions {
  title: string
  author?: string
  language?: string
  chapters: ExportChapter[]
  /** Turns an image src into bytes, or null to drop it. */
  resolveImage: (src: string) => Promise<ResolvedImage | null>
  cover?: ResolvedImage | null
  /** A book's pages before its first chapter. */
  front?: FrontSection[]
  /** A contents page in the reading order, as well as the reader's own navigation. */
  contents?: boolean
  /** The book's stylesheet (`ebookCss`); the plain prose rules without one. */
  css?: string | null
  /** Font files to embed, each declared in the stylesheet for its family. */
  fonts?: Array<{ family: string; weight: number; style: string; format: string; mime: string; file: string; bytes: Uint8Array }>
  /** Fixed for tests; a fresh urn:uuid otherwise. */
  identifier?: string
  modified?: Date
}

const uuid = () => (globalThis.crypto?.randomUUID
  ? globalThis.crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  }))

/** HTML → well-formed XHTML body content, through the DOM so nothing is left unclosed. */
export const toXhtmlBody = (html: string): string => {
  const parsed = new DOMParser().parseFromString(`<!doctype html><html><body>${html}</body></html>`, 'text/html')
  const doc = document.implementation.createDocument(XHTML_NS, 'html', null)
  const body = doc.createElementNS(XHTML_NS, 'body')
  for (const node of Array.from(parsed.body.childNodes)) body.appendChild(doc.importNode(node, true))
  // Attributes EPUB validators reject, and that mean nothing outside the editor.
  body.querySelectorAll('[contenteditable]').forEach((el) => el.removeAttribute('contenteditable'))
  body.querySelectorAll('[draggable]').forEach((el) => el.removeAttribute('draggable'))
  const serializer = new XMLSerializer()
  return Array.from(body.childNodes).map((n) => serializer.serializeToString(n))
    .join('\n')
    // Each top-level element carries the namespace already declared on <html>.
    .replace(/ xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/g, '')
}

const xhtmlPage = (title: string, language: string, body: string, extraHead = '') => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="${XHTML_NS}" xmlns:epub="http://www.idpf.org/2007/ops" lang="${escapeHtml(language)}" xml:lang="${escapeHtml(language)}">
<head>
<meta charset="utf-8"/>
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" type="text/css" href="../styles.css"/>${extraHead}
</head>
<body>
${body}
</body>
</html>
`

export const buildEpub = async (options: EpubOptions): Promise<Uint8Array> => {
  const language = options.language || 'en'
  const title = options.title || 'Untitled'
  const identifier = options.identifier || `urn:uuid:${uuid()}`
  const modified = (options.modified || new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z')

  // Images: each distinct src once, numbered in order of first appearance.
  const images = new Map<string, { href: string; mime: string; bytes: Uint8Array } | null>()
  let imageIndex = 0
  for (const chapter of options.chapters) {
    for (const src of collectImageSources(chapter.content)) {
      if (images.has(src)) continue
      const resolved = isRemote(src) ? null : await options.resolveImage(src)
      if (!resolved) {
        images.set(src, null)
        continue
      }
      imageIndex += 1
      images.set(src, { href: `images/image-${imageIndex}.${resolved.ext}`, mime: resolved.mime, bytes: resolved.bytes })
    }
  }

  const chapterFiles = options.chapters.map((chapter, i) => {
    const content = mapImageSources(chapter.content, (src) => {
      const img = images.get(src)
      return img ? `../${img.href}` : ''
    })
    const body = toXhtmlBody(chapterBodyHtml(content))
      // An image that could not be packaged would be a broken reference: drop it.
      .replace(/<img[^>]*src=""[^>]*\/>/g, '')
    const id = `chapter-${String(i + 1).padStart(3, '0')}`
    // A page before the chapters is front matter to a reading system, not a chapter.
    const type = chapter.inContents === false ? 'frontmatter' : 'chapter'
    return {
      id,
      href: `text/${id}.xhtml`,
      title: chapter.title,
      inContents: chapter.inContents,
      xhtml: xhtmlPage(chapter.title, language, `<section epub:type="${type}" id="${id}">\n${body}\n</section>`),
    }
  })

  const frontFiles = (options.front || []).map((section, i) => {
    const id = `front-${String(i + 1).padStart(2, '0')}`
    return {
      id,
      href: `text/${id}.xhtml`,
      xhtml: xhtmlPage(title, language, `<section epub:type="${FRONT_TYPES[section.kind]}" class="front-matter fm-${section.kind}">\n${toXhtmlBody(frontSectionHtml(section))}\n</section>`),
    }
  })
  const contentsPage = options.contents && chapterFiles.length
    ? xhtmlPage('Contents', language, `<section epub:type="toc" class="contents">\n<h1>Contents</h1>\n<ol>\n${chapterFiles.filter((c) => c.inContents !== false).map((c) => `<li><a href="${c.href.replace('text/', '')}">${escapeHtml(c.title)}</a></li>`).join('\n')}\n</ol>\n</section>`)
    : null

  const cover = options.cover || null
  const coverHref = cover ? `images/cover.${cover.ext}` : null
  const coverPage = cover
    ? xhtmlPage(title, language, `<section epub:type="cover" class="cover"><img src="../${coverHref}" alt="${escapeHtml(title)}"/></section>`)
    : null

  const nav = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="${XHTML_NS}" xmlns:epub="http://www.idpf.org/2007/ops" lang="${escapeHtml(language)}" xml:lang="${escapeHtml(language)}">
<head><meta charset="utf-8"/><title>${escapeHtml(title)}</title></head>
<body>
<nav epub:type="toc" id="toc">
<h1>Contents</h1>
<ol>
${chapterFiles.map((c) => `<li><a href="${c.href}">${escapeHtml(c.title)}</a></li>`).join('\n')}
</ol>
</nav>
<nav epub:type="landmarks" hidden="hidden">
<ol>
${cover ? '<li><a epub:type="cover" href="text/cover.xhtml">Cover</a></li>\n' : ''}${contentsPage ? '<li><a epub:type="toc" href="text/contents.xhtml">Contents</a></li>\n' : ''}<li><a epub:type="bodymatter" href="${(chapterFiles.find((c) => c.inContents !== false) || chapterFiles[0])?.href || ''}">Start</a></li>
</ol>
</nav>
</body>
</html>
`

  const ncx = `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head>
<meta name="dtb:uid" content="${escapeHtml(identifier)}"/>
<meta name="dtb:depth" content="1"/>
<meta name="dtb:totalPageCount" content="0"/>
<meta name="dtb:maxPageNumber" content="0"/>
</head>
<docTitle><text>${escapeHtml(title)}</text></docTitle>
<navMap>
${chapterFiles.map((c, i) => `<navPoint id="nav-${i + 1}" playOrder="${i + 1}"><navLabel><text>${escapeHtml(c.title)}</text></navLabel><content src="${c.href}"/></navPoint>`).join('\n')}
</navMap>
</ncx>
`

  const fonts = (options.fonts || []).map((font, i) => ({
    ...font,
    id: `font-${i + 1}`,
    href: `fonts/${font.file.replace(/[^\w.-]+/g, '_')}`,
  }))
  const fontFaces = fonts.map((f) => `@font-face { font-family: "${f.family.replace(/"/g, '')}"; src: url("${f.href}") format("${f.format}"); font-weight: ${f.weight}; font-style: ${f.style}; }`).join('\n')

  const packaged = [...images.values()].filter(Boolean) as Array<{ href: string; mime: string; bytes: Uint8Array }>
  const manifest = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
    '<item id="css" href="styles.css" media-type="text/css"/>',
    ...(cover ? [
      `<item id="cover-image" href="${coverHref}" media-type="${cover.mime}" properties="cover-image"/>`,
      '<item id="cover" href="text/cover.xhtml" media-type="application/xhtml+xml"/>',
    ] : []),
    ...frontFiles.map((f) => `<item id="${f.id}" href="${f.href}" media-type="application/xhtml+xml"/>`),
    ...(contentsPage ? ['<item id="contents" href="text/contents.xhtml" media-type="application/xhtml+xml"/>'] : []),
    ...chapterFiles.map((c) => `<item id="${c.id}" href="${c.href}" media-type="application/xhtml+xml"/>`),
    ...packaged.map((img, i) => `<item id="image-${i + 1}" href="${img.href}" media-type="${img.mime}"/>`),
    ...fonts.map((f) => `<item id="${f.id}" href="${f.href}" media-type="${f.mime}"/>`),
  ]
  const spine = [
    ...(cover ? ['<itemref idref="cover" linear="yes"/>'] : []),
    ...frontFiles.map((f) => `<itemref idref="${f.id}"/>`),
    ...(contentsPage ? ['<itemref idref="contents"/>'] : []),
    ...chapterFiles.map((c) => `<itemref idref="${c.id}"/>`),
  ]
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${escapeHtml(language)}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="book-id">${escapeHtml(identifier)}</dc:identifier>
<dc:title>${escapeHtml(title)}</dc:title>
<dc:language>${escapeHtml(language)}</dc:language>
${options.author ? `<dc:creator id="author">${escapeHtml(options.author)}</dc:creator>\n<meta refines="#author" property="role" scheme="marc:relators">aut</meta>\n` : ''}<meta property="dcterms:modified">${modified}</meta>
${cover ? '<meta name="cover" content="cover-image"/>\n' : ''}</metadata>
<manifest>
${manifest.join('\n')}
</manifest>
<spine toc="ncx">
${spine.join('\n')}
</spine>
</package>
`

  const container = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles>
<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
</rootfiles>
</container>
`

  const entries: ZipEntry[] = [
    { name: 'mimetype', data: 'application/epub+zip', store: true },
    { name: 'META-INF/container.xml', data: container },
    { name: 'OEBPS/content.opf', data: opf },
    { name: 'OEBPS/nav.xhtml', data: nav },
    { name: 'OEBPS/toc.ncx', data: ncx },
    { name: 'OEBPS/styles.css', data: `${fontFaces ? `${fontFaces}\n` : ''}${options.css || PROSE_CSS}\n.cover { text-align: center; } .cover img { max-height: 100%; }\n` },
    ...(cover && coverPage ? [
      { name: `OEBPS/${coverHref}`, data: cover.bytes, store: true },
      { name: 'OEBPS/text/cover.xhtml', data: coverPage },
    ] : []),
    ...frontFiles.map((f) => ({ name: `OEBPS/${f.href}`, data: f.xhtml })),
    ...(contentsPage ? [{ name: 'OEBPS/text/contents.xhtml', data: contentsPage }] : []),
    ...chapterFiles.map((c) => ({ name: `OEBPS/${c.href}`, data: c.xhtml })),
    // Images are already compressed; deflating them again costs time for nothing.
    ...packaged.map((img) => ({ name: `OEBPS/${img.href}`, data: img.bytes, store: true })),
    ...fonts.map((f) => ({ name: `OEBPS/${f.href}`, data: f.bytes })),
  ]
  return createZip(entries)
}

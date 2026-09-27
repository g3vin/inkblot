# Changelog

Notable changes to Inkblot. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Typeset and Print & Export:** the Finishing layout's Page, Book and Publish tabs
  are two tabs in the order a book is made — Typeset (what is in the book, the page,
  the type, how chapters open, the running heads, the front and back matter), then
  Print & Export. A saved layout shows the new tabs where the old ones were.
- **Write and Typeset modes:** one switch, first in the toolbar (and ⌥⌘P), for the
  whole window. Typeset shows every text pane as its pages, with a typesetting toolbar
  and the Typeset panels; a chapter's prose is locked there — it is written and proofed
  in Write — while its title, breaks and attributes can still be set. Double-clicking
  locked prose offers Edit Text, a round trip to Write and back to the same page.
  Typesetting edits no longer add text-history checkpoints. This replaces the
  per-document Print Layout switch.
- **The Book navigator:** in Typeset, the left sidebar is the book's contents in the
  book's own order — front matter, parts, chapters, back matter. Drag to reorder the
  book without touching the file tree; hide any entry from the pages, print and export.
  Front and back matter (a dedication, a copyright page, About the Author, …) are pages
  of their own, made only when added, with pictures, history and everything else a
  document has; a half title, title page and contents are laid out from the book. A
  Files | Book switch shows either sidebar in either mode. Chapters can be made a
  prologue, an epilogue or an interlude, which the book does not number. The front
  matter is numbered in roman, and the contents give each chapter's page. A book set up
  before keeps its text front and back matter, which become pages when first changed.
- **Chapter openings and book styles:** a book's chapters open with a designed head —
  "Chapter One" (from 0 or 1, in words, numerals or roman), the title, a subtitle, an
  ornament (a rule, a glyph or a picture) and the chapter's own picture, placed above,
  between or below, left, centred or right, in capitals, small capitals or italic, in
  the body's face or one of its own — the same in print, the PDF, the EPUB, HTML, Word,
  Markdown and text. Each chapter's subtitle, picture and epigraph are its own. Chapters
  can start on a new page, a right-hand page, or run straight on. Seven book styles
  (Classic, Elegant, Modern, Minimal, Ornate, Large Print, Manuscript) set all of it —
  type, heads, running heads — in one click. Pictures in the text are set to the text
  block and kept with their captions, and preflight uses the book's minimum resolution.
- **The whole book in Typeset:** the chapter open is set live among the rest of the
  book's pages — the same pages Print makes, recomposed in the background as the book
  changes — on the side of the spread it opens on and numbered on from the page before.
  Its designed head is drawn around its real title, and its subtitle and epigraph are
  typed in place. Clicking another entry's page opens it.
- **Typesetting on the page:** drag the text block's edges to set the margins (the
  inside and outside as the spread has them; ⌥ both, ⇧ unsnapped), drag the running
  head and foot to move them and click them to edit what they say and the folio, drag a
  chapter's head down its page, move its picture above, between or below and size it by
  its corner, drop a picture onto it, click a scene break for its glyph and the opening
  letter for a drop cap, and snap a picture in the text to the text block. Each shows
  its value as it moves, commits once when let go, and opens its section in the Typeset
  tab. A change to the whole book offers to be undone.
- **Typeset history:** a book's typesetting has a history of its own, apart from the
  text's. A version is kept a while after the typesetting changes, when saved under a
  name (⌥⌘S), and every time the book is printed or exported — so the interior sent to
  the printer can always be had again. Each says what changed ("Inside margin 19 mm →
  22 mm", "Style Classic → Modern"). A version can be previewed as pages, compared beside
  the current ones, or restored onto the text as it is now without changing a word. In
  Typeset, the History tab shows it, with the text history a click away; restoring a
  text version keeps the typesetting as it is. Typesetting no longer adds text-history
  checkpoints.
- **Covers:** a book's cover — a front, a back and a spine, or one picture across the
  whole wrap — in as many versions as wanted, one of them in use. The Cover, first in
  the Book navigator, shows the full wrap to scale in Typeset, with its trim, bleed,
  safe areas, spine folds and barcode box, and takes pictures dropped on it. Each is
  checked as KDP and IngramSpark would (300 dpi, the spine it was made for, no spine
  text under 80 pages, an e-book front's shape and size), and exported as one full-wrap
  PDF with ⅛″ bleed. The front is the EPUB's cover.
- **A folder read as one document:** in Write, a folder can read continuously — its
  documents one after another in tree order, less what the book hides, each under a
  slim divider — to scroll from the end of one chapter into the next; clicking into one
  opens it where it was clicked, and the arrow keys cross from one into the next.
- **Numbered documents in the file tree:** a folder can show each chapter's number
  beside its name, from 1 or from 0, leaving out prologues and hidden chapters. Both are
  in the folder's menu in the tree, and under Typeset › Book.

- **The e-book, as a reader shows it:** Typeset's Print | Digital switch (also View ›
  E-book Preview) shows the EPUB's own pages in a device-sized viewport — Kindle
  Paperwhite and Scribe, Kobo Clara, iPhone, Android, iPad and Apple Books on the Mac,
  or any size dragged to. Page through it as a reader would; try larger type, sepia and
  night themes, the reader's own font, looser spacing and wider margins; click a page to
  open it in Print or edit it in Write. The EPUB now carries the book's design — its
  face, indents, scene breaks, drop cap and chapter heads — and Typeset › E-book sets
  what it does differently from print: drop caps, chapter pictures, the book's font,
  plain scene breaks, ornaments kept visible at night. Missing alt text, images over
  Kindle's limits, an empty book and a cover of the wrong shape are pointed out, in the
  preview and in the preflight.
- **Fine typography:** every book's paragraphs are now composed as a whole — even
  spacing, no word alone on a last line — with punctuation hung into the margin, no more
  than two hyphens in a row and none in short words, all adjustable under Typeset › Body
  Text › Fine Typography. OpenType ligatures, old-style figures, kerning and swashes can
  be turned on or off. Font files can be added to a project (the ＋ beside the font menu):
  the book sets in them on any Mac and embeds them in its PDF and EPUB, and a font whose
  licence forbids embedding is pointed out.
- **Proofing the pages:** Proof (in the typeset toolbar, and Typeset › Proof) marks
  loose lines, widows, orphans, runts, stacked hyphens and a short last page on the
  chapter's pages and lists them, each with the fixes a typesetter would use: a touch of
  tracking, keeping lines together or with the next, running a page a line long or
  short. The same settings are there for any paragraph the caret is in, and in the
  toolbar palette. They print only, and are kept in the typeset history.
- **Spreads and the baseline grid:** Typeset can show the whole book as it opens, verso
  beside recto. Align to Baseline Grid sets headings, quotations, breaks and pictures to
  whole lines so lines stand level across a spread, and the grid can be drawn over the
  pages.
- **Named text styles:** a paragraph can be set as a Letter, a Text Message, an Email,
  Verse, a Block Quote, a Journal Entry, a Sign, Centered or Flush Left (Format › Text
  Style, or the toolbar), in Write or in Typeset. How each looks is the book's — font,
  size, italic, small capitals, alignment, indents, space around, a ruled box — set under
  Typeset › Text Styles, where a book can add styles of its own; it changes every such
  paragraph at once, on the pages, in the EPUB and HTML, and as Word paragraph styles.
  In Write a styled paragraph shows only a faint rule at its side.
- **Parts:** a book's part dividers can have a design of their own — where they start,
  alignment, cases, ornament and size — under Typeset › Parts.
- **Map version history:** maps compare and merge like canvases — place by place,
  route by route, with whole-map settings (style, scale, timeline, …) as their own
  differences — and their history rows say what changed ("+2 places · 3 moved ·
  Style"), in the native sidebar as well as the page. Filtering a map's history
  finds versions by the names written on the map.

## [0.1.0] - 2026-09-24

The first tagged version: the writing app, its shared Rust core, and a native Swift
shell beside the Tauri app.

### Added

- **Writing:** a TipTap editor with formatting, tables, images, highlights and text
  alignment; split view; focus mode; word counts.
- **Canvases:** infinite canvases as a document kind, stored in the open JSON Canvas
  format, with text, file, link, note, audio and group cards and labelled edges.
- **Maps:** a third document kind for places, routes, regions and characters' journeys
  on a story timeline, on a blank sheet, a traced picture, the Earth or a star system.
- **Notes:** notes anchored to the text, with images, voice memos and replies, dragged
  onto canvases; the Bubble editor for reworking a sentence.
- **Version history:** automatic and named versions, comparison, restore, and an
  archive for things put aside.
- **Workbench:** on-device synonyms, rhymes, definitions and parts of speech;
  offline dictation; Read Aloud with Kokoro speech.
- **References:** sources shared across a project, looked up from a DOI, ISBN, arXiv,
  PubMed or web address, cited in nine styles with a bibliography.
- **Print Layout:** the document as pages, printing, imposition for self-binding, and
  export to PDF, EPUB, Markdown and HTML, per document or as a compiled book.
- **Pinterest:** board embeds with cached previews, including private boards.
- **Apps:** the Tauri app for macOS, and a SwiftUI app for macOS (iPadOS and iOS in
  progress) that hosts the same page with native chrome.
- **Core:** `inkblot-core` (domain logic, persistence, search, version history and the
  bridge protocol) and `inkblot-models` (on-device models) in Rust, shared by both
  apps; types generated into TypeScript and Swift; a JS/Rust parity harness.

[Unreleased]: https://github.com/g3vin/inkblot/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/g3vin/inkblot/releases/tag/v0.1.0

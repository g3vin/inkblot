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

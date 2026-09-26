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

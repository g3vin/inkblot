# Changelog

Notable changes to Inkblot. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Timeline:** one chronology per project, shown by timeline documents three ways —
  along the story calendar (real or a world's own), evenly in order for a story with
  few or no dates, and as the manuscript, each passage joined to when it happens so
  flashbacks and flash-forwards show. Lanes, eras, tags and filters; events that are
  moments or windows, with notes on the whole or on one moment. Drag to move, resize,
  reorder, change lane, date or undate — and everything follows: passages attached to
  events in the text (with handles to drag where they start and end), the time lens
  that highlights every passage in a window of time, map journeys and the events shown
  at their places, and event cards on canvases. One undo takes back an edit and the
  map leg it moved.

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

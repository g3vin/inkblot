# Changelog

Notable changes to Inkblot. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- **Motion:** everything moves on springs, as on Apple's platforms. Menus, popovers,
  dialogs, sidebars and hovers settle like objects coming to rest, and a swipe, a drag
  or a throw keeps its speed into the motion that follows. A swipe between sidebar
  panels lands from the speed the fingers left it at. Pulling a sidebar past its
  widest or narrowest stretches like a rubber band and springs back. The canvas and
  the map coast after a thrown pan. A dragged note's children swing the same at any
  refresh rate. Clicking or swiping mid-way redirects any of it. Something dropped in
  the toolbar, the inspector, the Book or the file tree springs into its new place
  from under your hand, and the others make way. The split divider stretches past its
  limits and springs back, as does focus mode's scrolling past the first or last
  sentence, and double-clicking the divider glides it to the middle.

- **Toolbar:** its items are pages you swipe through with two fingers. The page fades
  as you swipe; halfway, it clicks onto the next page with a tick, and letting go
  turns the page with another. A quick flick turns it at once. Dots at the toolbar's end show the pages and turn them with a click, as do
  ⌃← and ⌃→. In Customize toolbar each page is arranged on its own, an item dropped on a
  dot moves to that page, and pages can be added and removed (a More marker placed
  before becomes a page break). The document toolbar's default set is now Page view,
  Focus, Undo and Redo, Bold to Strikethrough, the paragraph style, font and size, the
  colours, alignment and lists, with inserting and the voice on a second page.
- **Toolbar menus:** everything a toolbar button opens, it opens in place in the
  toolbar, without a heading, moving other items aside only when there isn't room. The
  paragraph style, font and size are rows of their choices (fonts in their own face),
  alignment is three icons, the colours are the inks plus the system picker, and read
  aloud is one compact row.

- **Archive:** its button is in the inspector's bottom-right corner on every panel,
  where the + is on the left, and opens the archive over the panel that's showing.
- **Focus mode:** its controls are now a bar at the top of the document, shaped like
  the toolbar, that slides in when you point at the top and hides again on its own.
  Before and After are steppers, and text sizes are under one Text size button.
  Focus mode puts both sidebars away and keeps the window colour showing round the
  page; the sidebars still slide in from the edges, the buttons in the bar's corners
  keep them open, and leaving focus mode brings back the ones that were open. Focus
  mode is on the document toolbar by default, beside Page view.
  Entering and leaving focus mode zooms the sentence between its place on the page
  and the middle of the screen. Scrolling moves the text under your fingers and settles
  on the sentence nearest the middle. Done is a round check button, in focus mode and
  in Bubble.
- **Bubble:** it opens in place of the document it came from instead of over the
  whole window. The bubbles sit straight on the window colour, the toolbar becomes
  the Sentences · Clauses · Words bar, and the sidebars stay. In a split it stays on
  its own side. "Bubble the selection" and "Bubble this paragraph" are in the command
  palette. If the pane is switched to another document while a bubble is open, the
  bubble is put in its document's archive rather than written anywhere.
  Bubbles are set aside on a shelf along the top instead of against any edge, so the
  sentence uses more of the width in a narrow split.
- **License:** Inkblot is open source under the Apache License 2.0. The name and logo
  stay trademarks; see TRADEMARKS.md. Contributions are signed off under the
  Developer Certificate of Origin.
- **Read Aloud voices:** Read Aloud speaks with Kyutai's Pocket TTS, which sounds
  more natural than Kokoro, and offers six voices instead of twenty-eight. The voices
  download once, about 440 MB, from Download voices in the read-aloud row, and then
  work offline. The old Kokoro model is removed from disk. Read Aloud no longer ships
  any GPL code.
- **Opening a project:** the file tree, the document, the toolbar and the tabs arrive
  together in one fade instead of popping in one by one, and nothing shifts as they
  land. A quick open shows no loading state at all; a slow one (a project on a synced
  drive) shows placeholders shaped like what is coming. Panels no longer say "Nothing
  archived" or "No project open" while they are still loading. Pointing at a project
  on the start screen starts reading it, reopening one shows its sidebar at once, and
  switching back to a document already open in the session is instant. The project
  tree is read in parallel rather than one folder at a time.
- **Loading, everywhere else:** the start screen fades into the project instead of
  cutting to it, and the file tree's rows arrive one after another. Canvases, maps and
  timelines show their empty surface at once and, when slow, a placeholder shaped like
  the document. Comparing versions never shows a wrong diff or "identical" while it is
  still reading. The toolbar fades between a document's, a canvas's and a map's
  instead of being rebuilt. The project list shows as last seen while it is re-read,
  and the word count and lock badge arrive with their document.

### Added

- **Selection wheel:** select some text and hold Option, and a ring of tools opens under
  the pointer. Move toward one and let go to use it: Highlight, Bold, Hide,
  Strikethrough, Bubble or Italic to start with. Every tool keeps its place, so after a
  while your hand knows the way. Tap Option instead and the wheel stays open for a click
  or the arrow keys. Rest on Highlight to pick its colour. Choose the tools, their places
  and the key in Settings ▸ Selection wheel, or open the wheel from ⌘K. On an iPad
  without a keyboard, press and hold the selection, then drag to a tool and lift.
- **Hide:** fold a passage out of sight without deleting it. It shrinks to a small •••
  in the line; click it to open the passage in place, and click again to fold it. Hidden
  text stays in the document and its history. It is left out of print, every export,
  canvas cards and previews, and Read Aloud skips it while it's folded.
  Hide from the selection wheel, the right-click menu or ⌘K.

- **File ▸ All projects** (⇧⌘O, or "Go to all projects" in the command palette)
  closes the open project and goes back to the project screen.
- **Focus mode position:** a # button in focus mode's bar (and ⌘K) shows which
  paragraph and sentence you're on in the top-left corner, such as "¶ 12 · Sentence 3
  of 7".
- **Midnight theme:** a theme for writing in the dark, in Settings › Appearance, the
  View menu and ⌘K. The page and the window are true black, so the black pixels of an
  OLED or mini-LED screen switch off, and the words are warm Ember instead of white.
  Panels and menus are set apart by fine Ember lines rather than shadows, and note and
  accent colours are dimmed. System still picks Light or Dark; Midnight is only chosen
  by hand.

### Fixed

- **Focus mode:** it opens with the sentence centred, not low on the screen, and it
  stays centred while you type, step between sentences or dock a sidebar. The caret
  shows where a typed space goes, stays solid while you type and blinks when you
  stop. ↓ from the last sentence gives an empty line for the next one, and Home and End
  go to the ends of the sentence. The text is set in the document's typeface. Arrow
  keys and Escape work in the command palette and menus opened over focus mode.
  Sidebars come back after you leave, even if the app quit while you were in it.
  Selected text is highlighted.
- **Split view preview:** holding a document over the page no longer shows a loading
  placeholder on top of the previewed document until it is dropped.

## [0.3.0] - 2026-10-23

### Changed

- **Dialogs:** every window that asks you something (Settings, New project, Rename,
  Help, …) is the same kind of dialog. A heading says where it came from, there is one
  way out, and the buttons sit at the trailing edge; a small decision's two buttons
  share the width. Focus starts on the first control and stays inside until it closes,
  and a dialog leaves the way it came.
- **Pop-ups:** Read Aloud, the footnote editor, the e-book reader, Typeset's page
  pickers and the citation editor open in the same kind of pop-up, with a heading, and
  Tab stays inside it. A menu a button opens is drawn in the page; right-click menus
  stay the system's own.
- **The toolbar:** a button's pop-up opens in the toolbar itself: a choice beside its
  button, a form across the whole toolbar. A button's menu opens as a row of its items,
  and » turns the toolbar to its second page, with ‹ to come back.
- **Timeline:** its tools are in the card's toolbar, where they can be customised like
  a document's.
- **Find (⌘F)** opens in the card's toolbar, with Replace beside it.

### Fixed

- **Synonyms for a verb:** looking one up ("grumbled") no longer fails, and its
  opposites come in the word's own form ("rejoiced", "praising").

## [0.2.0] - 2026-10-23

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
- **Footnotes and endnotes:** Insert › Footnote (⌥⌘F) puts a note at the caret; click
  its mark to write it. Under Typeset › Footnotes & Endnotes a book sets its notes at the
  foot of the page — pagination keeps room for them, with a short rule above — after
  each chapter, or all together at the end of the book (in its own Notes entry, where it
  has one), numbered afresh in each chapter or on through the book, as numbers or as
  * † ‡. Word exports get real footnotes, EPUBs pop-up notes linked both ways, HTML a
  linked list, Markdown footnote syntax.
- **Full-page and bleed pictures:** a picture can have a page to itself (Full Page),
  fitted to the text block, or fill its page past the trimmed edges (Bleed). A book with
  a bleed picture prints its PDF with the ⅛″ of bleed KDP and IngramSpark ask for — at
  the top, the bottom and the outside of every page — and the preflight says to choose
  a bleed interior when uploading. Pictures wrapped by the text print as they are shown.
- **Editions:** a book can have editions — Paperback, Hardcover, Large Print (16 pt,
  loosely leaded, ragged, unhyphenated) and eBook — each with its own trim, margins,
  type and cover, sharing the text, design and styles. Choose the edition being typeset
  in the toolbar or under Typeset › Editions: changes to the page and type are that
  edition's, and an e-book edition shows as the e-book. Export All Editions writes every
  print edition's interior and cover PDFs and every e-book's EPUB into a folder. A
  typeset version can be duplicated as an edition from the typeset history.
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

### Changed

- **Accent and window colour:** Sage, Inkblot's green, is the default for both, in
  place of Ink Blue. Ink Blue is still in Settings → Appearance; anyone who has opened
  Inkblot before keeps the colour they had.

### Fixed

- **Renaming a project** onto a name another project already holds is refused,
  wherever that project is kept. Before, a project in a custom folder could be renamed
  onto an AppData project's name, and the AppData one could no longer be opened.
- **A document with a damaged note** opens with that note empty, rather than failing
  to load.

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

[Unreleased]: https://github.com/g3vin/inkblot/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/g3vin/inkblot/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/g3vin/inkblot/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/g3vin/inkblot/releases/tag/v0.1.0

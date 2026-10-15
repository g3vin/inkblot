/**
 * help.ts — what Inkblot's controls do, said once, out of the way.
 *
 * Panels keep their words short: a label, at most one line of hint. Anything that
 * needs explaining lives here as a help topic, and a right-click on the control
 * offers "Help: <topic>…", which opens the Help sheet on it (components/help).
 *
 * A control opts in with `data-help="<topic id>"` (FormRow, Section and the inspector
 * panels take a `help` prop that sets it). Topic ids are dotted, like command ids:
 * `<area>.<thing>`. tests/unit/help.mjs checks that every id used in src/ exists here.
 */

export type HelpTopic = {
  id: string
  /** The Help sheet groups topics under these, in the order they first appear. */
  section: string
  /** Sentence case, a noun phrase: what the thing is called on screen. */
  title: string
  /** Paragraphs, plain and warm (DESIGN.md §11). */
  body: string[]
  /** Other topics worth reading next. */
  related?: string[]
}

export const HELP_TOPICS: HelpTopic[] = [
  // ---------- Getting around ----------
  {
    id: 'app.help',
    section: 'Getting around',
    title: 'Using help',
    body: [
      'Right-click almost anything in a panel and choose Help to read about it here. You can also open Help from the command palette (⌘K) and browse every topic.',
      'Panels keep their own words short. When something needs more explaining, it is here.',
    ],
    related: ['app.palette'],
  },
  {
    id: 'app.palette',
    section: 'Getting around',
    title: 'The command palette',
    body: [
      'Press ⌘K to search every action in Inkblot by name, or by the words you would use for it. It is the quickest way to a tool you can’t see on screen.',
      'Shortcuts are shown beside each action. You can change them in Settings → Shortcuts.',
    ],
  },
  {
    id: 'app.sidebars',
    section: 'Getting around',
    title: 'Sidebars',
    body: [
      'The file tree sits on the left and the inspector on the right. The buttons in the document’s top corners keep each one open or put it away.',
      'Put away, a sidebar comes back while your pointer rests at that edge of the window, and goes again when you move off it.',
    ],
  },

  // ---------- Settings ----------
  {
    id: 'settings.accent',
    section: 'Settings',
    title: 'Accent colour',
    body: [
      'The accent tints selections, focus rings and primary buttons. Ink Blue is Inkblot’s own; the others are the same fountain-pen inks used for notes and cards.',
    ],
    related: ['settings.window-colour'],
  },
  {
    id: 'settings.window-colour',
    section: 'Settings',
    title: 'Window colour',
    body: [
      'The window colour tints the frame around your document, behind the sidebars. It is separate from the accent, so you can pair a quiet frame with a bright accent or the other way round.',
    ],
    related: ['settings.accent'],
  },
  {
    id: 'settings.word-count',
    section: 'Settings',
    title: 'Word count',
    body: ['When it is on, the count floats at the foot of each document. Select some text to count just that.'],
  },

  // ---------- Stats ----------
  {
    id: 'stats.panel',
    section: 'Stats',
    title: 'Writing stats',
    body: [
      'Stats shows how the writing is going. Choose what it counts in the panel’s header: this document, this project, or everything you have written in Inkblot on this computer.',
      'Today is the live picture, History is the long view, and Insights looks for patterns in the last 90 days.',
    ],
    related: ['stats.goal', 'stats.streak', 'stats.session'],
  },
  {
    id: 'stats.session',
    section: 'Stats',
    title: 'Sessions',
    body: [
      'A session starts when you begin typing and ends after a quiet spell (set how long in Settings → Writing).',
      'Time typing counts only the moments you are actually writing: edits a few seconds apart. Pace is words written per minute of that.',
    ],
  },
  {
    id: 'stats.goal',
    section: 'Stats',
    title: 'Daily goals',
    body: [
      'Set a daily goal for words or time in Settings → Goals. A goal can count one project or all your writing; Today’s goal says which as it counts.',
      'Rest days ask nothing of you and don’t break a streak.',
    ],
    related: ['stats.streak'],
  },
  {
    id: 'stats.streak',
    section: 'Stats',
    title: 'Streak',
    body: [
      'Your streak is the run of days in a row you met your goal (or wrote at all, with no goal set). Freezes, if you allow them, cover a missed day.',
      'The calendar shades each day by the words written, or by whether the goal was met. Choose which, and how far back it reaches, from ⋯ beside Streak.',
    ],
    related: ['stats.goal'],
  },
  {
    id: 'stats.activity',
    section: 'Stats',
    title: 'Activity',
    body: ['A day-by-day chart of words written, time typing or time open, over the last week, month or three months.'],
  },
  {
    id: 'stats.totals',
    section: 'Stats',
    title: 'All-time totals',
    body: ['Everything counted since the first session, for what the panel is counting. Timer runs are counted for the project the document is in.'],
  },
  {
    id: 'stats.week',
    section: 'Stats',
    title: 'This week',
    body: ['Words written over the last seven days, against the seven days before.'],
  },
  {
    id: 'stats.rhythm',
    section: 'Stats',
    title: 'When you write',
    body: ['Time typing by hour and weekday over the last 90 days, with the hour and day you write most.'],
  },
  {
    id: 'stats.habits',
    section: 'Stats',
    title: 'How you write',
    body: [
      'Flow sessions are sessions with a long unbroken stretch of typing (set the length in Settings → Writing).',
      'Rewriting is how many words you take out for every hundred you put in. Drafting runs low; revising runs high.',
    ],
  },

  // ---------- Typeset ----------
  {
    id: 'typeset.panel',
    section: 'Typeset',
    title: 'Typesetting',
    body: [
      'Typeset turns the manuscript into a book’s pages, in the order a book designer works: the book, its editions and style, the page, the type, the proof, how chapters open, and the running heads.',
      'Choose what you are working on in the panel’s header: this document on its own, or the book it belongs to. Proof the pages in the editor before printing: the Typeset pages are what prints.',
    ],
    related: ['typeset.style', 'page.size', 'output.panel'],
  },
  {
    id: 'typeset.thisPage',
    section: 'Typeset',
    title: 'This page',
    body: [
      'Settings for the page selected in the Book navigator.',
      'A chapter can have a subtitle, an epigraph and a picture. A prologue, an epilogue or an interlude is headed by what it is and not numbered; the chapters after it count on.',
      'A page of the book’s own (a dedication, an acknowledgement) is written in the page itself, in Typeset or in Write. Generated pages, like the title page and contents, are laid out from the book. A part is a divider before the chapters in it.',
    ],
  },
  {
    id: 'book.info',
    section: 'Typeset',
    title: 'Book details',
    body: [
      'The title and author go on the running heads, the EPUB and the PDF. The language is what an e-reader reads the book in, and the cover shown here is the EPUB’s.',
      'Read as one document joins the chapters into one long scroll in Write. Number documents in the file tree shows each chapter’s number beside its name.',
    ],
  },
  {
    id: 'book.setup',
    section: 'Typeset',
    title: 'Book page setup',
    body: [
      'Each chapter shows its own page setup on screen. Printed as a book, every chapter takes the first chapter’s, unless the book has a setup of its own. Give it one to print every chapter alike.',
    ],
    related: ['page.size'],
  },
  {
    id: 'typeset.editions',
    section: 'Typeset',
    title: 'Editions',
    body: [
      'Add a hardcover, a large-print or an e-book edition. Each keeps its own trim, margins, type and cover; the text and the design stay one.',
      'Changes to the page and the type apply to the edition being typeset. Export all editions writes each print edition’s interior and cover PDFs, and each e-book’s EPUB.',
    ],
  },
  {
    id: 'typeset.digital',
    section: 'Typeset',
    title: 'E-book',
    body: ['A reader chooses the page, the type size and often the font. These settings are what the book still decides; the EPUB and the preview both follow them.'],
  },
  {
    id: 'typeset.style',
    section: 'Typeset',
    title: 'Book style',
    body: ['A style sets the book’s type, how its chapters open and its running heads in one go. Everything below it fine-tunes the style.'],
  },
  {
    id: 'page.format',
    section: 'Typeset',
    title: 'Format',
    body: [
      'The kind of page this document is set as: a book, a manuscript, a screenplay and so on. Each comes with its own page size, type and margins.',
      'When a book prints every chapter in a setup of its own, this one shows on screen and when the document is printed alone.',
    ],
  },
  {
    id: 'page.size',
    section: 'Typeset',
    title: 'Page size and margins',
    body: ['The trim size and margins of the printed page. The gutter is added to the inside margin, where the binding takes up paper.'],
  },
  {
    id: 'page.typography',
    section: 'Typeset',
    title: 'Body text',
    body: [
      'By default, pages print in the editor’s font. Set type for print to choose a font, spacing and scene breaks for the page alone.',
      'A horizontal rule prints as the scene break. How chapters open (the drop cap, how far down the page) is under Chapter openings.',
    ],
    related: ['book.headings'],
  },
  {
    id: 'page.textFlow',
    section: 'Typeset',
    title: 'Text flow',
    body: ['Columns, and how lines and paragraphs break across pages. You write in one running column; the columns sit side by side when printed or exported as PDF.'],
  },
  {
    id: 'typeset.proof',
    section: 'Typeset',
    title: 'Proof',
    body: [
      'The proof finds widows, orphans and loose lines on the typeset pages. It reads the chapter’s own pages, so show them one at a time in Print.',
      'Fixes change how lines fall, never the words, and apply to print only. Each one is kept in the typeset history.',
    ],
  },
  {
    id: 'typeset.textStyles',
    section: 'Typeset',
    title: 'Text styles',
    body: ['Give a paragraph a style from Format → Text style. In Write it shows as a faint rule beside the text; here it is set as the book sets it.'],
  },
  {
    id: 'book.headings',
    section: 'Typeset',
    title: 'Chapter openings',
    body: [
      'Every chapter opens this way, in the Typeset pages, in print and in every export. A chapter’s own subtitle, picture and epigraph are under This page.',
      'For a drop cap and to set how far down the page each chapter opens, set type for print under Body text first.',
    ],
    related: ['page.typography', 'typeset.thisPage'],
  },
  {
    id: 'typeset.parts',
    section: 'Typeset',
    title: 'Parts',
    body: ['Add a part from the Book navigator’s + menu. Parts are numbered “Part One”, “Part Two” in the chapters’ style, and listed in the contents.'],
  },
  {
    id: 'typeset.notes',
    section: 'Typeset',
    title: 'Footnotes and endnotes',
    body: ['Put a note in with Insert → Footnote in Write, and click its mark to write it. An e-book sets notes after each chapter, linked both ways; Word gets real footnotes.'],
  },
  {
    id: 'page.headerFooter',
    section: 'Typeset',
    title: 'Header and footer',
    body: ['Insert page numbers, the title, the chapter, the author, the word count or the date with the + menu. The chapter is the most recent Heading 1.'],
  },
  {
    id: 'page.titlePage',
    section: 'Typeset',
    title: 'Title page',
    body: ['The title page prints and exports ahead of the text, unnumbered. Contact details come from your author details (⋯ → Author details).'],
  },

  // ---------- Print and export ----------
  {
    id: 'output.panel',
    section: 'Print and export',
    title: 'Printing and exporting',
    body: [
      'Print sends the typeset pages to a printer or a PDF. Export writes the document or the book as PDF, EPUB, Word, HTML, Markdown, plain text or, for scripts, Fountain and Final Draft.',
      'Print options (in ⋯) choose the pages, the current chapter or the selection, and can add a watermark, with a copy for each reader named.',
    ],
    related: ['publish.publishing', 'output.cover'],
  },
  {
    id: 'publish.publishing',
    section: 'Print and export',
    title: 'Publishing',
    body: [
      'Checks the book against a print-on-demand service: the paper, the page count and the spine width it will print at. It counts the document on its own, or the whole book, as chosen in the panel’s header.',
      'Count the pages again after changing the text or the page setup. Under 80 pages, the spine is too thin for text; check the service’s cover calculator before the cover goes out.',
    ],
  },
  {
    id: 'output.cover',
    section: 'Print and export',
    title: 'Cover',
    body: [
      'Drop in a front, or one picture across the whole wrap. Export cover PDF writes back, spine and front as one PDF with ⅛″ bleed, as KDP and IngramSpark take it.',
      'The front is also the e-book’s cover.',
    ],
  },
  {
    id: 'publish.binding',
    section: 'Print and export',
    title: 'Hand binding',
    body: [
      'Lays the book’s pages out on sheets to fold, nest and sew or staple, for making a book at home.',
      'Print double-sided, flipping on the short edge, then fold and nest the sheets in order. Paper thickness moves the inner pages toward the spine to allow for creep.',
    ],
  },
  {
    id: 'publish.script',
    section: 'Print and export',
    title: 'Script production',
    body: ['Reports for a script: its scenes and cast, ready for a breakdown or a read-through.'],
  },

  // ---------- Timeline ----------
  {
    id: 'timeline.panel',
    section: 'Timeline',
    title: 'The timeline beside a document',
    body: [
      'The Timeline panel shows what the open document has to do with your story’s chronology: every passage in it attached to an event, in reading order, with when it happens.',
      'Click a passage to go to it, or the event’s name to see it in the timeline.',
    ],
    related: ['timeline.attach', 'timeline.lens'],
  },
  {
    id: 'timeline.passages',
    section: 'Timeline',
    title: 'Attached passages',
    body: ['Each passage in this document that is attached to an event. A flashback or flash-forward is marked where the telling jumps back or ahead of the story’s order. × detaches a passage; the text stays as it is.'],
  },
  {
    id: 'timeline.attach',
    section: 'Timeline',
    title: 'Attaching a passage',
    body: ['Select some text in the document, choose an event (or a new one) and press Attach. The passage is then tied to that moment in the story, and moves with the text as you edit.'],
  },
  {
    id: 'timeline.lens',
    section: 'Timeline',
    title: 'Time lens',
    body: ['The time lens highlights the passages that fall in a window of story time, so you can see at a glance what in the manuscript happens when.'],
  },
  {
    id: 'timeline.handles',
    section: 'Timeline',
    title: 'Passage handles',
    body: ['Shows handles at each attached passage’s ends, so you can drag where it starts and finishes.'],
  },

  // ---------- References ----------
  {
    id: 'references.panel',
    section: 'References',
    title: 'References',
    body: [
      'Keep the sources you cite and set them in a citation style. Show the sources in this document, or every source in the project, from the panel’s header.',
      'Sources you add here belong to the document you are in. Cite one at the caret with its quote button, or by double-clicking it.',
    ],
    related: ['references.lookup', 'references.bibliography'],
  },
  {
    id: 'references.lookup',
    section: 'References',
    title: 'Adding a source',
    body: [
      'Paste a link, a DOI or an ISBN and press Return, and Inkblot looks the source up and fills in its details. Type a title instead to find it, or to add it as it is.',
      'To enter every detail yourself, choose Enter a source by hand from ⋯.',
    ],
  },
  {
    id: 'references.bibliography',
    section: 'References',
    title: 'Bibliography',
    body: [
      'A live bibliography sits at the end of the document and updates as you cite. List the sources you have cited, or every source in the document.',
      'Annotated shows each source’s annotation under its entry. A bibliography in the document always prints with it; otherwise, choose whether printouts and exports add one.',
    ],
  },

  // ---------- Inspector panels ----------
  {
    id: 'clipboard.panel',
    section: 'Inspector panels',
    title: 'Clipboard',
    body: [
      'Everything you copy is kept here while you work, newest first. Drag a selection from the document into the panel to keep it too.',
      'Drag an item back into the document to put it in, wherever you drop it.',
    ],
  },
  {
    id: 'workbench.panel',
    section: 'Inspector panels',
    title: 'Workbench',
    body: [
      'Right-click a word in your writing and choose a look-up (synonyms, rhymes, a definition, the part of speech) to pin it here as a tile.',
      'Click a suggestion in a tile to swap it in for the word. Clear the workbench from ⋯.',
    ],
  },
  {
    id: 'notes.panel',
    section: 'Inspector panels',
    title: 'Notes',
    body: [
      'Notes on the open document. Select some text and press ⌥⌘N to leave a note on it, or add a note that stands on its own.',
      'Click a note to go to its text. A note can carry replies, a colour and a pin to keep it at the top.',
    ],
  },
  {
    id: 'history.panel',
    section: 'Inspector panels',
    title: 'Version history',
    body: [
      'Inkblot keeps checkpoints of the document as you write, grouped by editing session. Save a version now with + to keep the current state; name a version from its row to find it again.',
      'The archive holds the things you have put away out of this document, ready to restore.',
    ],
  },
  // ---------- Maps ----------
  {
    id: 'map.export',
    section: 'Maps',
    title: 'Exporting a map',
    body: [
      'Export map… (in the zoom menu, or ⌥⌘E) saves the map as a picture: a PNG for the screen, an SVG or a PDF that stays sharp at any size, or straight to the printer. Copy image puts it on the clipboard, ready to paste into a chapter.',
      'Choose what’s on screen to export the part you are looking at, or the whole map for all of it. Sharpness multiplies a PNG’s pixels: Retina for screens, Print for paper.',
      'A globe, a planet, a star system in 3D, a galaxy or a model is exported as you are looking at it, with its places, key and scale bar on top. Turn and frame it first.',
      'To show a map in a canvas, drag it there instead. It stays up to date as the map changes.',
    ],
  },
  {
    id: 'map.earth-view',
    section: 'Maps',
    title: 'The globe and flat maps',
    body: [
      'An Earth map can be a globe or a flat map. The globe turns as you drag it and zooms from the whole planet down to a street. Hold ⌃ and drag, or drag with two fingers, to tilt and turn the view.',
      'A flat map shows the whole world at once in a projection: Equal Earth and Natural Earth keep the sizes of countries fair, Equirectangular is the simple grid of latitude and longitude, and Mercator keeps shapes but swells the poles.',
      'Your places, routes, regions and journeys are the same in every view. Distances are always measured along the curve of the Earth.',
    ],
    related: ['map.online'],
  },
  {
    id: 'map.online',
    section: 'Maps',
    title: 'Online maps',
    body: [
      'Everything you put on a map is kept in your project and works offline, along with the Earth’s coastlines and borders. Satellite pictures, street detail, raised terrain and searching for real places come from the internet, and only once you turn on online maps.',
      'The services that send them see which part of the world you are looking at, and what you search for. Nothing from your project is sent. Turn online maps on or off in Settings ▸ Maps.',
      'Free satellite pictures are Sentinel-2 cloudless (2016) by EOX, sharp to about a town. For closer pictures, add a key for MapTiler, Mapbox or Google Maps in Settings ▸ Maps. Streets and place names are OpenStreetMap, by way of OpenFreeMap; search is Photon, by Komoot.',
    ],
    related: ['map.satellite-source', 'map.earth-view'],
  },
  {
    id: 'map.satellite-source',
    section: 'Maps',
    title: 'Where satellite pictures come from',
    body: [
      'Sentinel-2 is free and needs no account. MapTiler, Mapbox and Google Maps are sharper close up and need a key from an account with them; use of their pictures is under their terms, and may be charged for beyond a free allowance.',
      'Another source takes any tile address with {z}, {x} and {y} in it, and {key} where a key goes.',
      'Keys are kept on this computer, not in your projects.',
    ],
    related: ['map.online'],
  },
  {
    id: 'map.systems',
    section: 'Maps',
    title: 'Star systems',
    body: [
      'A star system moves with your story: scrub the timeline and every planet and moon goes round. Drag to turn the view, scroll to zoom, and switch between 3D and flat in the view menu. Distances squeezed keeps the inner planets in reach; to scale shows the true gulfs.',
      'Templates start you off: our Solar System, binaries, triples, a star feeding a black hole, and three-body systems. A stable one keeps its dance for as long as your story; a chaotic one may fling a star out, and the Motion section says when.',
      'Select a planet or star and choose Make a map of this world to open it as a globe of its own. The trail at the top takes you back up.',
    ],
    related: ['map.worlds', 'map.galaxies'],
  },
  {
    id: 'map.worlds',
    section: 'Maps',
    title: 'Planets and stars',
    body: [
      'A planet or star map is a whole world to turn. A planet’s surface is drawn from a seed: Roll again for another, or set the sea, the ruggedness and the palette. To use your own picture, choose one drawn as a flat map of the whole world, twice as wide as it is tall.',
      'Draw regions with a terrain and turn on Land from regions to paint your continents onto the globe. Day and night follow the story day, the planet’s tilt and the length of its year.',
    ],
    related: ['map.systems'],
  },
  {
    id: 'map.galaxies',
    section: 'Maps',
    title: 'Galaxies',
    body: [
      'A galaxy is drawn from its type and a seed, so no two are alike: spirals and barred spirals, ellipticals, lenticulars, rings, irregulars, dwarfs and torn ones. Roll again draws another of the same type; a shape you set yourself stays put.',
      'Place star systems with the place tool, then choose Make a star system here to open one. A group of galaxies holds galaxies the same way, and Fill with galaxies lays them out along filaments and clusters. Distances are in light-years, or millions of them.',
    ],
    related: ['map.systems'],
  },
  {
    id: 'map.models',
    section: 'Maps',
    title: '3D models',
    body: [
      'A 3D model map is a station, a ship or a building to walk around. Use a .glb file, or a .gltf with everything inside it; Draco-compressed models aren’t supported yet. If it stands on its side, set Up is to Z.',
      'Place pins on its surface with the place tool. Look around (in the view menu) puts you inside: drag to look, W A S D to move, Q and E to go down and up.',
    ],
  },
  {
    id: 'story.calendar',
    section: 'Settings',
    title: 'The story calendar',
    body: [
      'Every map, timeline and journey in a project tells time on one calendar. Story days count from Day 1. Real dates start from the day your story begins. Your world’s calendar has its own months, weekdays, eras and leap years.',
      'Changing the calendar changes how dates are written, never when things happen: an event on the 40th day of the story stays on the 40th day.',
    ],
    related: ['map.export'],
  },
]

const BY_ID = new Map(HELP_TOPICS.map((topic) => [topic.id, topic]))

export const helpTopic = (id: string | null | undefined): HelpTopic | undefined => (id ? BY_ID.get(id) : undefined)

/** Asks the Help sheet to open, on a topic if one is given. */
export const OPEN_HELP_EVENT = 'inkblot:open-help'

export function openHelp(topic?: string) {
  window.dispatchEvent(new CustomEvent(OPEN_HELP_EVENT, { detail: { topic } }))
}

/** The help topic for whatever is under a right-click, if anything there has one. */
export function helpTopicAt(target: EventTarget | null): HelpTopic | undefined {
  if (!(target instanceof Element)) return undefined
  return helpTopic(target.closest('[data-help]')?.getAttribute('data-help'))
}

/** The menu item a right-click menu adds for it: "Help: Window colour…". */
export function helpMenuItem(target: EventTarget | null) {
  const topic = helpTopicAt(target)
  return topic ? { text: `Help: ${topic.title}…`, action: () => openHelp(topic.id) } : null
}

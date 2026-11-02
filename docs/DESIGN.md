# Inkblot Design Language — "Quiet Studio"

This is the reference for how Inkblot looks, feels and speaks. Every screen, feature and
fix that a writer can see follows it: current features as they are migrated, and every
new feature from its first commit.

- **Tokens** live in [`src/styles/tokens.css`](../src/styles/tokens.css).
- **Components** live in [`src/ui/`](../src/ui/).
- **The ink palette** lives in [`src/lib/palette.ts`](../src/lib/palette.ts).
- **Everything together:** run `npm run dev` and open `http://localhost:5173/?design`
  to see every token and component in both themes (dev builds only).

---

## The rules, in brief

For anyone short on time, human or agent. The rest of this document explains each one.

1. **Build from `src/ui/`.** Use `Button`, `IconButton`, `Segmented`, `Menu`, `Popover`,
   `Dialog`, `Section` + `FormRow`/`Toggle`/`Stepper`/`SelectMenu`, `Panel`,
   `Card`, `EmptyState`, `InkWheel`, `InkPicker` and the others. Don't restyle a bare `<button>` or
   write a new modal.
2. **Never hard-code a design value.** Colours, fonts, radii, shadows, durations and
   spacing come from tokens (`var(--…)`). `npm run lint:design` fails on a new raw
   colour, font or radius.
3. **Colours come in two kinds.** Chrome uses semantic tokens (`--text-muted`,
   `--surface-float`, `--accent-color`). Anything a writer colours (notes, cards, tags,
   layers) uses an ink from the palette, stored by id (`'teal'`) and drawn with
   `inkColor()`.
4. **The document is the room.** The writing fills the window. Tools float over it,
   can be hidden, and sit on a fade scrim so text dissolves under them.
5. **Three typefaces, three jobs.** Inter for chrome, Literata for the writer's words,
   Courier Prime only for small typewritten accents.
6. **Phosphor icons.** Light weight at rest, Fill when active, 16px or 20px, named by
   meaning in `src/ui/icons.js`.
7. **Simple surface, deep reach.** Show only the essentials. Put everything else in a
   "More" menu, an inspector panel, and always the ⌘K command palette. Register every
   new action with `useCommands`.
8. **Plain, warm words.** Sentence case, verb first, no jargon outside advanced tools.
9. **The logo is black on white** (`Mark`, `Wordmark`, `AppIcon` in `src/ui`), never
   recoloured or redrawn.
10. **Glass only on iOS/iPadOS, and only on floating chrome over the page** (the
   `.floating-capsule` surface: `FloatingToolbar`, `FloatingActionButton`,
   `FloatingCapsule`).
11. **Both themes, AA contrast, keyboard reachable, reduced motion honoured.** Every
    time.
12. **All motion is physical.** Things move on springs, never on timed curves. A
    gesture hands its speed to the motion it lets go, and anything moving can be
    grabbed or redirected mid-way. Use the `--spring-*` tokens in CSS, and
    `src/ui/physics.js` / `useSpring.js` in script (§7).

---

## 1. Principles

**Quiet studio.** Inkblot is a writing studio of paper and ink. The chrome is calm and
stays out of the way; the writing is the hero. The brand appears in small, crafted
details: a typewritten label, an ink-blue dot, a well-set page. It is never loud.

**As easy as a notes app, as deep as a publishing tool.** Someone who has only used
Notes, Google Docs or Word should be able to start writing without reading anything.
An editor or typesetter should find every professional tool they need, and reach it in
fewer steps than their current app. We get both through progressive disclosure (§10),
not through modes. There is no "beginner" or "pro" switch.

**The document is the room.** The page is the whole window, not a sheet inside a frame.
Tools float above it and step aside when they aren't wanted (§6).

**Physical, not scripted.** Things move as if they had mass: they set off at the
speed they were given, carry on when let go, and settle like an object coming to
rest (§7). Nothing plays a timed animation at the writer.

**One decision, everywhere.** A choice is made once and reused. There is one button,
one menu, one card recipe, one palette, one way to pick a colour and one empty-state
voice. If two parts of the app do the same thing differently, one of them is wrong.

---

## 2. Brand

**Name.** Always lowercase "inkblot" in the wordmark. In running text write "Inkblot",
capitalised like any other name.

**Personality.** Calm, literate, precise and warm, like a well-kept studio. It is not
whimsical, nostalgic or themed. We never use paper textures, typewriter sound effects
or coffee stains.

**The mark.** The monogram "ib" in Literata ExtraBold (the editor's face), set tight,
with the *i*'s dot replaced by an ink splash: a round blot with a few droplets flung up
and to the right. The splash sits just above the stem, nudged a little left so it
clears the *b*'s ascender. Neither part is drawn by hand. The letters are the font's
outlines, and the splash comes from a simplified model of an ink drop hitting paper
([`docs/brand/generator/`](brand/generator/)): impact angle, rim fingering and
satellite droplets. Regenerate it there and never redraw it by hand.

**The wordmark.** "inkblot" in Courier Prime Bold, its *i* dotted with the same
splash. The mark and the wordmark share that splash, so never swap it for Courier's
own round dot.

**The app icon.** The black mark on a white rounded tile, filling about two thirds of
it. It is centred optically, not by its box: the heavy letters sit low and the light
splash high, so the generator places the point halfway between the ink's box centre
and its centre of weight a hair above the tile's middle. The same artwork is the
favicon and the desktop and iOS icons.

**Colour.** The logo is **black on white**, in every theme.

| Where | Mark / wordmark | Behind it |
|---|---|---|
| App icon, favicon, any brand tile | `--brand-mark` (black) | `--brand-tile` (white) |
| On paper (light theme) | `--brand-mark` or `--text-primary` | the page |
| On ink (dark theme) | `--text-primary` (the page's ink colour) | the page |
| On Midnight | `--text-primary` (Ember), never on a tile | the page |

The logo never takes Ink Blue, another ink or the accent. Ink Blue (`--brand-ink`) is
the interface's colour: the default accent, links, focus.

**In code.** Use `Mark`, `Wordmark` and `AppIcon` from `src/ui` (`Brand.jsx`). They
draw inline in `currentColor`, so they follow the surface. Standalone files are in
`src/assets/brand/` (`mark.svg`, `wordmark.svg`, `app-icon.svg`) and
`public/favicon.svg`.

**Clear space and size.** Keep clear space of at least the splash's width around the
mark (half the wordmark's height around the wordmark). The mark is legible from 16px
and the wordmark from 72px wide; below that, use the mark alone.

**On the landing page** the name is signed small: the `Wordmark` alone, 20px tall, in
`--text-primary` in the bottom-left corner, with the version beside it in `.ib-meta`.
The writer's projects are the page; the app icon is not on it.

**Brand vs accent.** The logo is black and white. `--accent-color` is the writer's
choice: Sage by default, or one of six inks. It marks interactive states
(selection, focus, primary buttons, the active tab).

**Don't** recolour the logo, add effects (shadows, gradients, glass), stretch it,
redraw the splash, give either *i* a plain round dot, re-space the monogram, or set
the name in any face other than Courier Prime.

---

## 3. Colour

### Neutrals: paper and ink

The light theme is **paper** and the dark theme is **ink**. Both are warm, not pure
white or pure black, which is easier on the eyes over long sessions. Don't use `#000`,
`#fff` or cool greys.

**Midnight** is the exception, chosen by hand: true black (`#000`) paper, so the pixels of
an OLED or mini-LED screen switch off, with the words in warm **Ember** (`#c9a273`), never
white, which blooms on black. The page, the tray (whatever the window colour) and
wells are all `#000`; raised surfaces step up to `#0b0a09` and floating ones to
`#12100e`, and the hairlines are Ember at low strength. A shadow can't show on black, so
Midnight's `--shadow-*` tokens lead with an Ember hairline: depth is drawn as a
wireframe, and the document card is parted from the tray by its hairline alone. The inks
are dimmed to about 5:1 on black (still AA), so notes keep their colour without glowing,
and the accent dims with them; `--accent-foreground` is the accent itself, not lifted
toward white, and `--on-ink` is black. The sidebar tab strip's selector is drawn in
Ember, not the accent.

| Token | Use |
|---|---|
| `--app-bg` | The document and the window: one seamless surface |
| `--surface-1` | Cards and tiles inside a panel |
| `--surface-float` | Floating panels, popovers, menus, dialogs |
| `--surface-sunken` | Wells: code, previews, drop zones |
| `--tray-glow` / `--tray-top` / `--tray-bottom` | The window's tray gradient stops, from `--tray-ink` (the window colour). Drawn by `.ib-tray` |
| `--tray-sheet` | The tray's flat middle: the paper a sidebar's tab strip is cut from |
| `--surface-hover` / `--surface-active` | Row and control states (translucent) |
| `--text-primary` | Body text and titles |
| `--text-secondary` | Supporting text |
| `--text-muted` | Labels, hints, icons at rest |
| `--text-subtle` | The quietest legible text (metadata) |
| `--text-placeholder` | Input placeholders only |
| `--border-color` / `--border-muted` / `--border-strong` | Hairlines, from default to faint to emphasised |
| `--text-on-accent` | Text on an `--accent-color` fill |
| `--on-ink` | Text on an ink fill (tags, badges) |

### The ink palette

There are eight fountain-pen inks, each tuned per theme: deeper on paper, lighter on
ink. They form **the** categorical palette. Notes, canvas cards and edges, part-of-speech
tags, map layers, accent presets and the window colour (`data-tray`, any ink) all draw
from it. No feature invents its own set.

| Id | Label | Typical use |
|---|---|---|
| `blue` | Ink Blue | Brand |
| `teal` | Teal | |
| `green` | Green | Success |
| `amber` | Amber | Default note colour, warnings |
| `rust` | Rust | |
| `red` | Red | Danger |
| `violet` | Violet | |
| `slate` | Slate | Neutral category |

**Sage** (`--ink-sage`, the website's brand green) is the default accent and window
colour. It is a chrome colour only, not a ninth ink: no note, card, lane or tag takes
it, so `INK_IDS` stays eight and colours hashed over it (version history) don't move.
In code it is `CHROME_INKS` / `ChromeInkId` in `src/lib/palette.ts`.

In code:

```js
import { inkColor, inkVar, INKS } from '../lib/palette'

// Store the id, never the hex. Draw with inkColor(), which also maps hex values
// saved by the older palettes to their ink.
note.color = 'teal'
style={{ '--card-color': inkColor(note.color) }}
```

`resolveInkHex()` returns the current literal hex, for the rare API that cannot take a
CSS variable (a 2D canvas context, or content that stores literal colours, like a map).

**Picking an ink.** A thing on the page (a note, a table cell, a canvas card, a map pin,
a timeline lane) is coloured with `InkWheel`. The control is the thing's own colour, and
pressing it blooms the inks out of it into a ring of floating dots: no surface behind
them, only their shadows. Every ink always opens in the same place, so a hand learns the
ring, and the current ink's place shows as an empty socket. The dot in the middle is a
size smaller than the ring's (20px to their 24px) and haloed in grey, so it reads as the
one in hand.

- **The middle dot is what you move.** Swipe toward an ink and the held dot gives a
  little while that ink leans in to meet it. Go far enough and they trade places: the
  ink slides straight in under the held colour, which goes out over it to the ink's
  place. At rest, no dot covers another. Let go and the new colour settles in the middle while the rest fold
  back. Swipe back toward the middle before letting go to trade them back.
- **Mouse.** The cursor is hidden while the ring is open: the middle dot stands in for
  it. Pointer Lock puts the cursor back where it started. A click opens the ring and a
  second click lets go.
- **Touch and pen.** Drag the same way, or tap an ink.
- **Keyboard.** Enter, Space or ↓ opens the ring. The arrows (or 1–9) move round it,
  Enter takes and Escape leaves.
- **No colour, or Default.** Pass `none` and the ring gets a hollow last place for it.

A labelled choice inside a form (the accent, the window colour, a folder type) stays an
inline `InkPicker` row, because there the names help more than speed does.

**Acting on a selection.** Selected text is acted on with the selection wheel
(`ToolWheel`, opened by `SelectionWheel`). It works on the same idea as the ink wheel:
every tool always opens in the same place, so a hand learns the way. The ring is 40px
tool discs around a still middle where nothing is chosen. The tool pointed at fills with
the accent, and its name shows under the ring.

- **Nothing appears by itself.** The wheel opens only when asked: hold Option (or the key
  chosen in Settings) on its own over a selection, or use "Open selection wheel" in ⌘K.
  A key held with anything else (⌥⇧→, ⌥-letters, a shortcut) is left alone.
- **Hold.** The pointer stays visible. Its direction from where it was when the wheel
  opened picks a tool, and letting go of the key takes it. Letting go at rest takes
  nothing.
- **Tap.** A quick tap of the key leaves the wheel open: click a tool, or press Escape or
  click outside to leave.
- **Keyboard.** The arrows (or 1–9) move round it and Enter takes.
- **Touch.** Without a keyboard, a long press on the selection opens it under the
  finger. Drag toward a tool and lift to use it. Lifted at rest, the wheel stays open to
  tap.
- **Options.** A tool with options (Highlight's inks) shows a small dot. Rest on it, or
  press Space, and the ring blooms again as its options where the hand is. Backspace
  goes back.
- **Can't act here.** A tool that can't act on this selection keeps its place, dimmed,
  so the ring never rearranges. One already on the selection (bold text) draws its icon
  filled.

Writers choose the tools and their order in Settings ▸ Selection wheel, up to eight,
with `ToolWheelPreview` drawing the ring as it will open. A new tool goes in
`lib/selectionTools.js`.

### Status

`--status-danger` (red ink), `--status-warning` (amber) and `--status-success` (green).
Always pair a status colour with an icon or words. Colour is never the only signal.

### The card recipe

A coloured card is washed with its ink at 10% and bordered with it at 30% (45% on
hover). Set `--card-color` (and `--card-base` if the card doesn't sit on `--surface-1`),
and use `--card-tint`, `--card-edge` and `--card-edge-hover`. The `Card` primitive does
this for you (`<Card ink="amber">`). A new kind of card that sets `--card-color` itself
must be added to the recipe selector list in `tokens.css`, because custom properties
resolve where they are declared.

### Contrast

Body text meets WCAG AA (4.5:1) against every surface it sits on, in every theme. That
includes the ink palette on `--app-bg` and `--on-ink` on every ink; the current values
all pass. Large display text and icons need 3:1. Re-check whenever you change a value
in `tokens.css`; `tests/unit/css.mjs` checks Midnight's text and inks.

---

## 4. Themes

There are four choices: **Light** (paper), **Dark** (ink), **Midnight** (true black,
Ember text) and **System**, in Settings › Appearance and ⌘K. System picks Light or Dark;
Midnight is only ever chosen by hand.

`<html data-theme>` is **always** `light`, `dark` or `midnight`. "System" is resolved in
JS (`src/lib/theme.ts`) before first paint, and re-resolved when the OS changes. So:

- Write each theme's values **once**, in `tokens.css`, under
  `:root[data-theme='light']` / `[data-theme='dark']` / `[data-theme='midnight']`.
  Midnight overrides Ink, so it lists only what differs.
- **Never** write `@media (prefers-color-scheme)` in a stylesheet.
- A component rarely needs theme-specific CSS, because the tokens already switch. If one
  does, scope it with `:root[data-theme='dark'] .thing, :root[data-theme='midnight']
  .thing { … }` and use tokens inside. In JS, ask `isDarkTheme()`, never `=== 'dark'`.
- The printed page stays print in every theme: page previews and what goes to the
  printer use `--print-*`.
- The accent is `data-accent` on `<html>` (absent means Ink Blue), set by
  `setAccentAttribute()`.

---

## 5. Typography

| Face | Token | Role |
|---|---|---|
| **Inter** | `--font-ui` | All chrome: buttons, menus, panels, labels, dialogs, and the eyebrows (bold capitals) |
| **Literata** | `--font-editor` | The writer's words: the editor, cards, previews, notes' quoted text. The default writing font; the writer can change it |
| **Courier Prime** | `--font-type` | Small typewritten accents only (see below) |
| Courier Prime | `--font-script` | Screenplay and stage-play pages (industry convention) |

All three are bundled (`src/styles/fonts.js`, SIL OFL) so every machine renders the same.

**Where Courier Prime goes**, and nowhere else:

- `.ib-meta`: word counts, stats, dates, times, version names, file sizes.
- `Kbd`: keyboard shortcuts.
- `EmptyState` titles: "No notes yet."
- The wordmark.

It is never used for body copy, buttons, menu items, inputs or headings.

### Scale (UI)

| Token | px | Use |
|---|---|---|
| `--text-2xs` | 10 | Tiny captions, rare |
| `--text-xs` | 11 | Eyebrows, meta, hints, small buttons |
| `--text-sm` | 13 | **Default UI text**, buttons, menus, inputs |
| `--text-md` | 14 | Emphasised UI text, empty-state titles |
| `--text-lg` | 16 | Dialog and panel titles (`.ib-title`) |
| `--text-xl` | 20 | Section headings in large surfaces |
| `--text-2xl` | 26 | Display (`.ib-display`) |
| `--text-3xl` | 34 | Hero only |

Weights are 400 (body), 500 (controls and labels), 600 (titles) and 700 (eyebrows). Use
sentence case everywhere; only eyebrows are uppercase.

**The eyebrow** (`.ib-eyebrow`) is the small label above a group: a sidebar's or panel's
title ("NOVEL", "STATS"), a section head in a dialog, a dialog's kicker. It is Inter
at `--text-xs`, bold (`--weight-bold`), in capitals, tracked by `--tracking-eyebrow`,
in `--text-muted`. Sidebar titles (`.panel-header-label`) are the same style.

Classes: `.ib-display`, `.ib-title`, `.ib-body`, `.ib-hint`, `.ib-eyebrow`, `.ib-meta`,
and `.ib-prose` (any element that shows the writer's text).

---

## 6. Layout: the document is the room

- **The tray and the card**, as in Arc and Dia. The window itself is the **tray**: a
  soft gradient in the writer's window colour (`.ib-tray`, the `--tray-*` tokens,
  Settings → Window colour). The document, canvas, map or timeline sits in one
  **document card** floating on it (`--app-bg`, `--radius-lg`, `--shadow-card`, inset
  `--space-3`, and no border: it stands off the tray by its shadow alone). Inside the card the editor background is
  `--app-bg` and seamless: there is no separate "page" sheet in the writing view. Print
  Layout is the one place pages appear, because there the page *is* the subject.
- **The caret and the selection are drawn, not the browser's.** The caret is a 2px bar
  as tall as the text, not the line (`TextCaret`). The selection is a `--selection-bg`
  band a line tall behind each line, notes' dots and bubbles' chips included, and a
  paragraph's bands are one solid shape with every corner rounded `--radius-xs`,
  inside and out (`SelectionHighlight`). Colour or hide the
  caret with `--caret-ink`, never `caret-color`.
- **Docked or hovering sidebars.** The file tree (left) and inspector (right) are
  either **docked** (pinned) or **hidden**. Docked, a sidebar is part of the tray: no
  sheet, border or shadow of its own, and it pushes the card over, so the card's top
  and bottom edges run from one sidebar to the other. Hidden, the card takes the room,
  and moving the pointer to that window edge brings the sidebar up **hovering** over the
  card: the tray, slightly see-through (`.ib-tray.is-veiled`, `--tray-veil-alpha`), with
  a hairline, `--radius-lg` and `--shadow-float`. Its edges sit halfway across the
  tray's gap round the card. It goes when the pointer leaves, on a click outside, or on
  Escape, and the card never moves for it. The sidebar icons in the card's top corners
  pin and unpin each side (also ⌘K "Show/Hide sidebar", "Show/Hide inspector"). On the
  tray, muted and subtle text are the main text colour let down toward the tray
  (`--tray-text-*-mix`), which keeps them AA on every ink. Other floating panels use
  `Panel` / `PanelHeader` / `PanelBody`.
- **Inlay: a panel's own controls sit bare on its paper.** A panel's search and +
  are glyphs and text drawn straight on the tray: no fill, no border, no channel,
  no shadow. A hovered round button darkens a little, as a tab does. A field shows
  focus by inking its glyphs (`--accent-foreground`); buttons inside it keep their own
  focus rings. Use `Inlay` in any panel (`round` marks a single round button).
  Controls that sit side by side go in an `InlaySlot`, which lays them out a kerf
  apart (`--inlay-kerf`), as the + and the search at the left sidebar's foot. Keep it to the
  panel's utility controls. Never put a `floating-capsule` inside a panel. Menus,
  popovers and drawers that open from an inlay still float. When a piece is lifted out
  of a panel, hide it with `visibility` so the panel doesn't reflow until it returns.
  A sidebar's tab strip is engraved into the panel: the strip is a
  channel (`--inlay-floor`), and the tabs and the active-tab indicator (its clear
  accent tint, a pill, concentric with the channel) sit on its floor. Held, the indicator
  grows a little past the channel's top and bottom edges; on the move
  (clicked to another tab, dragged or swiped quickly) it squashes vertically and
  stretches along its path with its speed, as Liquid Glass's selector does.
- **The card's toolbar.** The toolbar sits at the top of the document card, like Dia's
  address bar, on the card's own paper and ruled off from the document by one thin
  border: a `--hairline` in `--border-color`, the full width of the card, under the
  toolbar row (`.app-titlebar`'s `border-bottom`). It is the one rule in the room, and
  it is meant: it says where the chrome ends and the page begins. The document's scroller
  starts at the rule, so text and the scrollbar stop clean against it: no fade or
  shadow below it. Its icon
  controls are bare on the paper: a fill only on hover, and the accent tint for a
  control that is on. Its menus (text style, font, size) carry the quiet control fill
  (`--control-bg`), so they read as menus rather than labels. It is a dense toolbar
  (§8): 16px icons on `--size-capsule` buttons. Every view's tools are this toolbar,
  one context each (`chromeLayout.ts`: document, canvas, map, timeline, Typeset), and
  the writer can customise each. A view never adds a second band of tools under the
  rule.
- **The dynamic toolbar** (round 03b, 2026-10-22; pages 2026-10-29). What a toolbar
  button opens, it opens **in place**, on the control fill beside its button: it grows
  open, pushing what follows along, and sets aside what no longer fits (what follows it
  first, then what comes before), which comes back when it closes. It never carries a
  heading: no eyebrow, no group titles. A choice that has an icon is its icon
  (alignment is three icons, not words); a choice that's a value is its value (a font's
  name in its face, a size, a paragraph style), and its button shows the current one.
  A long choice (the fonts, the voices) scrolls within a bound. Read aloud is one row:
  read or stop, its level meter, the voice (which swaps the row for the voices) and,
  while it works, a line of what it's doing. Only a form that needs the row
  (`dock="whole"`, as find) takes the whole toolbar, with a close button. The button
  stays pressed while it's open, focus goes to its first control and back to the
  button, and Escape closes it.
- **Toolbar pages.** A toolbar's items are pages, divided by page breaks the writer
  places in Customize toolbar (the document's default: writing, then inserting and the
  voice). A page too wide for the row carries on onto the next. Dots at the row's end
  show the pages; the current one is a pill. A two-finger swipe turns the page as the
  sidebars' does, over a travel shorter than the row: the page leans a little the
  fingers' way and fades as far as they've gone (never below a quarter, so it's still
  there at the furthest), the swipe clicks onto the next page (a light tick)
  once the fingers are halfway, and letting go from there turns the page (a firmer tick),
  the new page fading up as it slides in; a flick turns it at once. A click on a dot, ⌃←/⌃→ or the palette's commands turn it too, without haptics;
  Escape comes back to the first. Turning away from a page closes what's open on it.
  Customizing works on the page that shows: swipe to another, drop an item on a dot to
  move it there, add or remove a page.
- **Split view: two cards.** Two documents side by side (or stacked) are two cards on
  the tray, not one card divided. The toolbar steps out into a card of its own across
  the top, and the tray shows between all three, as wide a gap as round the outside
  (`--space-3`). The gap is the divider: pointed at or dragged, a small rounded grip
  shows in it, as between two windows tiled on a Mac (the arrows move it too). The panes carry
  no title bar. Every split made is kept in the file tree, pinned above the files: one
  row holding both documents side by side, each left-aligned with its kind's icon and
  ruled apart by a hairline (`--border-color`), as the panes are; its × shows at its
  right on hover and closes it. Choosing the row shows the split; choosing a document shows that document
  on its own, and the split waits in its row. While a split shows, its row is the
  lifted selection and its two documents are only shaded (`--surface-hover`). A document dragged from the file
  tree onto the page outlines, in grey, the side it would take; resting there opens the
  split for real, the new document dimmed under the outline until the pointer lets go
  (that is what keeps it), and moving on puts it back with the document under the pointer again,
  as a clipboard piece settles into the page and lifts out.
- **Modes that take the card over.** Focus mode keeps the card on the tray, inset
  `--space-3` all round, and puts both sidebars away as it opens (they hover in from
  the edges as ever, and come back docked when it closes). Its controls are the
  toolbar row itself — the same height, paper and rule, the sidebar buttons in its
  corners — floating in over the card's top while the pointer is there, and never
  pinned (`FocusModeBar`). Its text is the writer's, in `--font-editor`, and the
  sentence zooms between its place on the page and the centre as focus mode opens and
  closes (`FocusModeOverlay`), so the page and the mode read as one surface. A mode's
  Done is a round check (`IconButton icon="check" size="circle"`), labelled Done for
  its tooltip and screen readers. A bubble takes its pane's place: the pane gives up its card
  so the bubbles lie on the tray, the toolbar steps out into a card of its own as in
  split view and holds the bubble's bar, and in a split the other document stays a
  card beside it.
- **The fade scrim.** Other chrome that overlays the document (a bottom bar, the tab
  bar) sits on a gradient from solid `--app-bg` to transparent, so text scrolling
  underneath dissolves instead of hitting a hard line. The foot of a pane has none:
  the text runs to the card's edge, and the word count and page capsules float over
  it on their own. Use `FadeScrim`. Don't give that
  chrome a solid bar or a border: the card toolbar's hairline is the only rule over
  the document.
- **The traffic lights never move.** On macOS they sit in one place from launch
  (20px in, centred 30px down; placed before the first frame), the same on the
  landing page and in a project. The left sidebar's first row (the project name) is
  centred on their line and leaves room for them. In a project they go with the
  sidebar: hidden whenever it is hidden, so they never sit over the card
  (`lib/trafficLights.js`, `src-tauri/src/window_chrome.rs`).
- **Panel anatomy.** Every inspector panel is built the same way, top to bottom:
  1. **The header row**: the eyebrow title and, at its right, at most one `ScopeMenu`
     (what the panel shows: "This document ▾") and one `MoreMenu` (⋯, the rarer
     options), put there with `PanelActions`. A panel's one add or save action may sit
     there too, as an `IconButton`.
  2. **At most one `Segmented`**, a view switch ("Today · History · Insights"), flush
     on the panel. Never a second row of tabs: further scope is the header's menu.
  3. **Sections** (`Section`) straight on the panel, divided by hairlines. A section's
     one action goes in its `accessory`, at the right of its title.
  The inspector has no search of its own: finding is the project search's.
- **The inspector's foot.** The left foot mirrored: the word count (while the
  inspector is docked) on the inner end, the archive on the outer end, where the left
  foot has its +. It stays the same whichever panel is showing, and the archive opens
  over that panel, with a way back to it. Archive actions that come later go here too.
- **The project search.** One search, at the left sidebar's foot: the view's + on the
  outer end, a bare search icon on the inner end (`search/ProjectSearch.jsx`). The
  icon opens a card upward, its left edge on the icon's, reaching out over the
  document. There are no scopes or match options to pick. What is found is sorted under
  eyebrowed categories (In this document, Documents, Notes; with nothing typed: Open,
  Recent files, Recent searches), one row per document, a name match first. ↑/↓ and
  the pointer move one selection, Enter opens it. Pausing on a document that isn't open
  shows a preview of it beside the card, the first match marked. ⇧⌘F is the same card,
  centred. The card and its preview are the pop-up surface veiled
  (`--search-veil-bg` over `var(--blur-over-page)`), with a hairline edge and the
  float shadow (§12).
- **The find bar.** Find and replace in the open document (⌘F) takes the card's
  toolbar while it is open, as an address bar becomes a find field (`FindBar.jsx`):
  the field, "2 of 5", previous, next and close, and a click away the replace field
  beside it. Escape puts it away and the toolbar's tools come back as they were.
  Nothing floats over the text being searched.

  Nothing in a panel sits in a band, a filled strip or a bordered box of its own.
  `Card` is for things the writer made (a note, a source, a version, a tile), never
  for a panel's controls.
- **Controls on the tray.** Fields, menus, segmented tracks and text buttons in a
  docked or hovering sidebar are the tray's paper a step darker (`--control-bg`), with
  no border and no white box; focus draws the ring. A text button in a section is a
  control fill too, at the start of its line, never stretched across the panel.
- **Selection is lifted paper.** The chosen row in a list (the open document in the
  file tree, the page showing in a `NavSheet`)
  is lifted out of its surface onto `--app-bg` with `--shadow-lift`, with no tint and no
  border. The accent marks focus and controls that are on, not where you are.
- **Several rows are one sheet.** In the file tree and the Book navigator, ⌘-click adds
  or takes away a row, ⇧-click chooses the run from the last row clicked, ⌘A every
  row showing, Escape lets go (`lib/treeSelection.js`). Chosen rows are lifted as the
  open one is, and rows that touch join into one sheet: square corners between them,
  no shadow across. The open row left out of a selection is only shaded
  (`--surface-hover`). A chosen row's menu acts on all of them ("Delete 3 items"),
  and dragging one carries them all, the ghost wearing a count in an accent pill.
  A click focuses the list without a ring. A ring shows only when focus comes from the
  keyboard, drawn inside the list so its frame can't clip it.
- **The landing page.** With no project open, the window is a frosted pane of leaves
  in summer light (`LandingBackdrop`): the website's footage, blurred once when it was
  encoded and again by `--landing-blur` on the video itself, under a flat sheet of the
  theme's paper (`--landing-scrim`). The scrim is as thick as `--text-primary` and
  `--text-secondary` need to stay AA over the footage's darkest and brightest leaves
  (`tests/unit/landing.mjs`), so text straight on it uses only those two. It is a
  filter on the footage, never a `backdrop-filter`, and not glass: nothing in the
  window is seen through it. It holds still on its poster under Reduce motion or
  Save-Data, gives way to the plain tray under Reduce transparency, and pauses while
  the window is hidden. The footage's credit sits small in the bottom-right corner.
- **Piles of paper.** Each project on the landing page is a pile of the documents
  lately written in it (`PaperPile`), most recently opened project first, in a centred
  grid: the one it reopens on is on top, up to four opened before it beneath, each a
  `PaperSheet` with its opening lines. Pointing at a pile fans it so every sheet can
  be clicked; a click opens the project at that sheet's document, anywhere else on the
  pile (or its name, or Enter) at the top one. Under it are the name, its files and
  words in `.ib-meta`, and a ⋯ (`MoreMenu`) whose items a right-click offers too. The
  grid's last place is an empty dashed pile for a new project. Nothing is read from
  disk to draw a pile: excerpts and counts are remembered (`lib/docExcerpts.js`,
  `lib/projectSummaries.js`).
- **Layers.** Use `--z-chrome` < `--z-panel` < `--z-popover` < `--z-dialog` < `--z-toast`
  < `--z-tooltip`, and `--z-gesture` for a gesture in progress (the ink wheel), which
  sits over everything, including older layers outside this scale. Don't invent
  z-indexes.
- **Reading width.** Prose stays near 65–75 characters. The editor's `max-width`
  handles this; don't widen it for chrome.

---

## 7. Space, shape, depth, motion

**Space** is on a 4px grid with one 6px half-step for tight chrome:

| Token | px | | Token | px |
|---|---|---|---|---|
| `--space-1` | 4 | | `--space-5` | 16 |
| `--space-2` | 6 | | `--space-6` | 24 |
| `--space-3` | 8 | | `--space-8` | 32 |
| `--space-4` | 12 | | `--space-10` / `--space-12` | 40 / 48 |

Lay out siblings with flex/grid and `gap`, not margins.

**Density is comfortable.** Controls are `--control-h` (32px), small controls
`--control-h-sm` (26px) and list rows `--row-h` (36px). The shared `Button` sizes are
`--size-capsule` (26px, inline and inspector controls), `--size-circle` (28px, round
icon buttons) and `--size-toolbar` (36px). Don't go smaller. Beginners and touch users
need the target.

**Capsules** over the page come in two heights. A **readout** (the word and page count,
the locked badge, the zoom bar) is `--size-circle`, level with the file
tree's foot. A **strip of buttons** (the table toolbar, the timer) is `--size-toolbar`:
`--size-capsule` buttons in a `--space-1` inset. Every capsule is on `--z-chrome`.

**Radius is soft:**

| Token | px | For |
|---|---|---|
| `--radius-xs`, `--radius-sm` | 4 | Inputs, selects, chips, small controls, menu items |
| `--radius-md` | 8 | Buttons, segmented controls, steppers, cards, rows |
| `--radius-lg`, `--radius-card` | 12 | Floating panels and capsules, popovers, menus, dialogs |
| `--radius-pill` | 999 | Tags and toggles **only** (and round icon buttons) |

**Depth.** Only floating things cast shadows: panels, menus, popovers and floating
toolbars use `--shadow-float`, and dialogs use `--shadow-dialog`. The document card
uses `--shadow-card` and a lifted selection `--shadow-lift`: the same depth with no
ring, so neither draws an edge. Everything inside a
surface is separated by hairlines and tonal shifts, never by shadow. The one exception
is a sidebar's engraved tab strip (§6), the only place inside a panel with a shadow or a
highlight.

### Motion is physical

Every motion in Inkblot is physics, as on Apple's platforms (WWDC18 *Designing Fluid
Interfaces*, WWDC23 *Animate with springs*). Things move on **springs**, never on timed
curves. A gesture hands its speed to the motion it lets go, and anything moving can be
grabbed or redirected without a jump. Motion explains where something came from and
never decorates; it is still subtle and quick.

**The maths** lives in `src/ui/physics.js`, in milliseconds and units per millisecond.
A spring is described the way Apple describes one, by a perceptual `duration` and a
`bounce`, and solved exactly (mass 1):

- stiffness `k = (2π / duration)²`
- damping ratio `ζ = 1 − bounce` (bounce ≥ 0), or `1 / (1 + bounce)` (bounce < 0)
- damping `c = 4π·ζ / duration`
- `springAt(spring, from, to, velocity, t)` is the closed-form solution of
  `x″ = −k(x − to) − c·x′`. It is a function of time, not of frames, so a spring moves
  the same at 60Hz and 120Hz.

**The springs, by role** (`SPRINGS` in physics.js; `--spring-<role>` and
`--spring-<role>-dur` in CSS):

| Role | Duration, bounce | For |
|---|---|---|
| `quick` | 200ms, 0 | Hovers, presses, small state changes, menus |
| `smooth` | 300ms, 0 | Popovers, panels, sidebars, dialogs, content arriving |
| `gentle` | 550ms, 0 | The long carry: a landing sheet becoming the card, focus mode's zoom, the map's camera |
| `exit` | 160ms, 0 | Something leaving the way it came, quicker than it arrived |
| `momentum` | 350ms, up to 0.15 | Landing after a flick or a drag, from the hand's speed (`releaseSpring`) |
| `tether` | 330ms, 0.48 | Things hanging from what the hand moves: a dragged note's children |

The durations are perceptual. `--spring-<role>-dur` is the settle time, which is
longer: a `quick` spring looks done by about 120ms and is still by 272ms. A spring is
settled once it stays within 0.2% of its target, so a bouncy one's overshoot is part of
its curve rather than cut off before it.

**Bounce only rewards momentum.** A state change (a menu opening, a panel sliding) is
critically damped: bounce 0, with no overshoot. Only motion that a gesture with
momentum drives may overshoot, and only as much as the throw earned:
`releaseSpring(speed)` scales the bounce from 0 for a let-go slower than a flick
(0.3px/ms) up to `momentum`'s 0.15 at 1.5px/ms. A slow drop lands dead, and a hard flick
lands with a little bounce. Apple's Music works the same way: tap-to-open is fully
damped, while swipe-to-dismiss is 80% damped. `tether` is the one exception, because the
hand is still moving the things it swings. Never go past bounce 0.4.

**Gestures:**

- **Decide before moving.** A press becomes a drag only past the slop (`pastSlop`:
  4px for a pointer, 10px for a finger, measured straight-line). A press that hasn't
  gone that far is still a click. Every drag uses the same slop (`GESTURE`).
- **Track one to one.** A dragged thing stays under the hand, at the point it was
  grabbed, never snapped to its centre. While held it has no transition at all.
- **Hand the speed over.** Measure the release speed at the moment of release
  (`velocityFrom(samples, window, at)`, with `trackSample` keeping the path). It is
  fitted over the last ~90ms, never taken from the last two events. A hand that held
  still before lifting has no speed, so a drag that stops and then lets go is never
  thrown. Give the speed to the spring that takes over (`SpringValue.set(target,
  { velocity, spring: releaseSpring(velocity) })`).
- **Project where a flick lands.** A release goes to the target nearest where it would
  coast to, not to where it was let go: `project(v) = v · rate / (1 − rate)` at
  UIScrollView's rates (`DECELERATION.normal` 0.998 a ms, `.fast` 0.99), through
  `settleOnTargets`. One rule decides both a flick and a slow drop, with no separate
  speed threshold. A sidebar thrown toward its edge collapses this way.
- **Turn pages by a flick's speed.** A page view (the sidebar panels, the toolbar's
  pages, the tab indicator) turns as iOS pages: let go faster than a flick, it turns one
  page that way however little it has moved, and slower, it lands on the nearest.
  Projection would carry a slow drift over too. A pointer flicks at `GESTURE.flick`
  (0.3px/ms, iOS's measured paging speed); a trackpad swipe at 0.5px/ms, because macOS
  speeds its scroll deltas up.
- **Act on a pause, not a timer.** A drag that does something when the hand stops (a
  dwell over a folder) reads the stop from the samples (`isPausing`): a sharp fall in
  speed shows sooner than any timeout.
- **Coast.** A view thrown while panning (the canvas, the map) carries on under the same
  friction and stops at the next touch (`coast`). A trackpad already coasts on its own,
  so wheel input never gets a second coast.
- **Rubber-band the edges.** Past a limit, movement gives less and less, as
  `rubberBand(offset, dimension, c) = c·x·d / (d + c·x)`, and springs back on release.
  `c` depends on what is pulling (`rubberCoefficient`, UIKit's values): 0.55 for a
  finger, 0.4 for a mouse, 0.17 for a trackpad. A pointer moving over the content gets
  a stiffer edge than a finger dragging it. An edge caught while it springs back is held
  where it is drawn (`rubberUnclamp`), and a release past an edge hands over the speed
  the edge was drawn at (`rubberSlope`). This applies to the sidebar resize, the split
  divider, the panels' swipe and focus mode's scrolling.
- **Land a drop.** Let go of a dragged item and it springs from under the hand into its
  new place, at the speed it was let go, while the items that moved for it spring
  from where they were drawn. Nothing jumps. `usePointerReorder` does this for the
  toolbar, the inspector and the Book (`springLayout`). The file tree's ghost
  springs onto the row it became.
- **Interrupt anything.** Retargeting a running spring keeps its position and its
  velocity (`SpringValue.set`). A click mid-swipe, a second zoom step or a regrab
  mid-glide redirects the motion; it never restarts it.

**Where to write it:**

- **CSS** for motion nobody holds: `transition: opacity var(--spring-quick-dur)
  var(--spring-quick)`. The tokens are `linear()` curves sampled from the same springs
  by `scripts/gen-spring-tokens.mjs`, with a fitted `cubic-bezier` fallback where
  `linear()` isn't supported. Edit `SPRINGS`, then run the script; never hand-edit the
  block. A release's speed can go to CSS too: `springTransition(spring, { from, to,
  velocity })` bakes it into a one-off `linear()` curve, so a let-go lands on the
  compositor (the sidebars' panels and tab indicator do this).
- **Script** for anything held, thrown or retargeted: `useSpring` / `SpringValue`
  (one shared frame loop, values handed to a callback that writes the style, with no
  render per frame). Use `springTiming(SPRINGS.x)` for Web Animations keyframes,
  `progressOf` for a script-stepped 0→1 (the map library's camera takes one as its
  easing), and `toFramer(SPRINGS.x)` for a framer-motion `transition`.
- **Never step a spring through React state** on a big surface. It re-renders the
  whole surface every frame, a slow render freezes the motion, and the time-based
  spring then jumps ahead. Write the style from `SpringValue`'s callback, or hand the
  whole motion to CSS with `springTransition`.
- **Not springs:** loops and progress (a skeleton's sheen on `--dur-shimmer`, a caret's
  blink, a progress bar's `linear`, the drawing of a note's string) show time passing,
  not something moving between states. They stay linear or stepped. A pulse that only
  says something is live (a recording dot, the dictation button finishing, a toolbar
  item wiggling while it can be moved) breathes on `ease-in-out`: it goes nowhere, and a
  linear pulse reads as mechanical.

`npm run lint:design` flags a timed curve where a spring belongs: the deprecated
`--dur-*` / `--ease-*` aliases, `cubic-bezier()`, the `ease` keywords, a raw duration,
or framer's `ease:`. It also fails if the tokens are stale.

**Pressing.** A control answers the moment the hand lands, not when it lifts: `Button`
(and so `IconButton`), a segment and the floating action button give to
`--press-scale` at once, with no transition, and spring back on `--spring-quick` when
let go. The action itself still waits for the release, so a press dragged off cancels.

**Turning round.** Something told to go back while it is still on its way goes back
from where it is drawn, never from the start of the other animation. A popover or
dialog closed while it opens fades from its pose. A hover note closed while it pops,
or hovered again while it shrinks, turns round where it is. Leaving focus mode before
its zoom has landed retraces the zoom. A keyframe animation restarts from its first
frame, so anything that can be turned round mid-way reads its pose and is moved on
from there by script.

**Leaving.** Dialogs, popovers and menus leave the way they came on `--spring-exit`.
`useExitAnimation` does this without the caller keeping them mounted, and a surface
opened again while its last copy is still leaving takes that copy away. There is no
looping or attention-seeking animation, with one exception: a skeleton's sheen (see
Content arriving, below). The landing page's footage loops, slowed and frosted, as a
window's view does. It is the place, not the interface, and it stops for Reduce motion
(§6).

**Reduced motion.** `prefers-reduced-motion` is honoured globally (`base.css`), and
script springs honour it too: `SpringValue` jumps to its target, `coast` doesn't coast,
and `prefersReducedMotion()` (physics.js) is the one check. framer-motion components
also check `useReducedMotion()`. A staggered motion (the ink wheel's fold) must also
drop its `transition-delay` under reduced motion, which `base.css` doesn't reset.

The ink wheel's motion:
- **Bloom.** The dots all open at once on `--spring-smooth`, as they fold back.
- **Following the hand.** Once open, the dots are painted every frame with no
  transition, so nothing lags behind the hand.
- **Trade.** A trade is a straight slide on the `smooth` spring (`springTiming`),
  animated on the `translate` property on top of the painted position, so a dot lands
  on the hand wherever it has moved to.
- **Stretch.** A moving dot stretches along its path, to about 1.3 × 0.8 at 40% of the
  way, and rounds off as it lands. This applies to the bloom, the trade and the fold.
  The stretch is on an inner face, never on the element that is positioned, and
  there's none under reduced motion.
- **Close.** The taken ink springs to the middle (`--spring-quick`), and the ring folds
  back counter-clockwise on `--spring-exit`, 8ms apart. That ink then sinks into the
  control.

### Content arriving

Content that loads arrives in a few deliberate stages, never as a dozen independent
pops, and a load that is quick never shows it was loading. The primitives are in
`src/ui/Reveal.jsx` and `revealState.js`; the timings are the `--spring-smooth` spring and the
`--reveal-rise`, `--reveal-stagger` and `--dur-shimmer` tokens, with the waits script
needs in `src/ui/motion.js`.

- **Stages.** The window's frame (tray, card, sidebars, titlebar) is drawn at once.
  The primary content of a screen waits behind a `RevealGate` until every piece has
  reported, then arrives together. Opening a project gates the file tree, both panes'
  documents, the toolbar, the word count and lock badges (with the project's locks)
  and the check that restored tabs still exist. Secondary content (inspector panels)
  waits for the gate, then arrives as its own data does.
- **Opening a project from a pile, the sheet becomes the document.** The sheet
  clicked lifts out of its pile and grows into the document card on the `gentle` spring,
  turning square as it goes, its own face fading as the opening lines appear in the
  editor's type exactly where the editor will draw them (`landing/SheetFlight`). The
  other piles sink away at once; the frosted window then fades into the tray, the
  docked sidebars slide in from their edges, and when the document is ready the flight
  fades on `--spring-smooth` into it. The flight sets off before the editor mounts (aimed
  where the card was last time, `lib/landingCard.js`) and bends onto the real card if
  that is elsewhere. Under Reduce motion it is a plain fade. Anything else that opens a
  project (a new project, a folder, a command) fades the start screen out over the
  editor, which mounts beneath it at once so its loads are already running.
- **Don't punish fast loads.** A skeleton shows only after a load has taken
  `REVEAL.delay` (150ms), and then stays at least `REVEAL.minVisible` (300ms).
  `useDelayedFlag` is that rule for any other indicator. A region reloading content it
  has shown before (another document in the same pane) keeps the old content up until
  the skeleton is due, so a quick switch is a plain swap.
- **Reserve space.** Content stays mounted and keeps its layout while hidden; the
  skeleton lies over it (`SkeletonOverlay`), or in a list sized by its content,
  placeholder rows use the real row's box. Nothing moves when the data lands.
- **The hand-off.** Content fades in and rises `--reveal-rise` on `--spring-smooth`.
  Lists stagger their items `--reveal-stagger` apart (`.ib-stagger` and
  `staggerStyle(index)`), capped so a long list never trails off. Only `opacity` and
  `translate` move; `translate` is its own property, so it composes with a framer-motion
  `transform`.
- **The sheen.** A showing skeleton carries a slow sheen in the surface's own colour.
  A skeleton only appears once a load is genuinely slow, and there a still block reads
  as broken. It stops under reduced motion, where reveals are instant and staggers drop
  their delays.
- **Never a false empty state.** An `EmptyState` speaks only once the data it describes
  has been read. Until then the region is loading, not empty.
- **Spatial documents.** A canvas, map or timeline has no layout to copy before it is
  read, so its empty surface (the dot grid, the map's paper) shows at once and its
  skeleton suggests the kind: a few cards, a sheet with pins, an axis with events
  (`src/canvas/PaneSkeletons.jsx`, `PaneSurfaceReveal`).
- **Changing in place.** Something that swaps rather than loads, like the toolbar
  moving from a document to a canvas, stays mounted and replays its entrance
  (`useRevealOnChange`), never remounts.
- **What was shown last shows first.** A list re-read every time (the projects, a
  project's tree) draws as it was last read this session and is replaced in place.
- **Dimming.** Dim a region that may hold loading content with `filter: opacity()`,
  never by setting `opacity` on its children: that overrides the reveal's hidden
  states, and an idle skeleton shows through (`tests/unit/css.mjs` checks panes).

---

## 8. Iconography

- **Phosphor** (MIT), through `src/ui/Icon.jsx`: `<Icon name="note" />`.
- **Weight:** Light at rest, Fill for an active or selected state (`active`).
  `IconButton` does this for you.
- **Size:** 16px inline, in menus and in dense toolbars (the card's toolbar and every
  floating strip are dense); 20px in primary toolbars, empty states and FABs. Nothing
  else.
- **Colour:** `currentColor`, usually `--text-muted` at rest and `--text-primary` on
  hover.
- **Names mean something.** Register icons by meaning in `src/ui/icons.js` (`history`,
  not `clock-counter-clockwise`), so a glyph can change in one place. Add a name only
  when no existing meaning fits.
- Every icon-only control has a label, which becomes its tooltip. Icons don't animate.
- **One meaning, one glyph, everywhere.** A name in `icons.js` has one glyph, and no
  glyph answers to two names. A name nothing uses is removed, not kept for later. `tests/unit/icons.mjs` holds these:

  | Meaning | Icon | Never |
  |---|---|---|
  | Delete or remove something the writer made (a note, an image, a row, a version) | `delete` (trash) | × |
  | Close, dismiss or clear (a panel, a banner, a field, a filter, a tab) | `close` (×) | trash |
  | Put away, recoverably | `archive` | |
  | Add an item to this list | `add` (+) | |
  | Rarer options | `more` (⋯) | |
  | Find | `search` | zoom |
  | Zoom | `zoom-in` / `zoom-out` | `search` |
  | App settings | `settings` (gear) | theme, colour or a panel's own options |
  | A view's own options | `sliders` | `filter` |
  | Narrow a list | `filter` | options |
  | Reorder | `arrow-up` / `arrow-down` | |
  | Expand or collapse a branch | `chevron-right` / `chevron-down` | |

---

## 9. Components

Everything below is exported from `src/ui` (`import { Button, Menu } from '../ui'`).

| Component | Use it for | Notes |
|---|---|---|
| `Mark`, `Wordmark`, `AppIcon` | The logo, wherever the brand appears | Black on white; see §2. Draw in `currentColor` |
| `Button` | Any text action | `variant`: `filled` (the one primary action per view), `tinted` (a normal action that needs weight), `plain` (default: quiet actions in chrome and rows), `destructive` (confirm or offer undo). `size`: `capsule` (default), `circle`, `toolbar` |
| `IconButton` | Icon-only actions | `label` is required and becomes the tooltip and accessible name. Glyph from `icon`, a semantic name. `display` shows the label under or instead of the icon in customisable toolbars. `filled` + `aria-pressed` for toggles |
| `iconElement` | An icon in code that builds DOM by hand (TipTap node views) | `iconElement('add')` returns the same glyph `Icon` draws, as an `<svg>` element |
| `Tooltip` | Naming a control in a richer way than `title` | Short, no period, after a 500ms delay, with an optional shortcut. Never holds anything a user must read to succeed |
| `Kbd` | Showing a shortcut | Courier Prime |
| `Menu`, `MenuItem`, `MenuLabel`, `MenuSeparator` | In-page lists of actions, "More" overflow menus | Arrow keys, typeahead and Escape built in; Tab closes it. `danger` items go last, after a separator. See *Pop-ups* below |
| `popUpMenu`, `useNativeMenu` | Any menu built from a plain list of items | A right-click gets the OS's menu; a button gets an in-page `Menu` from the same items. See *Pop-ups* |
| `Popover` | Small forms and pickers anchored to a control, or to a place in the text | **The one pop-up shell.** `eyebrow`, `align`, `anchorRect`, `onEscape`. Opened from the card's toolbar, it opens in the toolbar (§6, `ToolbarDockContext`). See *Pop-ups* below |
| `Dialog` | **The one modal**: a decision, a form, an editor, Settings | See *Dialogs* below |
| `NavSheet` | A large `Dialog` of pages with a list down its left: Settings and Help | Groups, an `aside` above the list (Help's filter), ↑/↓ between pages; the page showing is lifted |
| `Section` | A collapsible group in an inspector panel | Remembers open/closed per `id`. `accessory` is its one action, beside the title. `help` names its help topic |
| `FormRow` + `Toggle` / `Stepper` / `SelectMenu` | Inspector and settings rows | Label left (as wide as it needs, up to about half), control right; `stacked` for wide controls. `Toggle` applies immediately. `help` names its help topic |
| `PanelActions`, `ScopeMenu`, `MoreMenu` | A panel's scope and ⋯, in its header row | The panel anatomy (§6). `PanelActions` puts its children in the shell's header slot, only for the panel showing. `MoreMenu`'s `items` takes the plain list a right-click's menu takes, so the two share one |
| `PaperSheet`, `PaperPile` | A project as a pile of its recent pages (the landing page) | A sheet is the card's paper (`--app-bg`) in miniature; a pile fans on hover and focus, opens a sheet's document on click, and carries a ⋯. `dashed` is an empty slot. See §6 |
| `Field` + `Input` / `TextArea`, `Checkbox` | Forms in dialogs | Label above, hint below. Errors say how to fix |
| `Segmented` | 2–4 exclusive, short options | Otherwise use `SelectMenu` |
| `Tabs` | Views within a panel | Underline style |
| `Breadcrumb` | Where something sits in a chain that contains it (a map inside a system inside a galaxy) | Every step but the last goes there; the last is `aria-current`. Past four steps the middle folds into “…” |
| `Panel`, `PanelHeader`, `PanelBody` | Floating panels (the two sidebars are the tray's own, §6) | Header title is an eyebrow. An `ib-sheet` |
| `Inlay`, `InlaySlot` | A panel's own filter, search or + | Bare on the panel: no fill or border. Focus inks a field's glyphs. A slot lays out a row of pieces. See §6 |
| `FadeScrim` | Chrome over the document | See §6 |
| `Card` | A bordered block in a panel | `ink` applies the card recipe |
| `Tag` | Small categorical labels | Takes an ink |
| `EmptyState` | Any list or panel with nothing in it | Icon, typewritten line and plain hint, centred; in a panel it sits in the middle of the panel's height. At most one action. `compact` for a section or "no matches" (stays in place); `dropActive` washes it in the accent while something is dragged over |
| `InkWheel` | Colouring a thing on the page | Notes, table fill, canvas cards, map and timeline colours. `none` adds "No fill" / "Default"; `as` + `triggerProps` draw the control as an `IconButton` or a tool button |
| `InkPicker` | A labelled colour choice in a form | Accent and window colour (Settings → General), folder types. Don't build another swatch row |
| `ToolWheel` | Acting on selected text | The selection wheel (`SelectionWheel`). Controlled: mount it at an `anchor` and unmount on `onClose`. `ToolWheelPreview` draws it still, for Settings |
| `FloatingCapsule` | A readout floating over the page (word count, zoom) | The floating-capsule surface; glass on iOS. `--size-circle` tall, on `--z-chrome` (§7) |
| `FloatingToolbar`, `ToolbarSeparator` | Floating tool strips over the page (the table's tools) | Floating-capsule surface with toolbar keyboard behaviour; glass on iOS. `--size-toolbar` tall (§7). A view's own tools go in the card's toolbar (§6), not a strip |
| `FloatingActionButton` | One round primary action over the document | Glass on iOS |
| `usePointerReorder` | Drag-to-reorder lists (toolbar items, inspector layout) | |
| `CommandPalette` | Mounted once in `App` | Features register commands; they don't render this |
| `RevealGate` | A screen whose pieces load separately | Holds them until all report (`useRevealReady`), or `REVEAL.gateTimeout`. See §7, Content arriving |
| `useReveal` | Any region whose content loads | Its `phase` and `skeleton`; spread `contentProps` on the content. `gated: false` ignores the gate |
| `Skeleton`, `SkeletonRows`, `SkeletonOverlay` | Standing in for slow content | Bars sized like what they replace. Over the content, or in an `.ib-skeleton-host` that sets `data-visible` |
| `useRevealOnChange` | Something that changes in place (the toolbar's kind) | Spread its value as `data-reveal`; the entrance replays on each change |
| `CanvasSkeleton`, `MapSkeleton`, `TimelineSkeleton`, `PaneSurfaceReveal` | A spatial pane being read (`src/canvas/PaneSkeletons.jsx`) | The empty surface shows at once, the loaded one fades in over it, the skeleton only when slow |

Behaviour hooks (`src/ui/hooks.js`) are `useDismiss`, `useFocusTrap`, `useRovingFocus`
and `useAnchoredPosition` (`placePopover.js` is the placement maths `Popover` uses). Use them when building anything floating or list-like
instead of re-implementing focus handling.

### Dialogs

There is one modal, `Dialog` (decided in design review round 01, 2026-10-20; see
`docs/design-review/rounds/01-modals.md`). Every modal is built the same way:

- **Header:** an eyebrow saying where the dialog came from (`Book`, `Typeset`,
  `Inspector`, `Toolbar`, `Files`, `Timer`, `Map`), the title in `.ib-title`
  (`--text-lg`), and a one-line description when it needs one. New project, Settings
  and Help have no eyebrow.
- **One visible way out.** The footer's Cancel or Done is it. A dialog with no footer, or
  whose footer doesn't close it (`footerCloses={false}`: Export map, Folder types), shows
  a × at the top right. Escape and a click on the scrim always close a dialog.
- **Footer:** the actions at the trailing edge, secondary then primary. A leading utility
  (Units, Restore defaults, Show) goes first, before `<span
  className="ib-dialog-footer-spacer" />`. In a small dialog, a footer of exactly two
  buttons shares the width between them.
- **Size:** `small` (`--dialog-sm`, 400) for decisions and short forms, `medium`
  (`--dialog-md`, 560) for forms and lists, `large` (`--dialog-lg`, 720) for pages
  (Settings, Help, Customize toolbar).
- **Layer and motion:** on `--z-dialog`, over `--scrim-bg`. It fades in (§7) and leaves the
  way it came. Reduced motion stills both.
- **Focus:** the first control inside, never the ×. Tab stays inside, the app behind is
  inert, and focus goes back where it was.

The **command palette** (⌘K) is a Dialog in behaviour: the scrim, the motion in and out, an
inert app behind, focus trapped and returned (round 02b). Its body is its own: a search
field over a list, with no header or footer.

**Declared exceptions:**

- **Customize toolbar** drops from under the titlebar (`placement="top"`), and the app
  behind it is not made inert, because its toolbar is what items are dragged into.

### Pop-ups

Anything anchored to a control (or a place in the text) that floats until it's dismissed
is a `Popover` or a `Menu` (decided in design review rounds 02 and 02b, 2026-10-21; see
`docs/design-review/rounds/02-popups.md` and `02b-menus.md`). Don't build another floating box: the footnote
editor, read aloud, the e-book Reader, Typeset's page pickers and the citation editor
(plain DOM, with the same classes) are all Popovers.

- **Surface:** `.ib-popover` (`Popover.css`), the menu's surface, on `--z-popover`, with a
  hairline edge. It owns its padding (`--space-4`); call sites add none.
- **Title:** an eyebrow (`eyebrow`) over a pop-up of more than one control, naming it:
  Read aloud, Footnote, Cell fill, Card colour, Print options, Print sides, Reader, Citation,
  and Typeset's pickers (Chapter number, Running head…). A one-line form (Go to page) or a
  strip of tools has none.
- **Insides:** `src/ui` controls (`Field`, `SelectMenu`, `TextArea`, `Button`, `FormRow` +
  `Toggle`, `Segmented`). A pop-up's one bespoke visual is its signature (read aloud's
  live waveform).
- **Motion:** a popover floats in on `--spring-smooth`, a menu on `--spring-quick`, and both
  leave the way they came (§7).
- **Focus:** a popover moves focus to its first control; Tab and ⇧Tab stay inside it;
  Escape or a click outside closes it, and focus goes back to the control that opened it.
  A menu focuses its first item, arrows move, and Tab closes it.
- **Inside a dialog,** a pop-up renders in the dialog's layer (`layer.js`), above it, and
  Escape closes the pop-up before the dialog.
- **Menus: native for a right-click, in the page for a button** (round 02b, 2026-10-21).
  A right-click gets the OS's menu; a menu a button opens is an in-page `Menu`. Both come
  from one description through `popUpMenu`, so a submenu in the list becomes a labelled
  group in the page. The one exception is a toolbar button's menu: it opens in the
  toolbar, as a row of its items (§6).
- **In the card's toolbar, a pop-up opens in the toolbar** (round 03b, 2026-10-22). See
  §6 → *The dynamic toolbar*. `Popover` does it wherever a `ToolbarDockContext` holds
  the button that opened it: in place, without its eyebrow (which still names it for
  assistive tech), or across the toolbar with `dock="whole"`.

**If a component doesn't exist yet,** build it in `src/ui/` from tokens, add it to the
showcase (`src/dev/DesignShowcase.jsx`) and to this table, in the same PR.

---

## 10. Progressive disclosure

How Inkblot is both beginner-simple and pro-deep. Each capability lives at exactly one
of these levels, and is always also in the command palette:

1. **On the surface.** Only what almost every writer needs almost every session: bold,
   italic, headings, lists, add note, undo. The default toolbar stays short.
2. **One click away.** A "More" `Menu` at the end of the toolbar or panel, and the
   right-click context menu. Put the less-frequent but still general tools here. A
   customisable toolbar's first page leads with the essentials, and the rest go on the
   pages after it (`PAGE` breaks, `src/lib/chromeLayout.ts`), a swipe or a dot away.
   Writers arrange the pages in Customize toolbar.
3. **In an inspector panel.** Deep, stateful tools a professional keeps open: history,
   references, print setup, script reports, map layers.
4. **Always: the command palette (⌘K).** Every action, searchable by name and by the
   words people use for it (`keywords`). This is how a beginner finds a pro tool and
   how a pro skips the menus.

```js
import { useCommands } from '../lib/commands'

useCommands(() => [{
  id: 'notes.add',                  // stable, dotted
  title: 'Add note',                // sentence case, verb first
  section: 'Notes',
  icon: 'note',
  keys: 'Mod+Alt+N',                // the default shortcut; writers can rebind it
  keywords: ['comment', 'annotate'],
  when: () => Boolean(selection),   // hide when it can't run
  run: addNote,
}], [addNote, selection])
```

**Placing a new feature:** start at level 4 (it must be in the palette), then choose
the *lowest* further level that serves the people who need it most. Promote to the
surface only with evidence that nearly everyone needs it. There are no modes to toggle,
no settings to reveal tools, and no hidden gestures without a visible alternative.

**Publishing terms** (recto, gutter, widow, imposition, slug line) are fine inside the
advanced tools that need them, each with a tooltip or hint in plain words. They never
appear on the surface.

---

## 11. Voice and copy

Plain and warm. Write like a knowledgeable friend in the studio.

- **Sentence case** for everything: buttons, menus, titles, tabs.
- **Verb first** for actions: "Add note", "Export as PDF…", "Restore this version".
- **Name things by what the writer recognises,** not by how the system is built:
  "Version history", not "Snapshots store".
- **An ellipsis** (…) when an action asks for more input before it acts.
- **Empty states** say what will appear and how to add the first one, in a calm tone:
  "No notes yet." then "Select some text and press ⌥⌘N to leave yourself a note."
- **Explain once, out of the way.** A control's words on the surface are its label and,
  at most, one short line of hint. Anything that needs explaining is a help topic
  (`src/lib/help.ts`): tag the control with `help="area.thing"` (`FormRow`, `Section`)
  or `data-help`, and a right-click on it offers "Help: …", which opens the Help sheet
  on that topic. Help is also in ⌘K. Tooltips name things; help explains them. A live
  status line (a count, a warning) is not an explanation and stays.
- **Errors** say what happened and what to do next, with no apology and no blame:
  "Couldn't save. Check that the project folder still exists, then try again."
- **Destructive confirmations** name the thing and the consequence: "Delete 'Chapter
  3'? It moves to the archive for 30 days."
- No exclamation marks, no jokes in errors, no "Oops".

| Don't | Do |
|---|---|
| Create Annotation | Add note |
| Pick a chill preset or dial in your own | Choose an accent colour |
| Error: ENOENT | Couldn't find that file. It may have been moved or renamed. |
| Are you sure? | Delete "Chapter 3"? |
| SUBMIT | Save |

---

## 12. Platforms

One design everywhere: the Tauri desktop app (macOS) and the iOS/iPadOS app render the
same bundle with the same tokens and components.

**The single exception is Liquid Glass on iOS/iPadOS**, applied only to floating chrome
over the page: the `.floating-capsule` surface that `FloatingToolbar`,
`FloatingActionButton` and `FloatingCapsule` wear. There it becomes translucent and
blurred (`var(--blur-over-page)`), with a specular rim (`--glass-*` tokens), so it sits
comfortably beside the system's own glass. `src/ui/platform.js` sets
`data-platform="ios"` on `<html>`, and the `.floating-capsule` rules in
`src/styles/base.css` do the rest. Everywhere else the capsule is opaque paper with the
float shadow.

A sidebar hovering over the document is veiled (slightly see-through tray over
`var(--blur-over-page)`) on every platform: that is the tray, not glass, and it carries
no rim. A note hovering over the page (its card opened from the dot in the text) is a
little see-through too, its 0.5px ring over a light `var(--blur-note)`, so the line it
is about stays in view; the strings between notes stop at their edges. The project
search card and its preview are veiled the same way as a hovering sidebar
(`--search-veil-bg` over `var(--blur-over-page)`, falling back to the opaque menu
surface under reduced transparency): a veil, not glass. The landing page's frosted
leaves are footage blurred by a filter under a sheet of paper (§6), not glass either. Don't extend glass to panels, menus, dialogs or scrims, and don't add
per-platform styling elsewhere. Touch targets are already comfortable (32px minimum;
FABs are 44px).

---

## 13. Accessibility

- **Contrast:** AA, as in §3. Never rely on colour alone.
- **Keyboard:** Every action is reachable by keyboard. Focus is always visible
  (`--focus-ring`). Menus, tabs, segmented controls and swatches use arrow keys.
  Dialogs focus their first control (never the ×), trap focus, make the app behind
  inert, and return focus on close. Popovers focus their first control, keep Tab inside
  and return focus to their opener; menus close on Tab. A roving group (swatches,
  segments) is one Tab stop.
- **Names:** Icon-only controls have `label`s. Decorative icons are `aria-hidden`.
- **Motion:** Honour `prefers-reduced-motion` (global in `base.css`).
- **Text:** Nothing important below `--text-xs` (11px). Don't disable zoom.

---

## 14. Guardrails

- **`npm run lint:design`** (in CI) flags raw colours (including those inside shadows
  and gradients), font families, px radii, px font sizes and px spacing outside
  `tokens.css` and `palette.ts`. Colours, fonts and radii are at zero findings; the
  older sizes and spacing are baselined per file in `scripts/design-baseline.json` and
  may only go down, so any new raw value fails. `--list` prints every finding.
- **Content is exempt, chrome is not.** A few files describe things the writer makes
  rather than the app's chrome, and keep their own literal values: exported and
  printed files (`src/print/export/`, the page model in `src/print/*.ts`), map worlds
  and map themes (`src/lib/map/`, `src/map/mapThemes.css`), the conversation tile's
  looks (`src/extensions/conversationStyles.ts`) and generated types (`src/types/`).
  The list lives in `IGNORED` in `scripts/lint-design.mjs`. Add to it only for content
  of that kind, never to get chrome past the check.
- **`tests/unit/css.mjs`** (in `npm test`) keeps surfaces flat: a gradient only where it
  does a job (listed by selector: `FadeScrim`, the canvas grid, the
  tray, …),
  every `backdrop-filter` is `var(--blur-over-page)` or `var(--blur-note)`, no OS colour-scheme media queries,
  and the radius scale is 4/8/12. **`tests/unit/icons.mjs`** checks that every icon
  name in `src/` is registered and keeps its one meaning (§8).
  **`tests/unit/help.mjs`** checks that every help topic a control points at exists,
  and that every Typeset and Print section has one.
- **`lint:design` also flags type and space off the scale:** a `font-size` (or `font`
  shorthand) in px, and a gap, padding or margin of 3px or more not built from
  `--space-*`. The legacy values are baselined per file in
  `scripts/design-baseline.json`; a file may only go down.
- **The showcase** (`?design` in dev) shows every token and component in both themes.
  Check your change there and in the real surface, in light *and* dark.
- **Review checklist for any UI change:**
  - [ ] Built from `src/ui` primitives and tokens; `lint:design` passes
  - [ ] Looks right in light and dark; AA contrast
  - [ ] Every new action is registered with `useCommands`
  - [ ] Placed at the right disclosure level (§10)
  - [ ] Copy follows §11
  - [ ] Keyboard reachable, visible focus, labelled icons
  - [ ] Any new pattern is added to `src/ui`, the showcase and this document

---

## 15. Migration

Every surface is on the design language: tokens, `src/ui` primitives, `Icon` with
semantic names, sentence-case copy and commands in the palette. In `base.css` a bare
`<button>` is a reset, not a styled control. What is left is older px sizes and
spacing (the baselined findings, §14) and about 190 bare buttons that style
themselves; [design-handoff.md](design-handoff.md) tracks both.

The conversation tile has a Brand / iMessage / Generic style switch, stored as the
node's `style` attribute. New tiles start in Brand; tiles saved before the switch read
as iMessage so they look as they did.

**When you touch older code:**

- Replace a one-off button, menu or dialog you meet with its `src/ui` component.
- Keep new values on tokens. `lint:design` fails on any new raw value, and a file's
  baseline only goes down (§14).
- Write new copy to §11 and register new actions with `useCommands`.

---

## 16. Changing the system

The design language changes deliberately, not incidentally. To add or change a token,
component or rule:

1. Change it in one place (`tokens.css`, `src/ui/`, `palette.ts`).
2. Show it in the showcase.
3. Update this document in the same PR.
4. Say in the PR description which rule changed and why.

A feature that needs something the system doesn't have extends the system. It doesn't
work around it locally.

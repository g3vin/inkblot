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
   `Card`, `EmptyState`, `InkPicker` and the others. Don't restyle a bare `<button>` or
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

The logo never takes Ink Blue, another ink or the accent. Ink Blue (`--brand-ink`) is
the interface's colour: the default accent, links, focus.

**In code.** Use `Mark`, `Wordmark` and `AppIcon` from `src/ui` (`Brand.jsx`). They
draw inline in `currentColor`, so they follow the surface. Standalone files are in
`src/assets/brand/` (`mark.svg`, `wordmark.svg`, `app-icon.svg`) and
`public/favicon.svg`.

**Clear space and size.** Keep clear space of at least the splash's width around the
mark (half the wordmark's height around the wordmark). The mark is legible from 16px
and the wordmark from 72px wide; below that, use the mark alone.

**Brand vs accent.** The logo is black and white. `--accent-color` is the writer's
choice: Ink Blue by default, or one of five other inks. It marks interactive states
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
| `blue` | Ink Blue | Default accent, brand |
| `teal` | Teal | |
| `green` | Green | Success |
| `amber` | Amber | Default note colour, warnings |
| `rust` | Rust | |
| `red` | Red | Danger |
| `violet` | Violet | |
| `slate` | Slate | Neutral category |

In code:

```js
import { inkColor, inkVar, INKS } from '../lib/palette'

// Store the id, never the hex. Draw with inkColor(), which also maps hex values
// saved by the older palettes to their ink.
note.color = 'teal'
style={{ '--card-color': inkColor(note.color) }}
```

`resolveInkHex()` returns the current literal hex, for the rare API that cannot take a
CSS variable (`<input type="color">`, a 2D canvas context).

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

Body text meets WCAG AA (4.5:1) against every surface it sits on, in both themes. That
includes the ink palette on `--app-bg` and `--on-ink` on every ink; the current values
all pass. Large display text and icons need 3:1. Re-check whenever you change a value
in `tokens.css`.

---

## 4. Themes

There are three choices: **Light** (paper), **Dark** (ink) and **System**.

`<html data-theme>` is **always** `light` or `dark`. "System" is resolved in JS
(`src/lib/theme.ts`) before first paint, and re-resolved when the OS changes. So:

- Write each theme's values **once**, in `tokens.css`, under
  `:root[data-theme='light']` / `[data-theme='dark']`.
- **Never** write `@media (prefers-color-scheme)` in a stylesheet.
- A component rarely needs theme-specific CSS, because the tokens already switch. If one
  does, scope it with `:root[data-theme='dark'] .thing { … }` and use tokens inside.
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
| `--text-2xl` | 26 | Display (`.ib-display`), landing |
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
  it is meant: it says where the chrome ends and the page begins. Text scrolls under
  it, clean against the rule: no fade or shadow below it. Its icon
  controls are bare on the paper: a fill only on hover, and the accent tint for a
  control that is on. Its menus (text style, font, size) carry the quiet control fill
  (`--control-bg`), so they read as menus rather than labels. It is a dense toolbar
  (§8): 16px icons on `--size-capsule` buttons. Every view's tools are this toolbar,
  one context each (`chromeLayout.ts`: document, canvas, map, timeline, Typeset), and
  the writer can customise each. A view never adds a second band of tools under the
  rule.
- **The fade scrim.** Other chrome that overlays the document (a bottom bar, the tab
  bar, the word count and page capsules at the foot of a pane) sits on a gradient from solid `--app-bg` to transparent, so text scrolling
  underneath dissolves instead of hitting a hard line. Use `FadeScrim`. Don't give that
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
  file tree, the chosen project on the landing page, the page showing in a `NavSheet`)
  is lifted out of its surface onto `--app-bg` with `--shadow-lift`, with no tint and no
  border. The accent marks focus and controls that are on, not where you are.
- **Layers.** Use `--z-chrome` < `--z-panel` < `--z-popover` < `--z-dialog` < `--z-toast`
  < `--z-tooltip`. Don't invent z-indexes.
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
the locked badge, the tab bar, the zoom bar) is `--size-circle`, level with the file
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

**Motion is subtle and quick.** Use `--dur-fast` (120ms) for hovers and small state
changes and menus, `--dur-base` (180ms) for popovers, panels and small dialogs, and
`--dur-slow` (240ms) for medium and large dialogs. Things arrive on `--ease-out`
(`--ease-standard` is the same curve). Dialogs, popovers and menus also leave the way they
came, quicker (`--dur-fast`) and easing in (`--ease-in`); `useExitAnimation` does this
without the caller keeping it mounted. There is no bounce or overshoot, and no looping
or attention-seeking animation. Motion explains where something came from and never
decorates. `prefers-reduced-motion` is honoured globally (`base.css`); framer-motion
components also check `useReducedMotion()`.

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
| `Popover` | Small forms and pickers anchored to a control, or to a place in the text | **The one pop-up shell.** `eyebrow`, `align`, `anchorRect`, `onEscape`. See *Pop-ups* below |
| `Dialog` | **The one modal**: a decision, a form, an editor, Settings | See *Dialogs* below |
| `NavSheet` | A large `Dialog` of pages with a list down its left: Settings and Help | Groups, an `aside` above the list (Help's filter), ↑/↓ between pages; the page showing is lifted |
| `Section` | A collapsible group in an inspector panel | Remembers open/closed per `id`. `accessory` is its one action, beside the title. `help` names its help topic |
| `FormRow` + `Toggle` / `Stepper` / `SelectMenu` | Inspector and settings rows | Label left (as wide as it needs, up to about half), control right; `stacked` for wide controls. `Toggle` applies immediately. `help` names its help topic |
| `PanelActions`, `ScopeMenu`, `MoreMenu` | A panel's scope and ⋯, in its header row | The panel anatomy (§6). `PanelActions` puts its children in the shell's header slot, only for the panel showing |
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
| `InkPicker` | **Every** colour choice | Notes, cards, accent (Settings → General). Don't build another swatch row |
| `FloatingCapsule` | A readout floating over the page (word count, zoom, tab bar) | The floating-capsule surface; glass on iOS. `--size-circle` tall, on `--z-chrome` (§7) |
| `FloatingToolbar`, `ToolbarSeparator` | Floating tool strips over the page (the table's tools) | Floating-capsule surface with toolbar keyboard behaviour; glass on iOS. `--size-toolbar` tall (§7). A view's own tools go in the card's toolbar (§6), not a strip |
| `FloatingActionButton` | One round primary action over the document | Glass on iOS |
| `usePointerReorder` | Drag-to-reorder lists (toolbar items, inspector layout) | |
| `CommandPalette` | Mounted once in `App` | Features register commands; they don't render this |

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
  strip of tools (») has none.
- **Insides:** `src/ui` controls (`Field`, `SelectMenu`, `TextArea`, `Button`, `FormRow` +
  `Toggle`, `Segmented`). A pop-up's one bespoke visual is its signature (read aloud's
  live waveform).
- **Motion:** a popover floats in over `--dur-base`, a menu over `--dur-fast`, and both
  leave the way they came (§7).
- **Focus:** a popover moves focus to its first control; Tab and ⇧Tab stay inside it;
  Escape or a click outside closes it, and focus goes back to the control that opened it.
  A menu focuses its first item, arrows move, and Tab closes it.
- **Inside a dialog,** a pop-up renders in the dialog's layer (`layer.js`), above it, and
  Escape closes the pop-up before the dialog.
- **Menus: native for a right-click, in the page for a button** (round 02b, 2026-10-21).
  A right-click gets the OS's menu; a menu a button opens is an in-page `Menu`. Both come
  from one description through `popUpMenu`, so a submenu in the list becomes a labelled
  group in the page.
- **The toolbar's »** is a labelled list: each item that didn't fit, its control and then
  its name, as every other "More" has words.
- **A pop-up opened from a pop-up opens inside it.** Read aloud in » turns » into read
  aloud: its button stays, pressed, the other items go, and » grows to hold it. Pressing
  the button again comes back; Escape or a click outside closes it all. `Popover` does this
  for any Popover opened inside another.

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
   customisable toolbar shows every item that fits and puts the rest behind », so its
   default set leads with the essentials. Writers who want a shorter surface place
   the `MORE` marker (`src/lib/chromeLayout.ts`) in Customize toolbar: items after it
   live behind » however wide the window is.
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
surface under reduced transparency): a veil, not glass. Don't extend glass to panels, menus, dialogs or scrims, and don't add
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
semantic names, sentence-case copy and commands in the palette. The legacy layer is
gone: the component aliases in `tokens.css`, the shared menu rule and bare-`<button>`
defaults in `base.css` (the bare button is now a reset), `SFIcon` and its name table,
and the `system_accent_color` command.

The conversation tile has a Brand / iMessage / Generic style switch, stored as the
node's `style` attribute. New tiles start in Brand; tiles saved before the switch read
as iMessage so they look as they did.

**When you touch older code:**

- Replace a one-off button, menu or dialog you meet with its `src/ui` component.
- Keep new values on tokens. `lint:design` holds the line at zero.
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

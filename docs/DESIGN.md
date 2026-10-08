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
   `Sheet`, `Dialog`, `Section` + `FormRow`/`Toggle`/`Stepper`/`SelectMenu`, `Panel`,
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
9. **Glass only on iOS/iPadOS, and only on floating chrome over the page** (the
   `.floating-capsule` surface: `FloatingToolbar`, `FloatingActionButton`,
   `FloatingCapsule`).
10. **Both themes, AA contrast, keyboard reachable, reduced motion honoured.** Every
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

**The mark.** A lowercase *i* whose dot is ink. The stem is in the page's ink colour and
the dot is in Ink Blue, so the mark works on paper and on ink unchanged. The three
concepts under review are in [`docs/brand/concepts/`](brand/concepts/). Once one is
chosen, it lives at `src/assets/brand/`, and this section records its clear space and
minimum size.

**The wordmark.** The mark stands in for the first letter, followed by "nkblot" in
Courier Prime Bold.

**Colour on backgrounds.**

| Background | Stem | Dot |
|---|---|---|
| Paper (light theme) | `--ink-0` | `--brand-ink` (Ink Blue, `#2F4A8A`) |
| Ink (dark theme) | `--ink-0` | `--brand-ink` (Ink Blue, `#8FA8E6`) |
| Ink Blue (app icon) | Paper | Paper |

**Brand vs accent.** `--brand-ink` is Inkblot's colour and never changes. `--accent-color`
is the writer's choice: Ink Blue by default, or one of five other inks. Brand moments
(the mark, the landing page, the wordmark) use `--brand-ink`. Interactive states
(selection, focus, primary buttons, the active tab) use `--accent-color`.

**Don't** recolour the mark in other inks, add effects (shadows, gradients, glass),
stretch it, or set the wordmark in any face other than Courier Prime.

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
tags, map layers and accent presets all draw from it. No feature invents its own set.

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
| **Inter** | `--font-ui` | All chrome: buttons, menus, panels, labels, dialogs |
| **Literata** | `--font-editor` | The writer's words: the editor, cards, previews, notes' quoted text. The default writing font; the writer can change it |
| **Courier Prime** | `--font-type` | Small typewritten accents only (see below) |
| Courier Prime | `--font-script` | Screenplay and stage-play pages (industry convention) |

All three are bundled (`src/styles/fonts.js`, SIL OFL) so every machine renders the same.

**Where Courier Prime goes**, and nowhere else:

- `.ib-eyebrow`: the small uppercase label above a group (panel titles, section heads,
  dialog kickers).
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

Weights are 400 (body), 500 (controls and labels) and 600 (titles). Use sentence case
everywhere; only eyebrows are uppercase.

Classes: `.ib-display`, `.ib-title`, `.ib-body`, `.ib-hint`, `.ib-eyebrow`, `.ib-meta`,
and `.ib-prose` (any element that shows the writer's text).

---

## 6. Layout: the document is the room

- **One seamless surface.** The editor background is `--app-bg` and fills the window.
  There is no separate "page" sheet in the writing view. Print Layout is the one place
  pages appear, because there the page *is* the subject.
- **Floating, hideable panels.** Side panels (file tree, inspector, notes, workbench,
  history) float over the document on `--surface-float`, with a hairline, `--radius-lg`
  and `--shadow-float`, inset `--space-3` from the window edge. Every panel can be hidden
  with a toggle and a shortcut, and hidden panels leave the document full width. Use
  `Panel` / `PanelHeader` / `PanelBody`.
- **The fade scrim.** Chrome that overlays the document (the toolbar, a bottom bar)
  sits on a gradient from solid `--app-bg` to transparent, so text scrolling underneath
  dissolves instead of hitting a hard line. Use `FadeScrim` (or the existing
  `.app-titlebar::before`, which is the same recipe). Don't give chrome over the
  document a solid bar or a border.
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

**Radius is soft:**

| Token | px | For |
|---|---|---|
| `--radius-xs`, `--radius-sm` | 4 | Inputs, selects, chips, small controls, menu items |
| `--radius-md` | 8 | Buttons, segmented controls, steppers, cards, rows |
| `--radius-lg`, `--radius-card` | 12 | Floating panels and capsules, popovers, menus, dialogs, sheets |
| `--radius-pill` | 999 | Tags and toggles **only** (and round icon buttons) |

**Depth.** Only floating things cast shadows: panels, menus, popovers and floating
toolbars use `--shadow-float`, and dialogs use `--shadow-dialog`. Everything inside a
surface is separated by hairlines and tonal shifts, never by shadow.

**Motion is subtle and quick.** Use `--dur-fast` (120ms) for hovers and small state
changes, `--dur-base` (180ms) for popovers, dialogs and panels, and `--dur-slow` (240ms)
for sheets. The easing is `--ease-out` (`--ease-standard` is the same curve). There is no bounce or overshoot, and no looping
or attention-seeking animation. Motion explains where something came from and never
decorates. `prefers-reduced-motion` is honoured globally (`base.css`); framer-motion
components also check `useReducedMotion()`.

---

## 8. Iconography

- **Phosphor** (MIT), through `src/ui/Icon.jsx`: `<Icon name="note" />`.
- **Weight:** Light at rest, Fill for an active or selected state (`active`).
  `IconButton` does this for you.
- **Size:** 16px inline, in menus and in dense toolbars; 20px in primary toolbars,
  empty states and FABs. Nothing else.
- **Colour:** `currentColor`, usually `--text-muted` at rest and `--text-primary` on
  hover.
- **Names mean something.** Register icons by meaning in `src/ui/icons.js` (`history`,
  not `clock-counter-clockwise`), so a glyph can change in one place. Add a name only
  when no existing meaning fits.
- Every icon-only control has a label, which becomes its tooltip. Icons don't animate.

---

## 9. Components

Everything below is exported from `src/ui` (`import { Button, Menu } from '../ui'`).

| Component | Use it for | Notes |
|---|---|---|
| `Button` | Any text action | `variant`: `filled` (the one primary action per view), `tinted` (a normal action that needs weight), `plain` (default: quiet actions in chrome and rows), `destructive` (confirm or offer undo). `size`: `capsule` (default), `circle`, `toolbar` |
| `IconButton` | Icon-only actions | `label` is required and becomes the tooltip and accessible name. Glyph from `icon` (semantic name, preferred) or `symbol` (SF-style name). `display` shows the label under or instead of the icon in customisable toolbars. `filled` + `aria-pressed` for toggles |
| `Tooltip` | Naming a control in a richer way than `title` | Short, no period, after a 500ms delay, with an optional shortcut. Never holds anything a user must read to succeed |
| `Kbd` | Showing a shortcut | Courier Prime |
| `Menu`, `MenuItem`, `MenuLabel`, `MenuSeparator` | In-page lists of actions, "More" overflow menus | Arrow keys, typeahead and Escape built in. `danger` items go last, after a separator |
| `useNativeMenu`, `popUpNativeMenu` | Context menus and menus a native window menu would show | The OS menu, built from the same items |
| `Popover` | Small forms and pickers anchored to a control | Same surface as a menu. `align` start/end |
| `Dialog` | A decision, or a small setting | Eyebrow + title + description, then the body, then the footer (secondary left, primary right) |
| `Sheet` | Larger settings and editors (Settings, Customize Toolbar, page setup) | Centred, or dropped from under the titlebar with `placement="top"` |
| `Section` | A collapsible group in an inspector panel | Remembers open/closed per `id` |
| `FormRow` + `Toggle` / `Stepper` / `SelectMenu` | Inspector and settings rows | Label left, control right; `stacked` for wide controls. `Toggle` applies immediately |
| `Field` + `Input` / `TextArea`, `Checkbox` | Forms in dialogs | Label above, hint below. Errors say how to fix |
| `Segmented` | 2–4 exclusive, short options | Otherwise use `SelectMenu` |
| `Tabs` | Views within a panel | Underline style |
| `Panel`, `PanelHeader`, `PanelBody` | Floating side panels | Header title is an eyebrow |
| `FadeScrim` | Chrome over the document | See §6 |
| `Card` | A bordered block in a panel | `ink` applies the card recipe |
| `Tag` | Small categorical labels | Takes an ink |
| `EmptyState` | Any list or panel with nothing in it | Typewritten line, plain hint, at most one action |
| `InkPicker` | **Every** colour choice | Notes, cards, accent (Settings → General). Don't build another swatch row |
| `FloatingCapsule` | A readout floating over the page (word count, zoom, tab bar) | The floating-capsule surface; glass on iOS |
| `FloatingToolbar`, `ToolbarSeparator` | Floating tool strips (formatting, canvas, map) | Floating-capsule surface with toolbar keyboard behaviour; glass on iOS |
| `FloatingActionButton` | One round primary action over the document | Glass on iOS |
| `usePointerReorder` | Drag-to-reorder lists (toolbar items, inspector layout) | |
| `CommandPalette` | Mounted once in `App` | Features register commands; they don't render this |

Behaviour hooks (`src/ui/hooks.js`) are `useDismiss`, `useFocusTrap`, `useRovingFocus`
and `useAnchoredPosition` (`placePopover.js` is the placement maths `Popover` uses). Use them when building anything floating or list-like
instead of re-implementing focus handling.

**If a component doesn't exist yet,** build it in `src/ui/` from tokens, add it to the
showcase (`src/dev/DesignShowcase.jsx`) and to this table, in the same PR.

---

## 10. Progressive disclosure

How Inkblot is both beginner-simple and pro-deep. Each capability lives at exactly one
of these levels, and is always also in the command palette:

1. **On the surface.** Only what almost every writer needs almost every session: bold,
   italic, headings, lists, add note, undo. The default toolbar stays short.
2. **One click away.** A "More" `Menu` at the end of the toolbar or panel, and the
   right-click context menu. Put the less-frequent but still general tools here.
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
  shortcut: '⌥⌘N',                  // displayed; bind it where it already lives
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

Don't extend glass to panels, menus, dialogs, sheets or scrims, and don't add
per-platform styling elsewhere. Touch targets are already comfortable (32px minimum;
FABs are 44px).

---

## 13. Accessibility

- **Contrast:** AA, as in §3. Never rely on colour alone.
- **Keyboard:** Every action is reachable by keyboard. Focus is always visible
  (`--focus-ring`). Menus, tabs, segmented controls and swatches use arrow keys.
  Dialogs trap focus and return it on close.
- **Names:** Icon-only controls have `label`s. Decorative icons are `aria-hidden`.
- **Motion:** Honour `prefers-reduced-motion` (global in `base.css`).
- **Text:** Nothing important below `--text-xs` (11px). Don't disable zoom.

---

## 14. Guardrails

- **`npm run lint:design`** (in CI) flags raw colours (including those inside shadows
  and gradients), font families and px radii outside `tokens.css` and `palette.ts`. The code base predates the design
  language, so existing findings are baselined per file in
  `scripts/design-baseline.json`. A file may never gain findings, and a new file starts
  at zero. When you migrate a surface, run
  `npm run lint:design -- --update-baseline` to lock in the lower count. `--list` prints
  every finding.
- **`tests/unit/css.mjs`** (in `npm test`) keeps surfaces flat: a gradient only where it
  does a job (listed by selector: the titlebar fade, `FadeScrim`, the canvas grid, …),
  every `backdrop-filter` is `var(--blur-over-page)`, no OS colour-scheme media queries,
  and the radius scale is 4/8/12. **`tests/unit/icons.mjs`** checks that every SF-style
  icon name in `src/` resolves to a registered icon.
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

The foundation is in place: tokens, fonts, icons, palette, primitives and the command
palette. Existing surfaces are moved onto it one PR at a time, in this order:

1. App shell: titlebar and the customisable toolbars (`components/toolbar/`), tab bar
   (`components/tabs/`), left sidebar, file tree and Book navigator (`components/tree/`,
   `components/book/`), the project picker / welcome window
2. Editor: the default toolbar set reduced to essentials, with the rest behind the
   toolbar's » overflow; context menus
3. Inspector: workbench tiles, history, clipboard, archive, search, references, map,
   Typeset and Print & Export panels (`components/RightSidebar/`)
4. Settings and stats (`components/settings/`, `components/stats/`), notes and the
   bubble editor (`components/bubble/`)
5. Canvas
6. Map
7. Print Layout and page setup
8. Script
9. Extensions: conversation tile (with its Brand / iMessage / Generic style switch),
   citations, image tools

**Migrating a surface:**

- Replace ad-hoc buttons, menus and dialogs with `src/ui` components.
- Replace literals with tokens, and replace `SFIcon` with `Icon` and semantic names.
- Rewrite copy to §11.
- Register the surface's actions with `useCommands`.
- Lower its `lint:design` baseline.

**Legacy to remove as surfaces migrate:**

- The component aliases at the bottom of `tokens.css` (`--landing-*`, `--sidebar-*`,
  `--focus-mode-*`, `--floating-note-*`, `--tile-color`, `--color-white/black`).
- `src/components/SFIcon.jsx` and `src/components/sfIconNames.js`, the SF-name alias
  onto `Icon` (also behind `IconButton`'s `symbol` prop).
- The shared legacy menu rule at the bottom of `base.css`.
- The bare-`<button>` defaults in `base.css`.

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

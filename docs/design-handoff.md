# Design language — handoff

Where the Quiet Studio design language stands, and what to do next. Read
[DESIGN.md](DESIGN.md) first: it holds the rules. This file holds the state of the
work. Update it as you go, and delete each item when it's done.

_Last updated: 2026-10-08, with PR g3vin/inkblot#63 (design language + logo)._

---

## Done

**Foundation** (PR g3vin/inkblot#63)

- **Tokens:** `src/styles/tokens.css` is the single source of design values.
  - Warm paper (light) and ink (dark) neutrals.
  - Ink Blue brand colour.
  - The eight-ink palette.
  - Type, space, radius (4/8/12), motion (120/180ms), shadow and glass scales.
  - The names `main` already used (`--space-*`, `--radius-xs/card`, `--size-*`,
    `--hover-bg`, `--shadow-1..3`, `--font-serif/mono`, …) are kept and carry the Quiet
    Studio values.
- **Themes:** `data-theme` is always resolved (`src/lib/theme.ts`). The accent is
  `data-accent`, an ink id (`setAccentAttribute`).
- **Fonts:** Inter (UI), Literata (default writing font), Courier Prime (typewritten
  accents and screenplays). All bundled through `src/styles/fonts.js`.
- **Icons:** Phosphor, Light at rest and Fill when active, registered by meaning in
  `src/ui/icons.js`.
  - The old animated and static icon sets are deleted.
  - `SFIcon` and `IconButton`'s `symbol` go through `src/components/sfIconNames.js`.
  - `tests/unit/icons.mjs` checks every SF name in `src/` resolves.
- **Palette:** `src/lib/palette.ts` is used by notes, canvas presets, parts of speech
  and accent presets.
  - Old saved hex colours draw as their nearest ink; no data is rewritten.
  - The card recipe is declared on each card element (see Gotchas).
- **Components:** `src/ui` holds `main`'s controls, restyled, plus mine.
  - From `main`: Button, IconButton, Segmented, Sheet, Popover, Section,
    FormRow/Toggle/Stepper/SelectMenu, FloatingCapsule, useNativeMenu,
    usePointerReorder.
  - Mine: Icon, Tooltip, Kbd, Menu, Dialog, Field/Input/TextArea/Checkbox, Panel,
    FadeScrim, Card, Tag, EmptyState, Tabs, FloatingToolbar, FloatingActionButton,
    InkPicker, CommandPalette.
- **Command palette:** ⌘K, with app-level commands registered in `App.jsx`.
- **Accent:** the Settings sheet's accent swatches are an `InkPicker` over six inks. The
  OS-accent follow and the custom colour wheel are removed.
- **Guardrails:**
  - `npm run lint:design` (in CI) is a per-file ratchet against
    `scripts/design-baseline.json`.
  - `tests/unit/css.mjs` checks the gradient allowlist, the single blur token and the
    radius scale.
- **Docs:** `docs/DESIGN.md`; `CLAUDE.md` tells agents to follow it.
- **Showcase:** `npm run dev`, then `/?design`.

---

## The logo (done)

The user chose **B3 "Spray"**: a lowercase *i* whose dot is an ink spray, black on white.

- **Generator:** `docs/brand/generator/` rebuilds it. `splash.py` models the ink impact:
  impact-angle ellipse, rim fingering, downstream bias and droplets that pinch off.
  `generate.py` writes `src/ui/brandPaths.js`, `src/assets/brand/*.svg` and
  `public/favicon.svg`.
- **Wordmark:** it uses the mark's own *i* (the user asked that the logos match),
  sized to Courier Prime Bold's x-height, with the font's letter spacing rather than
  its monospace cell.
- **App icon:** the stem is on the centre line, and the ink is optically centred.
- **Desktop and iOS icons:** `src-tauri/icons/` was regenerated with `npx tauri icon`
  from `src-tauri/icons/source/`.
  - `icon-macos-1024.png`: a Big Sur–style inset tile, transparent around it.
  - `icon-ios-1024.png`: full-bleed and opaque. The iOS set comes from this one.
- **Regenerating after a change:**
  1. Run `generate.py`.
  2. Rasterise `app-icon.svg` into the two 1024px sources (a headless browser
     screenshot at 1024×1024; the macOS one inset 100px, with corners at 0.225 of the
     tile).
  3. Run `npx tauri icon` on each and copy `ios/` from the iOS run.
- **Remaining:** check the icons on a real Mac and iPhone. The Android launcher icons
  came from the macOS source (an inset tile), so revisit them if Android ships.

---

## Next: migrate surfaces (one PR each)

The order is in DESIGN.md §15. For each surface:

- Replace ad-hoc buttons, menus and dialogs with `src/ui`.
- Replace literals with tokens.
- Replace `SFIcon`/`symbol` with `Icon`/`icon`.
- Rewrite copy to DESIGN.md §11.
- Register its actions with `useCommands`.
- Run `npm run lint:design -- --update-baseline` to lock in the lower count.

Where the raw values are (`npm run lint:design -- --list` shows each one; 492 findings
in total at the merge):

| File | Findings |
|---|---|
| `src/print/PrintLayout.css` | 146 (much of it is the printed page's own colours: decide what is chrome and what is content) |
| `src/map/Map.css` | 57 |
| `src/extensions/ConversationTile.css` | 37 |
| `src/components/Toolbar.css` | 29 |
| `src/components/Notes.css` | 25 |
| `src/print/PageSetupSheet.css` | 20 |
| `src/canvas/Canvas.css` | 15 |
| `src/components/FileTree.css` | 14 |
| `src/components/RightSidebar/SidebarSearch.css` | 13 |
| `src/lib/map/systemPresets.js`, `terrains.js` | 23 together (map style presets: decide whether they are content, and exempt like print, or chrome) |

**Specific items still open:**

- **Default toolbar set.** It should hold only the essentials (bold, italic, headings,
  lists, add note, undo); everything else goes behind the » overflow. The toolbar
  registry is in `src/components/toolbar/registry.jsx` and the defaults in the chrome
  layout model. Check the existing layout migrations in `tests/unit/chromeLayout.mjs`
  before changing the defaults.
- **Conversation (chat) tile.** Add a per-tile style switch: Brand (default: ink blue
  and paper bubbles) / iMessage / Generic. Store it as a node attribute in
  `src/extensions/`.
- **Commands.** Register the surface commands in the ⌘K palette as each surface
  migrates: new document/canvas/map, add note, focus mode, split view, show/hide
  sidebar and inspector, find, version history, typeset, dictation, read aloud. Only
  App-level ones exist now.
- **Pills.** Main's pill-shaped controls outside `src/ui` (e.g. the welcome window's
  Open… / New Project buttons, the tab bar) still use `--radius-pill`. Under the 4/8/12
  rule, pills are for tags and toggles only. Move them to `--radius-md`/`--radius-lg` as
  each surface migrates.
- **Note hover cards and inline previews.** Check they wear the card recipe (ink wash)
  rather than the old accent tint.

---

## Retire when unused

- The legacy aliases at the bottom of `src/styles/tokens.css`: `--landing-*`,
  `--sidebar-*`, `--focus-mode-*`, `--floating-note-*`, `--tile-color`,
  `--color-white/black`.
- `src/components/SFIcon.jsx` + `sfIconNames.js`, and `IconButton`'s `symbol` prop.
- The legacy shared-menu rule and the bare-`<button>` defaults in
  `src/styles/base.css`.
- The `system_accent_color` Tauri command (`src-tauri`). Nothing calls it any more.

---

## Gotchas

- **Card colours.** A custom property's `var()`s resolve where it is *declared*. The
  card recipe (`--card-tint/--card-edge`) is therefore declared on each card selector,
  listed in `tokens.css`. A new kind of card that sets `--card-color` must join that
  list, or it is washed in the accent colour.
- **Blur.** Only `var(--blur-over-page)` may be used in `backdrop-filter`, and only on
  iOS (`:root[data-platform='ios'] .floating-capsule`). `tests/unit/css.mjs` fails on
  anything else.
- **Gradients.** These are allowed only for the selectors in `FUNCTIONAL_GRADIENTS` in
  `tests/unit/css.mjs`: the titlebar fade, `.ib-fade-scrim`, the canvas grid, and so on.
- **Colour schemes.** Never write `prefers-color-scheme` in CSS, comments included,
  because the CSS test reads raw text. Use `[data-theme]`.
- **Text on accent.** In dark mode the accent is light, so text on an accent fill uses
  `--text-on-accent` (and on an ink fill, `--on-ink`). Never use `--color-white`.
- **Spacing names.** `main`'s spacing names step 4/6/8/12/16/24, so `--space-2` is 6px,
  not 8px.
- **Print and e-book colours** (`src/print/*.ts`) are content, so `lint:design` skips
  them.

---

## Checking your work

```bash
npm run lint && npm run lint:design && npm run typecheck && npm test && npm run build
```

To look at the real app headlessly (welcome window → editor, or the showcase):

```bash
npm i --no-save playwright-core
npm run dev &
CHROMIUM=/path/to/chromium node scripts/dev/screenshot.mjs /tmp/shot dark
node scripts/dev/screenshot.mjs /tmp/shot light --design
```

The page runs against `scripts/dev/tauri-mock.js`, a fake projects folder, so no
desktop shell is needed. In Claude Code's cloud containers, Chromium is at
`/opt/pw-browsers/chromium-*/chrome-linux/chrome`. Check both themes and confirm three
things: text still dissolves under the titlebar, the side panels float and hide, and
the editor is set in Literata.

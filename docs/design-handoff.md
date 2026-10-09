# Design language — handoff

Where the Quiet Studio design language stands, and what to do next. Read
[DESIGN.md](DESIGN.md) first: it holds the rules. This file holds the state of the
work. Update it as you go, and delete each item when it's done.

_Last updated: 2026-10-08, after the surface migration on `refactor/design-migration`._

---

## Done

**Foundation** (PR g3vin/inkblot#63)

- **Tokens:** `src/styles/tokens.css` is the single source of design values: warm
  paper and ink neutrals, Ink Blue, the eight-ink palette, and the type, space, radius
  (4/8/12), motion, shadow and glass scales.
- **Themes:** `data-theme` is always resolved (`src/lib/theme.ts`). The accent is
  `data-accent`, an ink id.
- **Fonts:** Inter (UI), Literata (writing), Courier Prime (typewritten accents and
  screenplays), bundled through `src/styles/fonts.js`.
- **Components, command palette, showcase, docs:** `src/ui`, ⌘K, `/?design`,
  `docs/DESIGN.md`.

**Surface migration** (`refactor/design-migration`)

- **Every surface is migrated:** shell, editor, inspector, settings and stats, notes
  and bubble editor, canvas, map, Typeset and page setup, script, extensions.
  - Pop-ups are `Menu`, `Popover` and `Sheet`; colour pickers are `InkPicker`.
  - Switches are `FormRow` + `Toggle`.
  - Icons are `Icon` with semantic names; node views use `iconElement()`.
- **Raw values:** `lint:design` is at zero findings and the baseline is empty.
  Content (exports, the printed page, map worlds and themes, conversation looks) is
  exempt by path. See DESIGN.md §14.
- **Toolbar:** the default document toolbar holds the essentials. A `MORE` marker in
  the layout sends the rest behind », and writers can move it in Customize toolbar.
- **Conversation tile:** a Brand / iMessage / Generic style switch, stored as the
  node's `style` attribute. Older tiles read as iMessage.
- **Commands:** new document, canvas and map; add note (⌥⌘N); focus mode; sidebar and
  inspector; split right, split down and close split; version history; typeset; project
  search (⇧⌘F); dictation; read aloud. All are in ⌘K.
- **Copy:** labels, menus (the native menu bar too), titles and empty states are in
  sentence case. Names keep their capitals.
- **Shapes and cards:** pill radii are left only on tags, toggles and round controls.
  Note hover cards and dot previews wear the card recipe.
- **Retired:** the legacy token aliases, the shared menu rule, the bare-`<button>`
  defaults (the bare button is now a reset), `SFIcon` and `sfIconNames.js`,
  `IconButton`'s `symbol` prop, and the `system_accent_color` Tauri command.

## The logo (done)

The user chose the **"ib" monogram** in a brand review held in October 2026. It
replaces the earlier *i*-plus-spray mark, which read as the "info" glyph at small
sizes. It's "ib" in Literata ExtraBold, with the *i*'s dot replaced by an ink splash,
black on white.

- **Generator:** `docs/brand/generator/` rebuilds it. `splash.py` models the ink impact:
  impact-angle ellipse, rim fingering, downstream bias and droplets that pinch off.
  `generate.py` sets the letters from the font outlines and swaps each *i*'s dot for
  the splash. It writes `src/ui/brandPaths.js`, `src/assets/brand/*.svg` and
  `public/favicon.svg`. Its settings (`MARK`, `WORDMARK_DOT`, `ICON_SIZE`,
  `ICON_CENTRE`) are the decisions from the review, so change them only on purpose.
- **Settings the user picked:**
  - The splash is large and sits close to the stem (`dot_width` 360, `dot_gap` 40).
  - The monogram keeps its tight *i*–*b* spacing (`kern` −40). The splash moves left
    (`dot_dx` −45) to clear the *b*, because widening the spacing loosened the
    monogram.
  - The mark fills 41 of the 64-unit tile.
- **Wordmark:** "inkblot" in Courier Prime Bold with the same splash for its dot
  (`dot_width` 330, `dot_gap` 55). The splash adds height, so `Wordmark` call sites
  use about 1.3× their old `height` to keep the letters the same size.
- **App icon:** optically centred. The point halfway between the ink's box centre and
  its centre of weight sits at (32, 31.6), because the heavy letters sit low and the
  splash high.
- **Desktop and iOS icons:** `src-tauri/icons/` was regenerated with `npx tauri icon`
  from `src-tauri/icons/source/`.
  - `icon-macos-1024.png`: a Big Sur–style inset tile, transparent around it.
  - `icon-ios-1024.png`: full-bleed and opaque. The iOS set comes from this one.
- **Regenerating after a change:**
  1. Run `generate.py`.
  2. Rasterise `app-icon.svg` into the two 1024px sources. The macOS one is inset
     100px with corners at 0.225 of the tile; the iOS one is full-bleed and opaque.
     Use `rsvg-convert` (librsvg) or a headless browser screenshot.
  3. Run `npx tauri icon` on each and copy `ios/` from the iOS run.
- **Remaining:** check the icons on a real Mac and iPhone. The Android launcher icons
  came from the macOS source (an inset tile), so revisit them if Android ships.

---

## Remaining

- **Logo on devices.** Check the icons on a real Mac and iPhone (see "The logo" above).
- **Bare buttons.** About 250 bare `<button>`s style themselves in their component's
  stylesheet. That works, because the base rule is a reset, but move them onto
  `Button` / `IconButton` when you're in that code anyway.

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
- **Content colours** (exports, the printed page, map worlds and themes, conversation
  looks) are content, so `lint:design` skips those paths (`IGNORED` in
  `scripts/lint-design.mjs`). Chrome never goes on that list.
- **Toolbar layout ids are storage keys.** A layout saved before an item existed gets it
  through `normalizeToolbar` (`src/lib/chromeLayout.ts`); check the migrations in
  `tests/unit/chromeLayout.mjs` before changing a default.

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

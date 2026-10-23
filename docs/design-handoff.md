# Design language — handoff

What is left of the Quiet Studio design work, and the traps in it. Read
[DESIGN.md](DESIGN.md) first: it holds the rules. Delete each item here when it's
done; the history is in git and [CHANGELOG.md](../CHANGELOG.md).

## Remaining

- **Logo on devices.** Check the icons on a real Mac and iPhone. The Android launcher
  icons came from the macOS source (an inset tile), so revisit them if Android ships.
- **Traffic lights on a real Mac.** Check they appear in place at launch, line up with
  the project name, hide with the sidebar, show on the hovering sidebar, and hold
  after a resize and fullscreen (`lib/trafficLights.js`,
  `src-tauri/src/window_chrome.rs`).
- **Other settings panes.** Writing, Goals, Timers and Reminders still carry
  paragraph hints (`.settings-footer`); move them into help topics (`src/lib/help.ts`).
- **Off-scale sizes and spacing.** 736 baselined findings (`npm run lint:design --
  --list`); lower them as you touch each file, then `--update-baseline`.
- **Bare buttons.** About 190 bare `<button>`s style themselves in their component's
  stylesheet. Move them onto `Button` / `IconButton` when you're in that code anyway.

## Regenerating the logo

The design is in DESIGN.md §2. `docs/brand/generator/` builds it: `splash.py` models
the ink impact, and `generate.py` sets the letters from the font outlines, swaps each
*i*'s dot for the splash, and writes `src/ui/brandPaths.js`, `src/assets/brand/*.svg`
and `public/favicon.svg`.

Its settings are decisions from the brand review, so change them only on purpose:

- `MARK`: the splash is large and close to the stem (`dot_width` 360, `dot_gap` 40).
  The monogram keeps its tight *i*–*b* spacing (`kern` −40), and the splash moves left
  (`dot_dx` −45) to clear the *b*; widening the spacing loosened the monogram.
- `WORDMARK_DOT`: `dot_width` 330, `dot_gap` 55. The splash adds height, so a
  `Wordmark` is sized about 1.3× the height its letters alone would need.
- `ICON_SIZE`, `ICON_CENTRE`: the mark fills 41 of the 64-unit tile, and the point
  halfway between the ink's box centre and its centre of weight sits at (32, 31.6).

After a change:

1. Run `generate.py`.
2. Rasterise `app-icon.svg` into the two 1024px sources in `src-tauri/icons/source/`:
   `icon-macos-1024.png`, inset 100px with corners at 0.225 of the tile and
   transparent around it, and `icon-ios-1024.png`, full-bleed and opaque. Use
   `rsvg-convert` (librsvg) or a headless browser screenshot.
3. Run `npx tauri icon` on each, and copy `ios/` from the iOS run.

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
- **A button's menu is in the page now, so a test can click it** (`.ib-menu`), but a
  right-click's is still the OS's: in the mock it's recorded in `window.__ibMenus`, and in
  a plain browser it does nothing.
- **A closing dialog, popover or menu leaves a copy behind for `--dur-fast`.**
  `useExitAnimation` clones it to play the exit; the copy has no `role` or ids, is inert,
  has `.is-leaving` and goes in about 120ms. Query by role, or by
  `.ib-popover:not(.is-leaving)`, if it matters whether it's still open. There is no copy
  under reduced motion; tests that stub `matchMedia` get one.
- **A pop-up opened from inside a dialog renders in the dialog's layer.** `Dialog`
  provides its scrim through `LayerContext` (`src/ui/layer.js`); `Popover` and `Menu`
  portal into it, so they sit above the dialog (`--z-popover` is under `--z-dialog`) and
  aren't inert. Dialog's Escape ignores keys from inside a pop-up, so the pop-up closes
  first. A pop-up portaled some other way would sit under the dialog.
- **A panel's header controls are a portal.** `PanelActions` renders into the
  inspector's title row only for the panel showing; outside a `PanelActionsProvider`
  (tests, the showcase) it renders in place.
- **ESLint does not catch an undefined JSX component** (no `react/jsx-no-undef`). A
  missing import is a runtime error: look at the page, or run the audit script.
- **Toolbar layout ids are storage keys.** A layout saved before an item existed gets it
  through `normalizeToolbar` (`src/lib/chromeLayout.ts`); check the migrations in
  `tests/unit/chromeLayout.mjs` before changing a default.
- **Help topics.** A control tagged `help` / `data-help` gets "Help: …" on right-click,
  from `src/lib/help.ts`. `tests/unit/help.mjs` fails on a topic that doesn't exist.
- **Icons.** `tests/unit/icons.mjs` fails on a registered name nothing uses, as well
  as on an unregistered one.
- **The `fs` scope.** `**` does not match dotfiles on macOS, so the capability names
  Inkblot's own: `**/.inkblot-*`, `**/.assets/**`, `**/.versions/**`. Other dotfiles
  (`~/.ssh`, `~/.config`, …) stay out of reach. Add a pattern if the app starts writing
  a new dot-name.
- **A view's toolbar state goes over the bridge.** Toolbar items read only what the
  page publishes (`toolbarContext.js`), never the view's React state. Publish only on a
  change: a canvas, map or timeline re-renders on every frame of a pan.

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
node scripts/dev/audit.mjs /tmp/audit dark      # every surface and inspector tab
```

For the design review (`docs/design-review/`), `capture.mjs` shoots every surface in
`design-review/surfaces.json` in both themes at desktop and iPad sizes, and
`compare.mjs` pixel-diffs two runs:

```bash
npm i --no-save playwright-core pixelmatch pngjs
node scripts/dev/capture.mjs --run head              # → design-review/out/head/
node scripts/dev/compare.mjs control head            # what changed, and by how much
node scripts/dev/measure.mjs --run head              # computed styles and behaviour of overlays
```

The page runs against `scripts/dev/tauri-mock.js`, an in-memory projects folder (writes
land in it, so new canvases, maps and timelines work), so no desktop shell is needed.
Native menus can't be drawn in a browser: the mock records each one's items, and
`window.__ibMenuClick('Rename')` runs one. In Claude Code's cloud containers, Chromium is at
`/opt/pw-browsers/chromium-*/chrome-linux/chrome`. Check both themes and confirm three
things: text still dissolves under the card's toolbar rule, the sidebars dock on the
tray and hover over the card when unpinned, and
the editor is set in Literata.

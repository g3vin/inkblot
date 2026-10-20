# Design review — state

Where the design review loop stands. The loop is how DESIGN.md changes deliberately
(DESIGN.md §16): audit a pattern family, prototype options behind a dev-only variant
switch, the design lead picks, then one implementation replaces the rest. Picks are
logged in [decisions.md](decisions.md); the audit is [audit.md](audit.md).

## The control

| | |
| --- | --- |
| **Control sha** | `e34d3dd` (head of `feat/maps-3d`) |
| **Captured** | 2026-10-20 |
| **Surfaces** | 89 in [`design-review/surfaces.json`](../../design-review/surfaces.json) |
| **Screenshots** | 348 (light and dark × desktop 1400×900 and iPad 820×1180), 0 failed |
| **Native menus** | 9, saved as JSON item lists |
| **Measurements** | `measure.json`: 27 overlays, 41 element probes |
| **Tooling** | `design/review-setup`: `scripts/dev/capture.mjs`, `measure.mjs`, `compare.mjs`, `surfaces.mjs`, `tauri-mock.js` |

The control is `feat/maps-3d` rather than `main`. `origin/main` (`abcd3e9`) is 40
commits behind it, missing the docked panels on the card, Inlay, the sidebar and
inspector rework, the toolbar's More, and 3D maps. Reviewing it would have audited a UI
that is already gone. The design lead chose this on 2026-10-20. Once `feat/maps-3d` is
merged, its merge sha becomes the control: recapture, run
`compare.mjs control <new> --strict` (it should be identical), and update this table.

Screenshots and measurements aren't committed (`design-review/out/` is ignored).
Rebuild them from the sha:

```bash
git checkout e34d3dd -- src            # or a worktree at the control sha
npm i --no-save playwright-core pixelmatch pngjs
npm run dev &
node scripts/dev/capture.mjs --run control
node scripts/dev/measure.mjs --run control
```

A run fixes the clock, seeds `Math.random` (maps draw their stars and galaxies from
it), asks for reduced motion, hides the caret and blocks off-site requests. Every
surface × theme × viewport starts from a fresh page. Two captures of the map, canvas and
Book surfaces came out identical except for 12 pixels of WebGL antialiasing on the Earth
globe, which is why `compare.mjs` has a `--noise` floor (0.005% by default).

## Coverage

Everything in `surfaces.json`, by the family it's filed under (the audit regroups
them):

- **modal** (18): New project, Customize toolbar, Customize inspector layout, Rename a
  Book part, Folder types, Page setup, Author details, the eight Settings panes, Help
  (and Help filtered to nothing) and Export map.
- **editor** (14): text, scrolled, a selection, a new document, a new tab, split, focus
  mode, page view, both sidebars hidden, screenplay, locked, conversation tile, bubble
  paragraph, and renaming in the tree.
- **menu** (12): three in-page `Menu`s are screenshotted (More table tools, More typeset
  options, Work on). The nine native ones are saved as JSON: New project options, the
  project, document, editor, toolbar and inspector-header right-click menus, New…,
  Alignment and Typeset Insert.
- **panel** (10): Files, Book, the inspector tabs (Clipboard, Notes, Timeline,
  References, History, Stats), History in the Typeset layout, and References opened by
  Insert citation. The Workbench is the default tab, so it shows in the editor shots.
- **popover** (9): More toolbar items, Table cell fill, Read aloud options, the sidebar
  search, project search, the footnote editor, Print options, Go to page and the canvas
  card colour.
- **map** (6): the setup chooser, a blank sheet, the Earth, a planet, a star system and a
  galaxy.
- **print** (4): Typeset, Print & export, the e-book preview and spreads.
- **toolbar** (3): the find bar, the table toolbar and the timer capsule.
- **empty-state** (3): a project with no documents, no document chosen, and the palette
  with no results. Panels' own empty states are in their panel shots.
- **card** (2), **palette** (2), **canvas** (2), **confirmation** (1, Remove from the
  Book), **landing** (1), **toast** (1, the update banner), **timeline** (1).

### What the mock can't show

These are listed in `surfaces.json` → `unreachable`. In short:

- **Native menus** are drawn by the OS. Their item lists are captured as JSON, so their
  copy can be audited, but not their look.
- **Confirmations** other than Remove from the Book use the native dialog plugin or
  `window.confirm`. The audit reads their copy from source.
- **Print and export** hand off to the system panels.
- **Detached windows, dictation, read aloud, Workbench lookups, Pinterest, link
  previews, online map tiles and satellite pictures** need the Rust side, models or the
  network. So does the Online maps dialog, and the Timer complete sheet needs a timer to
  run out.
- **Gestures and drags**: trackpad panel swiping, drag ghosts and the traffic lights.

The iPad viewport renders with an iPad user agent and touch, so `data-platform="ios"`
and its glass are on. Four surfaces are desktop only, because at 820px their button
sits behind »: the toolbar right-click menu, Spreads, Typeset Insert and the canvas card
colour.

## Audit

Done 2026-10-20: [audit.md](audit.md), and the board `design-review/out/audit.html`
(rebuilt from the control run). Twelve families scored. The order of rounds, confirmed
by the design lead on 2026-10-20:

1. Modals: shell and behaviour
2. Pop-ups
3. Toolbars and capsules
4. Panels (with the map and timeline's in-card inspector)
5. List rows and empty states
6. Confirmations, toasts and errors
7. Copy and naming
8. Cards, then forms

## Rounds

| Round | Family | State |
| --- | --- | --- |
| [01](rounds/01-modals.md) | Modals: shell and behaviour | Applied on `design/round-01-modals` (1B, 2C, 3C, 4C, 5B, 6C); [PR #79](https://github.com/g3vin/inkblot/pull/79) open, waiting to merge |

The design lead confirmed the order above on 2026-10-20.

**Next step:** review and merge round 01's PR. When it merges, its sha becomes the control (recapture, update this file), and round 02 (pop-ups) can start.

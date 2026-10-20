# Design review — state

Where the design review loop stands. The loop is how DESIGN.md changes deliberately
(DESIGN.md §16): audit a pattern family, prototype options behind a dev-only variant
switch, the design lead picks, then one implementation replaces the rest. Picks are
logged in [decisions.md](decisions.md).

## The control

| | |
| --- | --- |
| **Control sha** | `e34d3dd` (head of `feat/maps-3d`) |
| **Captured** | 2026-10-20 |
| **Surfaces** | 83 in [`design-review/surfaces.json`](../../design-review/surfaces.json) |
| **Screenshots** | 326 (light and dark × desktop 1400×900 and iPad 820×1180), 0 failed |
| **Native menus** | 9, saved as JSON item lists |
| **Tooling** | `design/review-setup` (`scripts/dev/capture.mjs`, `compare.mjs`, `tauri-mock.js`) |

The control is `feat/maps-3d` rather than `main`. `origin/main` (`abcd3e9`) is 40
commits behind it, missing the docked panels on the card, Inlay, the sidebar and
inspector rework, the toolbar's More, and 3D maps. Reviewing it would have audited a UI
that is already gone. The design lead chose this on 2026-10-20. Once `feat/maps-3d` is
merged, its merge sha becomes the control: recapture, run
`compare.mjs control <new> --strict` (it should be identical), and update this table.

Screenshots aren't committed (`design-review/out/` is ignored). Rebuild them from the
sha:

```bash
git checkout e34d3dd -- src            # or a worktree at the control sha
npm i --no-save playwright-core pixelmatch pngjs
npm run dev &
node scripts/dev/capture.mjs --run control
```

A run fixes the clock, asks for reduced motion, hides the caret and blocks off-site
requests. Every surface × theme × viewport starts from a fresh page. Twelve surfaces
recaptured on a second run (48 screenshots, including the 3D star system, the canvas
and Typeset) were pixel-identical to the control.

## Coverage

Everything in `surfaces.json`, grouped by family:

- **modal** (17): the New project sheet, Customize toolbar, Customize inspector layout,
  Folder types, Page setup, Author details, the eight Settings panes, Help (and Help
  filtered to nothing) and Export map.
- **editor** (14): text, scrolled, a selection, a new document, a new tab, split, focus
  mode, page view, both sidebars hidden, screenplay, locked, conversation tile, bubble
  paragraph, and renaming in the tree.
- **menu** (11): two in-page `Menu`s (More typeset options, Work on) are screenshotted.
  The nine native ones are saved as JSON: New project options, the project, document,
  editor, toolbar and inspector-header right-click menus, New…, Alignment and Typeset
  Insert.
- **panel** (9): Files, Book, and the inspector tabs Clipboard, Notes, Timeline,
  References, History and Stats, plus History in the Typeset layout. The Workbench is
  the default tab, so it shows in the editor shots.
- **popover** (7): More toolbar items, Read aloud options, the sidebar search, project
  search, the footnote editor, Insert citation and Print options.
- **map** (6): the setup chooser, a blank sheet, the Earth, a planet, a star system and a
  galaxy.
- **print** (4): Typeset, Print & export, the e-book preview and spreads.
- **toolbar** (3): the find bar, the table toolbar and the timer capsule.
- **empty-state** (3): a project with no documents, no document chosen, and the palette
  with no results. Panels' own empty states are in their panel shots.
- **card** (2): the note hover card, and editing a note.
- **palette** (2), **canvas** (2), **landing** (1), **toast** (1, the update banner),
  **timeline** (1).

### What the mock can't show

These are listed in `surfaces.json` → `unreachable`. In short:

- **Native menus** are drawn by the OS. Their item lists are captured as JSON, so their
  copy can be audited, but not their look.
- **Confirmations** (Delete note, delete a reference, cover or typeset version, restore
  a typeset, move-project errors) use the native dialog plugin or `window.confirm`. This
  matters for the confirmations family: the audit can read their copy from source, but
  there is nothing in-app to screenshot.
- **Print and export** hand off to the system panels.
- **Detached windows, dictation, read aloud, Workbench lookups, Pinterest, link
  previews, online map tiles and satellite pictures** need the Rust side, models or the
  network.
- **Gestures and drags**: trackpad panel swiping, drag ghosts and the traffic lights.

The iPad viewport renders with an iPad user agent and touch, so `data-platform="ios"`
and its glass are on. Three surfaces are desktop only, because at 820px their button
sits behind »: the toolbar right-click menu, Spreads and Typeset Insert.

## Noticed while building the catalogue

These are notes for the audit, not decisions:

- `Sheet` uses `ui-` class names; `Dialog`, `NavSheet` and `Menu` use `ib-`.
- On iPad both sidebars stay docked, leaving a narrow writing card.
- The active inspector tab's indicator pill sits over the tab and takes its clicks.
- "Change accent colour…" and "Change window colour…" open Settings › General, and "Edit
  timer routines…" opens Settings › Timers. They are entry points, not separate surfaces.

## Rounds

| Round | Family | State |
| --- | --- | --- |
| — | — | None yet |

**Next step:** `/design-review audit`.

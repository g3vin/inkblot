# Design audit

The front end at the control (`e34d3dd`), family by family: every instance, where they
disagree, what should merge, and where DESIGN.md doesn't say. Nothing here changes the
product. Each decision belongs to a round (`/design-review round <family>`).

- **Screenshots:** `design-review/out/control/` (`node scripts/dev/capture.mjs --run
  control`), and the board `design-review/out/audit.html`.
- **Measurements:** `design-review/out/control/measure.json` (`node
  scripts/dev/measure.mjs --run control`). Values come from computed styles in the
  browser, named by the token they resolve to, at desktop size in the light theme.
  Behaviour comes from fresh pages: where focus lands, Tab, Escape, a click outside, and
  reduced motion.
- **Source-only:** native menus (their items are in `*-menu.json`), confirmations and
  errors (OS dialogs), which the browser can't draw.

_Audited 2026-10-20 against `e34d3dd`, 89 surfaces, 348 screenshots._

---

## Summary

| # | Family | Instances | Visibility (1–5) | Divergence (attributes) | Score |
|---|---|---|---|---|---|
| 1 | [Modals](#1-modals) | 15 | 4 | 12 | **48** |
| 2 | [Pop-ups: popovers and menus](#2-pop-ups-popovers-and-menus) | 20 | 4 | 11 | **44** |
| 3 | [Toolbars and capsules](#3-toolbars-and-capsules) | 12 | 5 | 7 | **35** |
| 4 | [Inspector and in-card panels](#4-inspector-and-in-card-panels) | 12 | 5 | 6 | **30** |
| 5 | [List rows](#5-list-rows) | 10 | 5 | 4 | **20** |
| 6 | [Empty states](#6-empty-states) | 23 | 4 | 5 | **20** |
| 7 | [Copy and naming](#7-copy-and-naming) | cross-cutting | 4 | 5 | **20** |
| 8 | [Cards](#8-cards) | 5 | 4 | 4 | **16** |
| 9 | [Confirmations](#9-confirmations) | 9 | 3 | 5 | **15** |
| 10 | [Forms and fields](#10-forms-and-fields) | 8 | 3 | 5 | **15** |
| 11 | [Toasts and errors](#11-toasts-and-errors) | 4 | 1 | 5 | **5** |
| 12 | [Landing](#12-landing) | 1 | 2 | 1 | 2 |

**Visibility** is how often a writer meets the family: 5 is every session, 1 is rarely.
**Divergence** is how many of the family's attributes disagree between instances.
The scores order the rounds; they aren't a measure of how bad anything looks.

**What stands out:**

1. **Two modal primitives do one job.** `Sheet` (9 call sites) and `Dialog` (2) differ in
   anatomy (no eyebrow, description or close on a Sheet), behaviour (only Dialog makes
   the app inert), layer (z 2000 vs `--z-dialog`) and title size (15px vs `--text-lg`).
   DESIGN.md's table gives Dialog "a decision", but every decision in the app (New
   project, Rename, Remove from the Book) is a Sheet. Dialog is only used by the map.
2. **Two pop-up stylesheets, and a third way.** `Popover.jsx` renders `.ui-popover`
   from `ui.css` (z 2100, no motion, focus left on the anchor). `Menu` and the palette
   wear `.ib-menu` from `Popover.css` (`--z-popover`, `ib-float-in`, focus moved in and
   returned). Six bespoke pop-ups (read aloud, footnote, citation, the Typeset overlay's
   local `Popover`, the e-book panel, the search card) set their own padding, z-index
   (1000, 90, 5) and motion.
3. **The timeline doesn't sit in the skeleton.** There's no `timeline` toolbar context,
   so the card's toolbar shows the *text* tools (Bold, Heading 1, Literata) over a
   timeline. Its own tools are a second band under the rule, and its settings are a
   floating "Map inspector" inside the card.
4. **A parallel control kit lives in the map.** `MapPanelView` (map and timeline) draws
   its own fields: native `<select>`, checkboxes for toggles, tab buttons for a
   segmented switch, `.map-tool` buttons, inline-style padding.
5. **Off-scale type in five panels:** 12px text (between `--text-xs` 11 and `--text-sm`
   13) in Stats, Timeline, References, Typeset and Print & export. The file tree sets
   15px.
6. **Behaviour gaps a writer can feel:** Customize toolbar doesn't take focus or trap
   Tab; no popover moves focus into itself; nothing animates out; `window.confirm`
   callers fall back to `?? true` and delete without asking where `confirm` isn't
   available; a failed save is only logged to the console.

**Proposed order of rounds:**

1. **Modals: shell and behaviour.** The Sheet/Dialog merge, header anatomy, close,
   footer, layer and motion, focus. (≤6 decisions.)
2. **Pop-ups.** One pop-up surface and behaviour; which menus are native.
3. **Toolbars and capsules,** including the timeline's toolbar.
4. **Panels,** including the map/timeline in-card inspector and its control kit.
5. **List rows and empty states,** together. Both are small and both are about density
   and voice in lists.
6. **Confirmations and toasts/errors,** together. Both are about what a writer is told,
   and both need the modal round's answers first.
7. **Copy and naming.** This one can go any time, and is cheapest after the other
   rounds have settled their own labels.
8. **Cards, then forms.**

Modals go first, ahead of their score's tie with pop-ups, because round 1 settles the
layers (z-index), scrim and motion tokens that pop-ups, toasts and confirmations reuse.

---

## 1. Modals

Anything that takes over the window until it's dismissed.

### Inventory

| Instance | Where | Primitive | Surface |
|---|---|---|---|
| New project | `src/components/ProjectLanding.jsx:55` | Sheet | `landing-new-project` |
| Customize toolbar | `src/components/toolbar/ToolbarPalette.jsx:42` | Sheet (`placement="top"`) | `sheet-customize-toolbar` |
| Customize inspector layout | `src/components/RightSidebar/InspectorLayoutEditor.jsx:80` | Sheet | `sheet-customize-inspector` |
| Folder types | `src/components/FolderPresetsSheet.jsx:128` | Sheet | `sheet-folder-types` |
| Page setup | `src/print/PageSetupSheet.jsx:181` | Sheet | `sheet-page-setup` |
| Author details | `src/components/RightSidebar/finishing/FinishingHeader.jsx:198` | Sheet | `typeset-author-details` |
| Rename (a Book part) | `src/components/book/BookNavigator.jsx:166` | Sheet | `book-rename` |
| Remove from the Book | `src/components/book/BookNavigator.jsx:182` | Sheet | `book-remove` |
| Timer complete | `src/components/stats/TimerCapsule.jsx:21` | Sheet | not reached (needs a timer to run out) |
| Settings | `src/components/settings/SettingsSheet.jsx:84` | NavSheet → Sheet | `settings-*` |
| Help | `src/components/help/HelpSheet.jsx:52` | NavSheet → Sheet | `help`, `help-filtered` |
| Export map | `src/map/ExportMapDialog.jsx:148` | Dialog | `map-export` |
| Online maps | `src/map/OnlineMapsDialog.jsx:12` | Dialog | not reached (asks before going online) |
| Command palette | `src/ui/CommandPalette.jsx:81` | bespoke (`.ib-palette.ib-menu`) | `palette` |
| Map setup chooser | `src/map/MapSetup.jsx:138` | bespoke (`.map-floating`), in the pane | `map-setup` |

The palette and the map chooser are listed because they are modal in effect. The
palette is likely a declared exception (it's a launcher, not a form). The map chooser
blocks only its pane.

### Divergence matrix (measured)

| Instance | Width | z | Title | Eyebrow / description | Close | Footer | First focus | Tab trapped | App inert | Enter motion | Focus after Esc |
|---|---|---|---|---|---|---|---|---|---|---|---|
| New project | 400 | 2000 | 15px/600 | — | — | Cancel · **Create** | name field | yes | no | `ui-sheet-in` 180ms | opener |
| Customize toolbar | 720 | 2000 | 15px/600, an instruction | — | — | Restore default set · **Done** | **nothing (body)** | **no** | no | `ui-sheet-drop` 180ms | opener |
| Customize inspector | 560 | 2000 | 15px/600 | — | — | Restore Defaults… · **Done** | first checkbox | yes | no | `ui-sheet-in` 180ms | opener |
| Folder types | 520 | 2000 | 15px/600 | — | — | New folder type (tinted, an *add*) | that button | yes | no | `ui-sheet-in` 180ms | opener |
| Page setup | 440 | 2000 | 15px/600 | — | — | **Done** | first segment | yes | no | `ui-sheet-in` 180ms | opener |
| Author details | 420 | 2000 | 15px/600 | — | — | Cancel · **Save** | first field | yes | no | `ui-sheet-in` 180ms | the ⋯ (its menu's anchor) |
| Rename | 340 | 2000 | 15px/600 | — | — | Cancel · **Rename** | title field | yes | no | `ui-sheet-in` 180ms | opener |
| Remove from the Book | 380 | 2000 | 15px/600, a question | — | — | Cancel · **Remove** (destructive) | Cancel | yes | no | `ui-sheet-in` 180ms | opener |
| Settings | 640 | 2000 | 15px/600 | — | **none** | **none** | nav item | yes | no | `ui-sheet-in` 180ms | opener |
| Help | 720 | 2000 | 15px/600 | — | **none** | **none** | filter field | yes | no | `ui-sheet-in` 180ms | opener |
| Export map | 600 | `--z-dialog` | `--text-lg`/600 | "MAP" + a line | × top-right | 4 plain · **Save PNG…** | the × | yes | **yes** | `ib-dialog-in` 180ms | opener |
| Command palette | 560 | `--z-dialog` | none | — | — | — | search field | yes | no | `ib-float-in` 120ms | opener |
| Map setup | 810 | 4 | 19px/700 (off-scale) | a 12px line | — | — | **nothing** | no | no | none | Esc does nothing |

Held in common: every modal is `--radius-lg`, `--menu-bg`, a 1px `--border-color` edge,
`--shadow-dialog` (map setup: `--shadow-float`). Escape and a click on the scrim close
every one except map setup. Nothing animates out: every exit is instant. Reduced
motion stills every entry.

**Scrims:** Sheet `--scrim-bg`, fading in over `--dur-fast`. Dialog `--scrim-bg` over
`--dur-base`. The palette has its own colour (`rgba(40,32,20,0.16)`, no token).

### Merge candidates

- **Sheet and Dialog** are one primitive with two skins. Decide one anatomy (eyebrow?
  title size? description? close?), one layer, one inert rule and one focus rule, then
  either make Sheet a size of Dialog or the reverse.
- **Title size:** 15px on every Sheet vs `--text-lg` (16) on Dialog. DESIGN.md says
  `--text-lg` for dialog titles.
- **Layer:** Sheet's `z-index: 2000` (and Popover's 2100) vs the `--z-*` scale. DESIGN.md
  §6 says not to invent z-indexes.
- **Footer composition:** Cancel + primary (4), Done alone (1), Restore + Done (2), an
  add action in the footer (Folder types), nothing at all (Settings, Help).
- **First focus:** a field (5), the first control (3), the Cancel button (Remove), the
  close button (Export map), nothing (Customize toolbar, map setup).
- **Widths:** ten different widths (340–810). Probably two or three sizes are enough.
- **Motion:** DESIGN.md §7 gives sheets `--dur-slow` (240ms); every Sheet uses
  `--dur-base`. The two scrims fade at different speeds.

### Where DESIGN.md is silent or ambiguous (your decisions)

- **Sheet vs Dialog.** §9 splits them by job ("a decision, or a small setting" vs "larger
  settings and editors") but describes anatomy only for Dialog. Should a Sheet have an
  eyebrow, a description, a close button? Should both exist?
- **How a modal with no footer is closed** (Settings, Help): DESIGN.md is silent.
  Today it's Escape or a click on the scrim, with no visible control.
- **Where focus lands on open:** §13 says "trap focus and return it", and is silent on
  which element gets it.
- **Exit motion:** §7 says motion explains where something came from. It's silent on
  leaving. Today nothing animates out.
- **Whether the app behind is inert** (Dialog does this, Sheet doesn't).
- **Modal sizes:** no size scale.
- **The palette's scrim:** lighter than `--scrim-bg`. Is that deliberate?

---

## 2. Pop-ups: popovers and menus

Anything anchored to a control that floats until it's dismissed.

### Inventory

| Instance | Where | Primitive | Surface |
|---|---|---|---|
| More toolbar items (») | `src/components/toolbar/ToolbarHost.jsx:137` | Popover | `toolbar-more` |
| Table cell fill | `src/components/TableToolbar.jsx:188` | Popover | `editor-table-fill` |
| Print options | `src/components/RightSidebar/finishing/FinishingHeader.jsx:97` | Popover | `typeset-print-options` |
| Go to page | `src/components/RightSidebar/finishing/FinishingHeader.jsx:139` | Popover | `typeset-go-to-page` |
| Canvas card colour | `src/components/toolbar/items/canvasItems.jsx:97` | Popover | `canvas-colors` |
| Print sides | `src/components/RightSidebar/finishing/outputSections.jsx:44` | Popover | not captured |
| Table borders, More table tools | `src/components/TableToolbar.jsx:193`, `:201` | Menu | `editor-table-more` |
| ScopeMenu, MoreMenu (panel headers) | `src/ui/PanelActions.jsx` | Menu | `typeset-scope-menu`, `typeset-more-menu` |
| Read aloud options | `src/components/ReadAloudControl.jsx:596` | bespoke | `toolbar-read-aloud` |
| Footnote editor | `src/print/FootnoteEditor.jsx:65` | bespoke | `editor-footnote` |
| Citation popover | `src/extensions/citationPopover.js:46` | bespoke (DOM) | not captured |
| Typeset overlay popover | `src/print/TypesetOverlay.jsx:411` | bespoke, a local `function Popover` | not captured |
| E-book options | `src/print/DigitalPreview.jsx:431` | bespoke (`.digital-more-panel`) | `typeset-digital` |
| Project search (sidebar) | `src/components/search/ProjectSearch.jsx:524` | bespoke, veiled | `left-search` |
| Project search (⇧⌘F) | `src/components/search/ProjectSearch.jsx:43` | bespoke, veiled | `project-search` |
| Bubble editor | `src/components/bubble/BubbleEditor.jsx:578` | bespoke | `editor-bubble` |
| Native menus | `useNativeMenu` / `popUpNativeMenu`, 15 files | OS | `*-menu.json` (9) |

### Divergence matrix (measured)

| Instance | Stylesheet | z | Padding | Edge | Enter motion | Role | Focus on open | Tab | Focus after Esc |
|---|---|---|---|---|---|---|---|---|---|
| More toolbar items | `.ui-popover` | 2100 | `--space-2` | 1px | none | toolbar | stays on » | leaves | the » |
| Table cell fill | `.ui-popover` | 2100 | 8px | 1px | none | radiogroup | stays in text | leaves | opener |
| Print options | `.ui-popover` | 2100 | `--space-2` | 1px | none | none | stays on ⋯ | leaves | the ⋯ |
| Go to page | `.ui-popover` | 2100 | `--space-2` | 1px | none | none | the field | leaves | **body** |
| Canvas colour | `.ui-popover` | 2100 | 8px | 1px | none | radiogroup | stays on button | leaves | the button |
| Menu (table, panel) | `.ib-menu` | `--z-popover` | 4px | 1px | `ib-float-in` 120ms | menu | first item | **closes** | the anchor (table: **body**) |
| Read aloud | bespoke | 90 (`--z-toast`) | 10px | 1px | `dictation-pop` 180ms, raw `ease-out` | none | stays on button | leaves | **body** |
| Footnote | bespoke | 1000 | 10px | 1px | none | dialog | the field | leaves | the text |
| Search (sidebar) | bespoke, veiled | `--z-popover` | — | hairline | `project-search-open-up` 120ms | dialog | the field | leaves | **body** |
| Search (⇧⌘F) | bespoke, veiled | `--z-popover` | — | hairline | `project-search-fly` 240ms | dialog | the field | leaves | **body** |

Held in common: `--radius-lg`, `--menu-bg`, `--shadow-float`. Escape and a click
outside close every one. Nothing animates out.

The surface tokens are aliases of one value, so the paint matches. `--menu-bg`,
`--popover-bg`, `--surface-float` and `--map-ui-bg` are all paper-2;
`--shadow-popover` and `--menu-shadow` are `--shadow-float`. The sprawl is in names, not
pixels.

### Merge candidates

- **`.ui-popover` (ui.css) and `.ib-popover`/`.ib-menu` (Popover.css)** are two
  stylesheets for "the one pop-up surface". `Popover.jsx` also skips the shared hooks
  (`useDismiss`, `useAnchoredPosition`) that `Menu` uses. DESIGN.md §9 says to use them.
- **Bespoke pop-ups** (read aloud, footnote, citation, the Typeset overlay's local
  `Popover`, e-book options): each sets its own padding (10px, 12px), z-index (1000, 90,
  5) and motion (`dictation-pop` with a raw `180ms ease-out`).
- **Focus:** a Menu moves focus in and returns it to the anchor. A Popover leaves focus
  where it was, so a keyboard user can't reach its contents without tabbing through
  the page. Go to page, read aloud and search hand focus to `body` on close.
- **Native vs in-page menus for the same job.** Alignment, Typeset Insert and New… are
  native menus. Table Borders, More table tools and the panel ⋯ are in-page `Menu`s.
  The toolbar's » is a Popover of icons.

### Where DESIGN.md is silent or ambiguous (your decisions)

- **Which menus are native.** §9 gives `useNativeMenu` "context menus and menus a native
  window menu would show". Is a toolbar's dropdown (Alignment, Insert) one of those?
- **Whether a Popover takes focus,** and whether Tab closes it, as it closes a Menu.
- **Whether » is a menu (with labels) or a strip of icons** (today it's icons).
- **Exit motion** (as for modals).

---

## 3. Toolbars and capsules

### Inventory

| Instance | Where | Primitive | Surface |
|---|---|---|---|
| The card's toolbar (document, canvas, map, Typeset) | `src/components/EditorLayout.jsx:769` | bespoke `.app-titlebar` + `ToolbarHost` | `editor-text`, `canvas-card`, `map-blank`, `typeset` |
| Timeline's own toolbar | `src/timeline/TimelineToolbar.jsx:20` | bespoke band | `timeline-empty` |
| Find bar | `src/components/FindBar.jsx:113` | bespoke card | `editor-find` |
| Table toolbar | `src/components/TableToolbar.jsx:171` | FloatingToolbar | `editor-table` |
| Timer | `src/components/stats/TimerCapsule.jsx:57` | FloatingCapsule | `timer-capsule` |
| Word count, page count | `src/components/EditorCanvas.jsx:14` | `.floating-capsule` | `editor-page-view` |
| Locked badge | `src/components/DocLockBadge.jsx:38` | FloatingCapsule | `editor-locked` |
| Tab bar | `src/components/tabs/DocumentTabBar.jsx:97` | FloatingCapsule | `editor-new-tab` |
| Detached window bar | `src/components/DetachedWindowBar.jsx:29` | FloatingToolbar | not reached |
| Map's floating tools | `src/map/Map.css:345` (`.map-floating`) | bespoke | `map-blank` |

### Divergence matrix (measured)

| Instance | Height | Radius | Edge / shadow | Padding | z | Controls (px) |
|---|---|---|---|---|---|---|
| Card toolbar | 44 | — | the rule below | 0 | `--z-chrome` | 36, 28, 26, 22 |
| Timeline toolbar | 43 | 0 | none, an `--app-bg` band | 6 / 10px | auto | 30, 22 |
| Find bar | 38 | `--radius-lg` | 1px, `--shadow-float` | 4 / `--space-2` | `--z-chrome` | 26, 18 |
| Table toolbar | 36 | (capsule) | `FloatingToolbar` | 0 | `--z-chrome` | 26 |
| Timer | 34 | `--radius-lg` | 1px, `--shadow-float` | 3px 4px 3px 3px | `--z-popover` | 26 |
| Word count | 28 | `--radius-lg` | 1px, `--shadow-float` | 0 10px | 5 | — |
| Locked badge | 28 | `--radius-lg` | 1px, `--shadow-float` | 0 / 4–8px | 5 | 20 |
| Tab bar | 28 | `--radius-lg` | 1px, `--shadow-float` | 2px | `--z-panel` | 16 |

Icons are 16px everywhere. DESIGN.md §8 asks for 20px in primary toolbars.

### Merge candidates

- **The timeline** has no `timeline` context in `src/lib/chromeLayout.ts`, so the card's
  toolbar keeps the document's tools while a timeline is open. Its own tools sit in a
  second band under the rule. Canvas, map and Typeset all put theirs in the card's
  toolbar.
- **Capsule heights** of 28, 34, 36 and 38 for one surface (`.floating-capsule`).
  DESIGN.md's sizes are `--size-capsule` 26, `--size-circle` 28, `--size-toolbar` 36.
- **Capsule layers:** 5, `--z-panel`, `--z-chrome` and `--z-popover`. These are all
  "chrome over the page".
- **The find bar** is a floating card with the float shadow, not a `FloatingToolbar`.
- **Off-scale padding:** 3px, 2px and 10px.

### Where DESIGN.md is silent or ambiguous (your decisions)

- **Icon size in the card's toolbar:** §8 says 20px in primary toolbars; every toolbar
  is 16px. Is the card's toolbar a "dense toolbar"?
- **A feature's own toolbar row** (the timeline's): §6 allows one rule, and is silent on
  a second band of tools.
- **Capsule height:** no token for a readout capsule.

---

## 4. Inspector and in-card panels

### Inventory

| Panel | Where | Header actions | First block | Surface |
|---|---|---|---|---|
| Clipboard | `src/components/RightSidebar/ClipboardPanel.jsx` | — | EmptyState | `inspector-clipboard` |
| Workbench | `src/components/RightSidebar/Workbench.jsx` | PanelActions | EmptyState | `editor-text` |
| Notes | `src/components/NotesPanel.jsx` | — | note cards (bespoke) | `inspector-notes` |
| Timeline | `src/timeline/TimelineSidebarPanel.jsx` | — | Section | `inspector-timeline` |
| References | `src/components/RightSidebar/references/ReferencesPanel.jsx` | Scope, ⋯ | add field, then EmptyState | `inspector-references` |
| History | `src/components/RightSidebar/HistoryPanel.jsx` | +, archive | Segmented | `inspector-history` |
| Stats | `src/components/stats/StatsPanel.jsx` | Scope, ⋯ | Segmented | `inspector-stats` |
| Typeset | `src/components/RightSidebar/finishing/FinishingPanels.jsx` | Scope, ⋯ | Section | `typeset` |
| Print & export | same | Scope, ⋯ | Section | `typeset-print-export` |
| History (Typeset) | `src/components/RightSidebar/TypesetHistoryView.jsx` | PanelActions | EmptyState | `typeset-history` |
| Map (inspector tab) | `src/components/RightSidebar/MapInspectorPanel.jsx` | — | — | not captured |
| Map / timeline in-card inspector | `src/map/MapPanelView.jsx:284` | its own (back, hide) | its own tabs | `timeline-empty`, map |

### Divergence (measured)

| Panel | Type styles in use | Control heights (px) |
|---|---|---|
| Clipboard, Workbench, History | xs, xs bold, md Courier | — |
| Notes | sm Literata, xs, xs Courier | 24, 22 |
| Timeline | sm, xs, **12px** | 32, 26, 18 |
| References | sm, xs, **12px** | 32, 26, 18, 17 |
| Stats | sm, xs, **12px** (400/500/600) | 32, 26, 22, 13 |
| Typeset | xs, **12px**, 7px (style previews) | 32, 26, 19, 18 |
| Print & export | sm, xs, **12px** | 32, 26, 19, 18 |

The header row is consistent: an eyebrow title, at most one scope and one ⋯, at most
one Segmented, then Sections. That is the 2026-10-09 panel audit holding.

### Merge candidates

- **12px type** in five panels (`--text-xs` is 11, `--text-sm` is 13).
- **Control heights** of 13–22px in panels. DESIGN.md §7 says not to go below 26.
- **The in-card inspector** (`MapPanelView`, used by the map and the timeline) is a
  second panel system inside the card. It has its own field kit (`TextField`,
  `NumberField`, `SelectField` on a native `<select>`, `CheckField` checkboxes,
  `ColorField`), tab buttons with an `is-primary` fill instead of `Segmented`,
  `.map-tool` bare buttons, and inline padding (`'8px 12px 0'`). It closes with a ×
  labelled "Hide the inspector". The map also has a Map tab in the real inspector.
- **Notes** is the one panel built from bespoke cards, with no Section or EmptyState
  while it has notes.

### Where DESIGN.md is silent or ambiguous (your decisions)

- **A panel inside the card.** §6 puts the inspector on the tray, and says "other
  floating panels use `Panel`" (which has no call sites). Should the map and timeline
  inspector move to the tray's inspector, or become a `Panel`?
- **The smallest control in a panel** (a 17px link, an 18px toggle row).

---

## 5. List rows

| List | Where | Height | Padding | Radius | Text | Selected |
|---|---|---|---|---|---|---|
| File tree | `src/components/FileTree.jsx:556` | 27 | 2 / 8px | 8 | **15px** | lifted paper |
| Book | `src/components/book/BookNavigator.jsx:30` | 26 (35 with subtitle) | 3 / 6px | 4 | 13 | lifted paper |
| Landing projects | `src/components/ProjectLanding.jsx` | 52 | 8 / 10px | 8 | 13 | lifted paper |
| NavSheet (Settings, Help) | `src/ui/NavSheet.jsx` | 27 | 4 / 8px | 4 | 13 | lifted paper |
| Command palette | `src/ui/CommandPalette.jsx` | 36 | 0 / 12px | 4 | 13 | **accent tint** |
| Menu | `src/ui/Menu.jsx` | 32 | 0 / 8px | 4 | 13 | — |
| Search (sidebar, ⇧⌘F) | `src/components/search/ProjectSearch.jsx` | 36 / 43 | 6 / 8px | 8 | 13 | **grey wash** |
| Inspector layout list | `src/components/RightSidebar/InspectorLayoutEditor.jsx` | 30 | 0 / 8px | 4 | 13 | — |
| Folder types list | `src/components/FolderPresetsSheet.jsx` | 37 | 0 | 0 | 13 | — |

**Merge candidates:** eight heights against `--row-h` (36); radius 4 or 8 for the same
row; two keyboard highlights in pop-up lists (the palette's accent tint, search's grey);
the file tree's 15px text.

**Silent or ambiguous:** whether sidebar trees follow `--row-h` (a 36px tree would
show far fewer files), and whether a keyboard-highlighted row is "focus" (accent, §6) or
"where you are" (neutral).

---

## 6. Empty states

| Instance | Where | Primitive | Title | Hint |
|---|---|---|---|---|
| Clipboard, Workbench, Notes, History, References, Archive, Typeset history, Help, landing, no document (Typeset, Timeline) | 13 files (see `grep EmptyState`) | EmptyState | `--text-md` Courier Prime, `--text-secondary` | `--text-xs` Inter |
| No matching notes, workbench, clipboard; No matches (search); No session yet; Nothing attached yet; Loading the timeline… | 7 call sites | EmptyState compact | same | same |
| No files yet. | `src/components/FileTree.jsx:876` | **bespoke** | **15px Inter**, raw `rgb(133,126,115)` | — |
| Create a new document to begin. | `src/components/EditorCanvas.jsx:609` | **bespoke**, an older `.empty-state` with a bare + button | — | — |
| Double-click to add a card · scroll to pan · … | `src/canvas/CanvasSurface.jsx:721` | **bespoke** | **12px Inter**, `--text-subtle` | — |
| No events yet. Double-click anywhere… | `src/timeline/TimelineSurface.jsx:533` | **bespoke** | `--text-sm` Inter, `--text-muted` | in the same line |
| No commands match "…". | `src/ui/CommandPalette.jsx:101` | **bespoke** | `--text-sm` Courier Prime, `--text-muted` | — |
| New tab (choose a kind) | `src/components/DraftTabPane.jsx` | bespoke chooser | — | — |

**Merge candidates:** the five bespoke empties. The canvas and timeline lines are each
feature's first-run moment, and neither uses the one empty-state voice (§1: "one
empty-state voice").

**Silent or ambiguous:** whether a document surface (canvas, timeline, a new document)
gets an `EmptyState` in the middle of the card or a quieter hint. DESIGN.md describes
lists and panels only.

---

## 7. Copy and naming

From the native menus (`*-menu.json`), sheet titles and buttons:

| Same thing | Said as |
|---|---|
| Reveal a file in Finder | "Show in Finder" (landing) · "Reveal in Finder" (file tree) |
| Move | "Move folder location…" · "Move file to…" |
| Version history | "Open version history" (file menu) · "Show version history" (⌘K) |
| Focus mode | "Focus mode" (right-click) · "Enter focus mode" (⌘K) |
| Customize the inspector | "Customize layout…" · "Customize inspector layout…" |
| Page break | "Insert page break" · "Page break" · "Insert break to next right-hand page" · "Next right-hand page" · "Break to next right-hand page" |
| New document | "New document" (New… menu) · "New document…" (⌘K) |
| Delete (with a confirmation) | "Delete" (file tree) · "Delete…" (references, typeset, covers) |
| Restore defaults | "Restore default set" · "Restore Defaults…" (Title Case) |
| Delete a footnote | "Delete Note" (Title Case, footnote editor) · "Delete note" elsewhere |
| The Book | "Remove from the Book…" (menu) · "Remove “Part” from the book?" (sheet title) |
| The × | "Close" (Dialog) · "Dismiss" (update banner) · "Hide the inspector" (map) |
| Spelling | "Color" (canvas toolbar), "Align center" (menus) · "colour", "Centre" (Typeset) |

**Silent or ambiguous:** US or UK spelling (DESIGN.md writes "colour" and
"Customize"); whether "Book" is a proper name; whether a verb-first rule applies to
modes ("Focus mode" vs "Enter focus mode"); whether the ellipsis goes on an action
that only asks for confirmation.

---

## 8. Cards

| Card | Where | Primitive |
|---|---|---|
| Note card (Notes panel) | `src/components/RightSidebar/NoteCard.jsx` | bespoke, card recipe |
| Note hover card | `src/components/NoteHoverPreview.jsx:169` | bespoke, veiled (§12), 290px, `--shadow-float`, z `--z-dialog` |
| Canvas card | `src/canvas/CanvasTextNode.jsx` | bespoke |
| Map hover card | `src/map/MapHoverCard.jsx:22` | bespoke, 280px, raw `10px 12px` padding, z 6 |
| Update banner | `src/components/UpdateBanner.jsx:47` | bespoke |

`Card`, `Tag`, `Panel` and `Tabs` from `src/ui` have **no call sites** outside the
showcase. Neither do `Tooltip`, `Checkbox` and `FloatingActionButton`.

**Merge candidates:** the note card and the canvas card are both "things the writer
made", which is what DESIGN.md gives `Card` for. **Silent:** whether a hover card is a
card or a pop-up (the note hover card sits on `--z-dialog`). Cards weren't measured in
depth. The round will.

---

## 9. Confirmations

| Confirmation | Where | Mechanism | Copy |
|---|---|---|---|
| Delete note | `src/components/RightSidebar/NoteCard.jsx:167` | native `confirm` | "Delete note?" |
| Delete note branch | `src/components/NoteHoverPreview.jsx:747` | native `confirm` | "Delete note branch?" |
| Delete project | `src/hooks/contextMenu/fileTreeMenu.js:110` | native `confirm` | `Delete project "X"?` |
| Delete file or folder | `src/hooks/contextMenu/fileTreeMenu.js:208`, `:269` | native `confirm` | `Delete "X"?` |
| Delete a typeset version | `src/components/RightSidebar/TypesetHistoryView.jsx:49` | `window.confirm` | "Delete this typeset version?" |
| Restore a typeset | `…/TypesetHistoryView.jsx:53` | `window.confirm` | three sentences |
| Delete a cover | `src/components/RightSidebar/finishing/outputSections.jsx:172` | `window.confirm` | “X”, with its consequence |
| Delete a source | `src/components/RightSidebar/references/ReferencesPanel.jsx:210` | `window.confirm` | with its consequence |
| Remove from the Book | `src/components/book/BookNavigator.jsx:182` | **Sheet** | a question title, Remove (destructive) |

**Merge candidates:** three mechanisms. The `window.confirm` callers fall back to
`?? true`, so where `window.confirm` isn't available they act without asking. Copy
varies between naming the thing and its consequence (§11) and a bare "Delete note?",
with straight and curly quotes.

**Silent or ambiguous:** native OS dialog or an in-app Dialog? §9 says `Button
variant="destructive"` is for "confirm or offer undo". Which deletions get a
confirmation, and which get an undo instead? (§11's example, "moves to the archive for
30 days", suggests undoable deletes.)

---

## 10. Forms and fields

| Form | Pattern |
|---|---|
| Settings panes | `FormRow` + controls, label left |
| Page setup (a Sheet) | `Section` + `FormRow`, the inspector's pattern inside a modal |
| Typeset and Print & export panels | `Section` + `FormRow`, which edits the same settings as Page setup |
| Author details, New project | `Field` (label above) |
| Map and timeline inspector | `MapPanelView`'s own fields (see §4) |
| Timers pane, inspector layout list | bare `<input type="checkbox">` |
| Read aloud, version compare | native `<select>` |

**Merge candidates:** the bare checkboxes and native selects (`Checkbox` and
`SelectMenu` exist), and the map field kit. **Silent:** whether Page setup should exist
both as a sheet and as the Typeset panel.

---

## 11. Toasts and errors

| Instance | Where | Notes |
|---|---|---|
| Update banner | `src/components/UpdateBanner.jsx:47` | `--z-toast`, × labelled "Dismiss", a tinted action |
| Typeset "changed for the whole book" | `src/print/TypesetOverlay.jsx:544` | z 1000, raw padding `7px 8px 7px 14px`, a bare `<button>` Undo, 6s |
| Move project errors | `src/components/ProjectLanding.jsx:148`, `src/hooks/contextMenu/fileTreeMenu.js:79` | native `message()`; "Could not move the project." |
| A failed save | `src/lib/FileSystem.js:266` | **only `console.error`**: the writer is told nothing |

**Silent:** DESIGN.md has a `--z-toast` layer but no toast component or rule (where,
how long, how dismissed, whether it carries an undo), and no rule on where errors
appear. §11 covers only their words.

---

## 12. Landing

One instance (`src/components/ProjectLanding.jsx`). It uses `EmptyState` for no projects,
lifted-paper selection and the wordmark. No merge candidates. Its New project sheet is
in §1.

---

## Skeleton and signature

**The skeleton every feature shares today:** the card on the tray; the card's toolbar
under one rule; docked or hovering sidebars; an inspector tab with an eyebrow title,
scope and ⋯; Sections; `EmptyState` for nothing; Inter chrome; sentence case.

| Feature | Its signature today (declared or de facto) | Where it leaves the skeleton |
|---|---|---|
| **Editor** | Literata on the card's paper; the note dot in the text; word-count capsule | — |
| **Notes** | `note` icon; ink-tinted cards; the veiled hover card and its strings (§12) | Cards are bespoke; no `Card` |
| **Canvas** | `canvas` icon; the dotted grid; card colours from the inks | Empty state is a bespoke 12px hint line; the colour item says "Color" |
| **Map** | `map` icon; the compass and scale bar; globe, planets, galaxies; the setup chooser | An in-card inspector with its own field kit; setup title 19px/700; z 4–6 layers; a Map tab in the real inspector too |
| **Timeline** | `timeline` icon; lanes and the day axis | Text tools in the card's toolbar; its own toolbar band; the in-card inspector; a bespoke empty state |
| **Print / Typeset** | `type-style` and `print` icons; real pages on a grey desk; style preview tiles | A local `Popover`, a bespoke toast, e-book options panel; 12px type |
| **Stats** | `chart` icon; the timer capsule; charts | 12px type; 13px controls |
| **References** | `books` icon; the add-a-source field | 12px type; 17px controls |
| **History** | `history` icon; the version list; All/Named | Typeset history confirms through `window.confirm` |

**On iPad** (820px wide), both sidebars stay docked, so the card narrows to a column of
about 300px, with four or five words to a line (`editor-text-*-ipad`). DESIGN.md §6 is
silent on when a sidebar should stop docking.

No feature declares an ink today. The table above is what each feature *does* own; which
of it is a signature is your call, feature by feature, in the rounds.

---

## Bugs noticed (not design decisions)

These change behaviour, not design, and could be fixed outside the loop. They're listed
so they don't get lost.

- A failed save only logs to the console (`src/lib/FileSystem.js:266`).
- `window.confirm?.(…) ?? true` deletes without asking where `confirm` is missing
  (`TypesetHistoryView.jsx:43`, `outputSections.jsx:172`, `ReferencesPanel.jsx:210`).
- Customize toolbar opens with focus on `body`, and Tab walks out of the sheet into
  the page (measured; the other eight Sheets trap Tab).
- `Sheet`'s title id is the fixed `ui-sheet-title`, so two sheets at once would share an
  id.
- The active inspector tab's indicator pill takes that tab's clicks.

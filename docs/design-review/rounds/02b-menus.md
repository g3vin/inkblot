# Round 02b: Menus

The second half of the pop-ups family (see [02-popups.md](02-popups.md), which split it).
This round covers the menus: which ones the OS draws, the toolbar's », a pop-up opened from
a pop-up, and the command palette, which round 01 left as an exception to review. The
evidence is in [audit.md §2](../audit.md#2-pop-ups-popovers-and-menus).

- **Board:** `design-review/out/round-02b/board.html`, light over dark, with live links.
  Native menus are drawn by macOS, which no screenshot of the page can show, so the board
  lists their items instead.
- **Branch:** `design/round-02b-menus`, stacked on round 02 (PRs #79 and #80 aren't
  merged yet). The baseline is round 02's head, `81e10fb`: the capture `r02-applied`, and
  `r02b-default` for the two surfaces this round adds (Export menu, read aloud after a
  click inside it).
- **Prototype:** `src/dev/variants/menus.jsx`, behind `?variant=menus:…`, which only dev
  builds load. With no variant, the app renders pixel-identical to the baseline (46 of
  46), and `?variant=menus:A` does too (24 of 24).
- **Live:** run `npx vite --port 5181` in the worktree, then open
  `http://localhost:5181/?mock&variant=menus:1B` or `?mock&variant=menus:1B,2B,3B`.

Each decision is shown with the others held at A.

---

## 1. Native or in-page menus

Every right-click menu is native, as DESIGN.md §9 says ("context menus and menus a native
window menu would show"). §9 doesn't say what to do with a menu a button opens. Today
about 20 call sites draw those natively: the toolbar's Alignment and Insert, New…, Export,
Report, New project options, Add an edition, Break, scene breaks, glyphs, New source, Add
a contributor, a typeset version's ⋯, the inspector layout ⋯ and others. Three kinds are
in-page `Menu`s: the table's Borders and More, a panel's ⋯ (`MoreMenu`) and its scope
(`ScopeMenu`).

A native menu has the OS's look, type-to-select and the system's accessibility. An in-page
one has the app's look, eyebrow groups, hints and shortcut chips, can be screenshotted
and tested, and works without the desktop shell. In a plain browser, as in the mock, a
native menu does nothing.

| Option | What it is | Serves | Costs |
|---|---|---|---|
| **A** | Control: mixed | — | — |
| **B** | Right-click menus stay native; every menu a button opens is an in-page `Menu`, as the table's and the panels' are | One look for menus you click; §9's split, read as "native where the OS would put one" | One code path: `popUpNativeMenu` draws in the page when a button opens it. Submenus become labelled groups |
| **C** | Every menu is native, the three in-page kinds too | The OS's menus everywhere | `MenuLabel` eyebrows become disabled items; hints and shortcut chips go; none of it can be screenshotted or tested in a browser |

## 2. The » strip

When the toolbar runs out of room, » shows the items that don't fit: the same icons, in a
strip. Every other "More" in the app is a menu with words.

| Option | What it is | Serves | Costs |
|---|---|---|---|
| **A** | Control: a strip of icons | — | — |
| **B** | A labelled list: one item a row, its icon then its name, like a More menu. The controls still work in place (Alignment's ▾, Highlight's ink) | §10: names for the less-used tools; like every other More | Taller. Controls with a ▾ sit their name a step further in |
| **C** | Tiles, three across, the name under the icon (the toolbar's Icon and text, in a grid) | Names, and still compact | A third look for toolbar items |

## 3. A pop-up opened from a pop-up

Read aloud lives in », and its button opens read aloud's own Popover. Today any click
inside read aloud counts as "outside »", so » closes and takes read aloud with it: read
aloud can't be used from ». Escape closes both at once. (Print options… from the Print &
export ⋯ menu already does it another way: the menu closes and the popover opens.)

| Option | What it is | Serves | Costs |
|---|---|---|---|
| **A** | Control: a click inside closes both | — | Read aloud is broken in » |
| **B** | They stack: » stays open behind read aloud. A click in either keeps both, Escape closes the inner one first, and a click outside both closes both | macOS menus and submenus | Popover keeps a list of the pop-ups opened from it |
| **C** | The inner one takes the outer's place: » hides while read aloud is open, and closing read aloud closes » too | One pop-up on screen at a time | As B |
| **D** | *Proposed by the design lead, 2026-10-21.* » becomes read aloud: the button you clicked stays, pressed; the other items go; the pop-up grows (over `--dur-base`) to hold read aloud's contents under a hairline. Click that button again to go back to the list; Escape or a click outside closes it all | One pop-up on screen, and you can see where you came from | Popover renders a pop-up opened from inside it into itself. Shown on the 2B list, and on today's strip |

## 4. The command palette

Round 01 declared ⌘K an exception, to review here. It sits on `--z-dialog` over a
lighter scrim (`--overlay-bg`) than dialogs use (`--scrim-bg`). It fades in over
`--dur-fast` and doesn't leave. The app behind stays live (not inert). It traps Tab and
returns focus.

| Option | What it is | Serves | Costs |
|---|---|---|---|
| **A** | Control: its own scrim and motion | — | — |
| **B** | A Dialog's scrim and behaviour: it drops in, leaves the way it came, and the app behind is inert. The launcher body (search, list) stays its own | One modal behaviour (round 01) | The exception goes from DESIGN.md |
| **C** | No scrim: a launcher floating over a live page, on the pop-up layer with the float shadow, like Spotlight. A click outside closes it | A launcher, not a form; the page stays in view | A new shape to declare: neither dialog nor anchored pop-up |

---

## Recommendation

This is my reading of the evidence. Every decision is yours.

1. **B.** Clicked menus all look and behave alike, with the eyebrows, hints and chips the
   in-page Menu already has. They can be tested, and the page doesn't depend on the
   shell to show its own menus. Right-click stays native, which is where the OS's menu is
   expected.
2. **B.** » is a More, and every other More has words. Tiles (C) add a third look.
3. **B.** It fixes read aloud in » the way menus and submenus behave on the Mac. C makes
   » vanish under you, which reads as a glitch.
4. **B.** It removes round 01's one exception at little cost. If you'd rather keep the
   palette light, C is the honest alternative to A: it says what the palette is (a
   launcher) instead of half a dialog.

Mixed, as a link: `?mock&variant=menus:1B,2B,3B,4B`.

## Picks

Picked by the design lead on 2026-10-21 (3D confirmed after it was prototyped):

| Decision | Pick |
|---|---|
| 1. Native or in-page menus | **B**: a menu a button opens is an in-page `Menu`; right-click menus stay native |
| 2. The » strip | **B**: a labelled list |
| 3. A pop-up opened from a pop-up | **D** (the design lead's own proposal): » becomes the pop-up opened from it; its button stays pressed, the others go; click it again to go back |
| 4. The command palette | **B**: a Dialog's scrim and behaviour |

All four together: `?mock&variant=menus:1B,2B,3D,4B`.

## Applied

Applied on `design/round-02b-menus`, 2026-10-22. The prototype (`src/dev/variants/menus*`)
is gone, and no family is left behind the variant switch.

- **1B:** `popUpNativeMenu` is now `popUpMenu` (`src/ui/useNativeMenu.js`). Opened from a
  button, it draws an in-page `Menu` from the same item list (`src/ui/MenuFromItems.jsx`):
  a submenu becomes a labelled group and an accelerator a shortcut chip. A right-click
  still gets the OS's menu. The ~20 call sites didn't change beyond the rename.
- **2B:** » is a labelled list, one item a row, icon then name (`ToolbarHost.jsx`,
  `Toolbar.customize.css`). Controls with a ▾ still work in place.
- **3D:** a Popover opened from inside another renders into it (`src/ui/Popover.jsx`,
  `PopoverNestContext` in `layer.js`). The button that opened it stays pressed
  (`data-opener`), the other items hide, and the pop-up grows over `--dur-base` (still
  under reduced motion) and re-places itself so it stays on screen. That button again goes
  back; Escape or a click outside closes both.
- **4B:** the command palette is a Dialog in behaviour: `--scrim-bg`, it drops in over
  `--dur-slow`, leaves the way it came, and `#root` is inert while it's open. DESIGN.md's
  exception for it is gone.

Recaptured against round 02's head (`r02-applied`): 36 of 352 screenshots changed, and
every one is explained by a pick:

- **1B:** New…, Alignment, Typeset Insert and New project options now show the in-page
  menu where the mock drew nothing (the browser can't draw a native one).
- **2B:** » (More toolbar items), and the table, Alignment and conversation shots, which
  leave » open.
- **3D:** read aloud now opens inside ».
- **4B:** the palette's three surfaces, in dark only. In light, `--scrim-bg` and
  `--overlay-bg` render the same over the app.

The two new surfaces, the Export menu and read aloud after a click inside it, are compared
with `r02b-default` (round 02's code): before, Export drew no menu in the page and read
aloud closed on the click; now both stay. Nothing outside a menu, », read aloud or the
palette changed.

Tests cover a menu a button opens (drawn in the page, items run, a right-click draws none)
and a pop-up opened from a pop-up (opens inside, the opener pressed, goes back).

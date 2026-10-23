# Round 03: Toolbars and capsules

The card's toolbar and everything that floats over the page as a strip or a readout: the
timeline's own toolbar, the find bar, the table toolbar, the timer, the word and page
count, the locked badge and the tab bar. The evidence is in
[audit.md §3](../audit.md#3-toolbars-and-capsules), re-measured at this round's baseline
(rounds 01–02b changed none of it).

- **Board:** `design-review/out/round-03/board.html`, light over dark, with live links.
- **Branch:** `design/round-03-toolbars`, stacked on round 02b (PRs #79, #80 and #84
  aren't merged yet). The baseline is round 02b's head, `bded735`: the capture
  `r02b-applied`, plus `r03-A` for the one surface this round adds (find with replace
  open).
- **Prototype:** `src/dev/variants/toolbarsFamily.js`, `TimelineTools.jsx` and
  `toolbars.css`, behind `?variant=toolbars:…`, which only dev builds load. With no
  variant, the app renders pixel-identical to the baseline (52 of 52).
- **Live:** run `npx vite --port 5181` in the worktree, then open
  `http://localhost:5181/?mock&variant=toolbars:1B`, or several at once:
  `?mock&variant=toolbars:1B,2C,3B,4C`.

Each decision is shown with the others held at A.

---

## 1. The timeline's tools

Canvas, map and Typeset put their tools in the card's toolbar (`chromeLayout.ts` has a
context for each). The timeline has none, so over a timeline the card's toolbar shows the
**text** tools (Bold, Heading 1, Literata), which do nothing there. The timeline's own
tools sit in a second band under the rule, with a second rule of its own (§6: "the one
rule in the room"), drawn with the map's older `.map-tool` buttons (30px).

| Option | What it is | Serves | Costs |
|---|---|---|---|
| **A** | Control: text tools in the card's toolbar, the timeline's in a band under it | — | — |
| **B** | Its tools in the card's toolbar, as the map's are (the best instance: the map shares its view code): add, *By date · In order · Manuscript*, undo/redo, zoom, lens, inspector. The band goes | §6, one toolbar and one rule; every view's tools in one place | A `timeline` context in `chromeLayout.ts` and its items, so it can be customised like the others. The prototype portals a fixed set |
| **C** | The band goes and its tools float in a `FloatingToolbar` at the top of the timeline; the card's toolbar keeps only its sidebar buttons | §9's floating tool strip; the timeline's tools stay with the timeline | A third place for a view's tools (card's toolbar, floating strip, the map's in-card inspector). Keeps the band's room |

## 2. The card toolbar's buttons

Every toolbar draws 16px icons on 26×22 buttons. §7 says controls don't go below 26; §8
says icons are 20px in primary toolbars and 16px in dense ones, and doesn't say which the
card's toolbar is. Applies to the document, canvas, map and Typeset toolbars alike.

| Option | What it is | Serves | Costs |
|---|---|---|---|
| **A** | Control: 16px on 26×22 | — | Below §7's floor |
| **B** | 16px on 26×26 (`--size-capsule`), the table toolbar's buttons. §8 names the card's toolbar a dense toolbar | §7's floor; §8's rule made explicit | The row's look barely moves; hover fills grow 4px taller |
| **C** | 20px on 28×28 (`--size-circle`): the card's toolbar is a primary toolbar | §8 as written; easier targets | Fewer items fit before » (about one fewer at 1400px). Menus (Body, Literata, 18) stay as they are |

## 3. Capsules: height, inset and layer

One surface (`.floating-capsule`) at four heights: the word count, page count, locked
badge and tab bar are 28, the timer 34, the table toolbar 36. Insets of 0/10px, 3px, 2px
and 4px, and four layers: 5, `--z-panel`, `--z-chrome`, `--z-popover`. (The find bar is
decision 4.)

| Option | What it is | Serves | Costs |
|---|---|---|---|
| **A** | Control | — | — |
| **B** | Two heights, from the best of each kind: a **readout** is the word count's 28 (`--size-circle`, level with the file tree's foot); a **strip of buttons** is the table toolbar's 36 (`--size-toolbar`, 26px buttons in a `--space-1` inset). The 10px gaps and insets go to `--space-3`. Every capsule on `--z-chrome` | §7's tokens; readouts and tools told apart by size | The timer grows 2px. The tab bar keeps its 2px inset (its tabs fill it, as a segmented control's do) |
| **C** | One height for every capsule, `--control-h` (32). Strips keep 26px buttons in a 2px inset; the foot row drops 2px so its middle stays level with the file tree's + and search. All on `--z-chrome` | One shape for everything over the page | Readouts grow 4px, the table toolbar shrinks 4px. The tab bar's tabs grow to 22px |

## 4. The find bar

⌘F floats a card at the top right of the document, under the rule: the menu surface
(`--menu-bg`, `--shadow-float`), 38px, a column that grows a replace row. It is the one
strip over the page that isn't a `.floating-capsule`, so it gets no glass on iOS.

| Option | What it is | Serves | Costs |
|---|---|---|---|
| **A** | Control: a floating card | — | — |
| **B** | A floating strip: the capsule surface and the table toolbar's anatomy (36px, `--space-1` inset, 26px field and buttons), same place. Replace still opens under it | §9, a floating tool strip; glass on iOS (§12) | Small: classes and sizes |
| **C** | In the card's toolbar: while find is open it *is* the toolbar (the field, "1 of 8", previous, next, close), and replace opens beside the field, as Safari's and Dia's address bars become a find field | §6, the toolbar as Dia's address bar; nothing floats over the text you're searching | The tools are away while finding (Escape brings them back). A narrow card fits find and replace tightly |

---

## Noticed, not decisions

- **The timer is centred on the window, not the card** (`position: fixed; left: 50%`), so
  with the sidebars docked it sits 40px right of the card's middle. It reads as a bug;
  say if you want it centred on the card in the apply.
- **On iPad with both sidebars docked, the zoom capsule covers the page count**
  (`editor-page-view-*-ipad`). A layout bug for round 04 or a fix on its own.
- **The timeline's floating "Story" inspector** (its own close, raw select and checkbox)
  is a panel. It belongs to round 04 (panels), with the map's.
- **The locked badge's Unlock** is 20px tall and the **tabs** 20px, under §7's floor of
  26. Options B and C of 3 don't fix them; say if you want that in the apply.

---

## Recommendation

This is my reading of the evidence. Every decision is yours.

1. **B.** It's the audit's clearest drift: tools that do nothing over a timeline, and a
   second rule. B makes the timeline work like the canvas, map and Typeset. C adds a third
   place for a view's tools.
2. **B.** It keeps the toolbar quiet on the paper and brings the buttons up to §7's
   floor. Writing "dense" into §8 closes the gap without a visible change at rest. C
   is right by §8's letter, but it's heavier, and more items go behind ».
3. **B.** Size tells a readout from a strip of tools. The word count stays level with the
   file tree's foot. Only the timer really moves. C buys one height at the cost of
   moving everything.
4. **B.** It's the same strip as the table toolbar, and it gets glass on iOS, with no
   change in behaviour. C is the bolder idea, and the right one if you want the
   toolbar to act as Dia's address bar does. The cost is that the tools go away while
   you find.

Mixed, as a link: `?mock&variant=toolbars:1B,2B,3B,4B`.

## Picks

Picked by the design lead on 2026-10-22:

| Decision | Pick |
|---|---|
| 1. The timeline's tools | **B**: in the card's toolbar, as a `timeline` context; the band goes |
| 2. The card toolbar's buttons | **B**: 16px icons on 26×26 buttons; DESIGN.md names it a dense toolbar |
| 3. Capsules | **B**: readouts 28, strips of buttons 36, all on `--z-chrome` |
| 4. The find bar | **C**: in the card's toolbar while find is open; replace opens beside it |

All four together: `?mock&variant=toolbars:1B,2B,3B,4C`.

The noticed items (the timer's centring, the 20px Unlock and tabs) aren't part of these
picks and stay out of the apply unless the design lead adds them.

## Applied

Applied on `design/round-03-toolbars`, 2026-10-22. The prototype is gone, and no family
is left behind the variant switch.

- **1B:** a `timeline` toolbar context (`chromeLayout.ts`), with its items in
  `toolbar/items/timelineItems.jsx`: Add event, Show as, Undo/Redo, Zoom, Time lens and
  Inspector by default, and Delete in Customize toolbar. The active timeline publishes
  `timelineChromeChanged` and takes `timelineCommand`s back by surface id, as a map does.
  The bridge type gained `inspectorOpen` (Rust, regenerated TS), so the Inspector button
  shows when it's on. `TimelineToolbar.jsx` and its band are gone. Show as is the shared
  `Segmented`, as the board showed.
- **2B:** the toolbar's buttons are `--size-capsule` square (`Toolbar.css`, the one
  rule for every toolbar group). DESIGN.md §6 and §8 name the card's toolbar dense.
- **3B:** readouts at `--size-circle` and strips at `--size-toolbar`, all on
  `--z-chrome`. The word count and the zoom bar's 10px insets and gap go to
  `--space-3`. The timer is 36 with a `--space-1` inset.
- **4C:** the find bar renders in the toolbar's slot (`EditorLayout.jsx`). While it's
  open, `:has()` hides the toolbar's items, which stay mounted. Replace opens beside the
  field.

Recaptured against round 02b's head (`r02b-applied`): 314 of 360 screenshots changed.
I checked each one for where it differs, and every change is in a place a pick explains:

- **194 change only in the foot row.** The word count's inset and position moved 2px
  (3B), and it shows in almost every window.
- **30 change only in the toolbar row.** The buttons are 4px taller, which shows in their
  "on" fills (2B).
- **The rest also change in the middle of the window:**
  - the timeline (1B) and find (4C);
  - the » list and the Customize toolbar palette, whose items are drawn with the
    toolbar's buttons (2B);
  - the menus and pop-ups anchored to a toolbar button (Typeset Insert, Card colour,
    read aloud), which sit 2px lower under the taller buttons (2B).
- **One stray:** a 3×3px antialiasing difference on a corner of iPad Go to page's Go
  button.

Spot-checked: the timer grew from 34 to 36, and the word count's inset went from 10 to 8.

Not in this round, as the picks said: the timer's centring, the 20px Unlock and tabs,
and the bubble editor's capsules (not in the audit's inventory).

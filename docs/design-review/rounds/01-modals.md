# Round 01: Modals

The first round of the design review (see [state.md](../state.md)). It covers the shell
and behaviour of everything that takes over the window until it's dismissed: `Sheet`,
`NavSheet` (Settings, Help) and `Dialog`. The evidence is in
[audit.md §1](../audit.md#1-modals).

- **Board:** `design-review/out/round-01/board.html`. It shows each decision's options
  on real modals, light over dark, with live links.
- **Branch:** `design/round-01-modals`. The options are real code in
  `src/dev/variants/modals.jsx`, behind `?variant=modals:…`, which only dev builds
  load. With no variant, the app renders pixel-identical to the control (all 348
  screenshots), and `?variant=modals:A` is identical to the control on every modal.
- **Live:** run `npx vite --port 5181` in the worktree, then open
  `http://localhost:5181/?mock&variant=modals:1B` (one decision) or
  `?mock&variant=modals:1B,2C,3B` (a mix).

**Held out of this round:** the command palette, which is likely a declared exception
(a launcher, not a form), and the map's setup chooser, which blocks its pane rather
than the window (the panels round).

Each decision is shown with the other five held at A.

---

## 1. Header anatomy

What sits at the top of a modal? Today every Sheet has a 15px title and nothing else.
Dialog has an eyebrow, a `--text-lg` (16px) title and a description, as DESIGN.md §9
describes.

| Option | What it is | Serves | Costs |
|---|---|---|---|
| **A** | Control: two anatomies | — | — |
| **B** | Dialog's header on every modal: `--text-lg` title, an eyebrow naming where the modal comes from, a description where there is one, Dialog's padding | §9's Dialog anatomy; §5's eyebrow as "a dialog's kicker" | An eyebrow per call site. Proposed: Book (Rename, Remove), Typeset (Page setup, Author details), Inspector, Toolbar, Files (Folder types), Timer, Map; none on New project, Settings or Help. 9 call sites |
| **C** | Title only, at `--text-lg`, on the sheet's tighter padding. No eyebrow anywhere (Export map loses "MAP"); a description stays | §1 "quiet studio"; the type scale | Dialog loses its eyebrow, so §9 changes. Smallest migration |

## 2. How you close it

Today only Dialog shows a ×. Settings and Help have no footer and no visible way out:
only Escape or a click on the scrim. DESIGN.md is silent.

| Option | What it is | Serves | Costs |
|---|---|---|---|
| **A** | Control | — | Settings and Help have no visible close |
| **B** | A × at the top right of every modal | One rule everywhere | Two ways out (× and Cancel) on the decision modals |
| **C** | A × only where the footer has no Cancel, Done or Close: Settings, Help, Folder types, Export map. One visible way out, never two | §10 "show only the essentials" | The primitive needs to know whether its footer closes. An explicit prop at apply time, not text matching |

## 3. Footer layout

Today Dialog packs its buttons to the trailing edge. Sheets pack them to the leading
edge unless the call site adds a spacer: New project, Rename and Remove sit left;
Author details, Page setup and the Customize sheets sit right.

| Option | What it is | Serves | Costs |
|---|---|---|---|
| **A** | Control | — | — |
| **B** | Actions at the trailing edge: Cancel, then the primary. A leading utility (Units, Restore…, Show) stays at the leading edge | §9 "secondary left, primary right", as Dialog does it | CSS in one place; the call sites' spacers can go |
| **C** | B, and in a small modal (460px or less) a two-button decision shares the width, as macOS alerts do | A clearer decision in small modals | A second footer layout to keep. Affects New project, Rename, Remove |

## 4. Layer, scrim and motion

Today Sheets sit at z 2000 (DESIGN.md §6: don't invent z-indexes), fade their scrim over
120ms and enter over 180ms. Dialog sits on `--z-dialog` and fades over 180ms. §7 gives
sheets `--dur-slow` (240ms). Nothing animates out.

| Option | What it is | Serves | Costs |
|---|---|---|---|
| **A** | Control | — | — |
| **B** | Dialog's everywhere: `--z-dialog`, the scrim over `--dur-base`, `ib-dialog-in` over `--dur-base`. Exits stay instant. Customize toolbar keeps its drop from the toolbar | §6 layers | A Menu or Popover opened from inside a modal would then sit under it (`--z-popover` 60 < `--z-dialog` 80). None does today (SelectMenu is native); the pop-ups round must keep it so, or portal into the modal |
| **C** | B, with §7's timing: modals 520px and wider enter over `--dur-slow`, and every modal leaves the way it came over `--dur-fast`, easing in. Reduced motion stills it all | §7 durations; "motion explains where something came from" | Exit motion needs the primitive to outlive its caller's unmount. The prototype clones the modal as it unmounts. At apply time this should be a small `useExit` in `src/ui` |

At rest, the three look identical: same scrim colour, same surface.

## 5. Focus and the app behind

Today Sheets focus their first control and trap Tab, but leave the app behind live to
assistive tech. Dialog traps Tab and makes the app inert. Customize toolbar takes no
focus, so Tab walks out into the page.

| Option | What it is | Serves | Costs |
|---|---|---|---|
| **A** | Control | — | Customize toolbar's focus stays broken |
| **B** | Dialog's behaviour everywhere: focus the first control, trap Tab (`useFocusTrap`), the app behind inert. Customize toolbar is exempt from inertness, since its toolbar must stay live to drag into | §13 "dialogs trap focus"; §9 "use the hooks" | Fixes Customize toolbar (focus lands on Show, Tab stays in) |
| **C** | B, with one first-focus rule: the first text field; else Cancel beside a destructive action; else the primary action; else the modal itself. Never the × | Predictable first focus | Measured trade-offs: Export map would focus Save PNG…, so Enter exports at once. Settings and Folder types focus the sheet itself rather than a control. Customize inspector skips its list for Done |

Where focus goes on close doesn't change. Modals opened from a native menu (Rename,
Remove, Author details) return it to the page in every option, because a native menu
leaves nothing in the page to return to.

## 6. Widths

Today there are ten widths: 340, 380, 400, 420, 440, 520, 560, 600, 640 and 720.
DESIGN.md has no size scale.

| Option | What it is | Serves | Costs |
|---|---|---|---|
| **A** | Control | — | — |
| **B** | Two sizes: 460 (Dialog's default) for decisions and short forms, 720 (Help's) for anything with a list or a nav | Fewest sizes | Folder types and Customize inspector jump to 720; Rename and Remove grow to 460 |
| **C** | Three sizes: small 400 (New project, Rename, Remove, Author details, Timer), medium 560 (Page setup, Folder types, Customize inspector, Export map), large 720 (Settings, Help, Customize toolbar) | A size per kind of content | A `size` prop instead of `width`. On iPad (820px) the large size leaves 50px either side |

---

## Recommendation

This is my reading of the evidence. Every decision is yours.

1. **B.** It's already what DESIGN.md §9 describes. The eyebrow says where a modal came
   from (a Rename from the Book, Author details from Typeset). It's the one brand detail
   a modal carries.
2. **C.** One visible way out per modal, and Settings and Help finally get one.
3. **B.** It's the documented rule, at no new cost. C adds a layout to maintain.
4. **C.** §7 already asks for it, and a modal that vanishes instantly is the one motion
   gap in the family. If the exit's implementation cost worries you, B now and C later
   is safe.
5. **B.** It fixes Customize toolbar and the inertness gap without C's surprises
   (Enter exporting a map).
6. **C.** Three sizes fit the three kinds of content. B widens the small decisions and
   stretches Folder types and Customize inspector to 720.

Mixed, as a link: `?mock&variant=modals:1B,2C,3B,4C,5B,6C`.

## Picks

Picked by the design lead on 2026-10-20:

| Decision | Pick |
|---|---|
| 1. Header anatomy | **B**: Dialog's header everywhere, with eyebrows |
| 2. How you close it | **C**: a × only where the footer has no way out |
| 3. Footer layout | **C**: actions at the trailing edge; a two-button decision in a small modal shares the width |
| 4. Layer, scrim and motion | **C**: `--z-dialog`, large modals enter over `--dur-slow`, every modal leaves |
| 5. Focus and the app behind | **B**: `useFocusTrap` and an inert app everywhere (Customize toolbar exempt from inertness) |
| 6. Widths | **C**: three sizes, 400 / 560 / 720 |

All six together: `?mock&variant=modals:1B,2C,3C,4C,5B,6C`
(`design-review/out/round-01/picks/`).

## Applied

Applied on `design/round-01-modals`, 2026-10-20. `Sheet` is gone; `Dialog` is the one
modal and NavSheet a large Dialog (DESIGN.md §9 → *Dialogs*).

Recaptured against the control: 76 of 348 screenshots changed, exactly the 19 modal
surfaces × 2 themes × 2 sizes, and nothing else. Against the capture of the picks
together, 18 of 22 were pixel-identical. The design lead settled the rest on 2026-10-20:

1. **3C's scope: every small two-button footer.** Not only decisions: Author details and
   Timer complete split their buttons too. This is CSS on the footer, with no prop.
   Author details changed again (0.2–0.3% of its screenshots); Timer complete can't be
   reached through the mock.
2. **Body and footer spacing: the Sheet's.** Sheet and Dialog spaced them differently,
   and no pick covered it. The one Dialog keeps the Sheet's (8px under the body, 16px
   under the footer), which changes only Export map (Dialog had 24 and 24).
3. **First focus is never the ×.** With 2C's × in the header, the prototype focused it
   first in Help (so the filter lost focus). The Dialog follows 5B's "focus the first
   control" and skips the ×, so Help focuses its filter, as it does today.
4. **Export map is 560 wide.** The prototype mis-sized it to 720 (its width was a CSS
   string, which the prototype's size logic didn't parse), though 6C's text placed it
   at medium. The applied build follows the text.

The reasons for the picks weren't given; decisions.md says so.

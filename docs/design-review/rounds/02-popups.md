# Round 02: Pop-ups

The second round of the design review (see [state.md](../state.md)). It covers the
shell and behaviour of everything anchored to a control that floats until it's
dismissed: `Popover`, `Menu`, and five pop-ups that build their own. The evidence is in
[audit.md §2](../audit.md#2-pop-ups-popovers-and-menus).

- **Board:** `design-review/out/round-02/board.html`. It shows each decision's options
  on real pop-ups, light over dark, with live links.
- **Branch:** `design/round-02-popups`, stacked on round 01's branch (PR #79 isn't
  merged yet). The baseline is round 01's head, `0b1af66`, captured as run `r01`.
- **Prototype:** `src/dev/variants/popups.jsx`, behind `?variant=popups:…`, which only
  dev builds load. With no variant, the app renders pixel-identical to the baseline,
  and `?variant=popups:A` is identical too.
- **Live:** run `npx vite --port 5181` in the worktree, then open
  `http://localhost:5181/?mock&variant=popups:1B` (one decision) or
  `?mock&variant=popups:1B,2C,3C` (a mix).

- **Measured:** `measure.json` in each run (`r02-default`, `r02-1B` … `r02-4C`), and
  film strips of the motion in `design-review/out/round-02/strips/`.

**This round is split.** Pop-ups need eight decisions, so this round takes the five
about the shell and its behaviour. **Round 02b (menus)** takes the other three: which
menus are native (Alignment, Insert and New… are OS menus; the table's and the panels'
are in-page), whether the toolbar's » is a strip of icons or a menu with labels, and the
command palette (which round 01 left as an exception to review).

**Held out of this round:**

- **The project search** (the sidebar's and ⇧⌘F's). It's a veiled card over the page
  (DESIGN.md §12), with its own motion, rather than a pop-up anchored to a control.
- **A pop-up opened inside a dialog.** None exists today: the selects in dialogs are
  native. On `--z-popover` one would sit under its dialog (`--z-dialog`). Whichever
  option you pick for decision 1, apply will make Popover and Menu render into the
  dialog they're opened from, so they're never hidden. That's plumbing with no visible
  change. Say if you'd rather forbid them instead.

Each decision is shown with the others held at A, except decision 5, which is shown
on top of 4B (otherwise read aloud, the one pop-up with a title, wouldn't change).

---

## 1. Surface and layer

What is a pop-up drawn on? `Popover` uses `.ui-popover` from `ui.css`: z 2100 (an
invented z-index; DESIGN.md §6 says not to), a 1px edge, and a hard-coded
`13px/1.35` font. The call sites then add their own padding: the » strip 6px, Go to page
6px, Cell fill and Card colour 8px, Print options and Print sides 12px (6px from the
surface, 6px from their body). `Menu` and the palette use `.ib-menu` from `Popover.css`,
on `--z-popover` with a hairline edge. `Popover.css` also has an `.ib-popover` rule that
nothing uses. The paint is the same in all of them: `--menu-bg`, `--radius-lg`,
`--shadow-float`.

| Option | What it is | Serves | Costs |
|---|---|---|---|
| **A** | Control | — | — |
| **B** | The `.ib-popover` rule already in `Popover.css`: `--z-popover`, the hairline edge, the type tokens, 12px (`--space-4`) of padding owned by the surface. The call sites' own padding goes | §6 layers; §9 "same surface as a menu"; one stylesheet | One CSS rule and six call sites lose a padding rule. `ui.css`'s `.ui-popover` goes |
| **C** | B, with 8px (`--space-3`) of padding: the same padding a menu's items sit in, so a picker of swatches is as compact as a menu | B's, and density (§7: "comfortable", not loose) | As B |

## 2. Motion

`Menu` floats in over `--dur-fast` (120ms). `Popover` doesn't animate. Read aloud pops in
over a raw `180ms ease-out`. Nothing animates out. DESIGN.md §7 gives popovers
`--dur-base` (180ms), and since round 01, dialogs leave the way they came.

| Option | What it is | Serves | Costs |
|---|---|---|---|
| **A** | Control | — | — |
| **B** | A Menu's motion on every pop-up: `ib-float-in` over `--dur-fast`. Exits stay instant | One motion for the family | CSS only |
| **C** | §7's timing: popovers float in over `--dur-base`, menus over `--dur-fast`, and both leave the way they came over `--dur-fast`, easing in (`useExitAnimation`, as dialogs do since round 01). Reduced motion stills it all | §7 durations; "motion explains where something came from" | Popover and Menu split into an open and a closed part so the exit hook sees them unmount |

## 3. Focus and keys

A `Menu` moves focus to its first item, closes on Tab, and returns focus to its opener.
A `Popover` leaves focus where it was, so a keyboard user can't reach Cell fill's
swatches or Print options' fields without tabbing through the page, and Tab walks
straight past it. Go to page focuses its field (by `autoFocus`) but hands focus to the
page on close. DESIGN.md §13 is silent on pop-ups.

| Option | What it is | Serves | Costs |
|---|---|---|---|
| **A** | Control | — | — |
| **B** | A Menu's behaviour on every Popover: focus the first control inside, Tab closes it, focus goes back to the opener | §13 "every action is reachable by keyboard"; one rule with Menu | A form in a popover (Go to page, Print options) can't Tab between its fields: Tab closes it |
| **C** | A Dialog's, without the scrim: focus the first control inside, Tab and ⇧Tab cycle inside, Escape or a click outside closes it, focus goes back to the opener. Menus keep their own keys (arrows, Tab closes) | §13; forms in popovers work by keyboard | The page behind stays live (no inert), as it should for a pop-up |

## 4. The bespoke pop-ups

Five pop-ups build their own shell. Each sets its own padding (10px, 12px), z-index
(read aloud 90, which is `--z-toast`; footnote and citation 1000; the e-book Reader 5;
Typeset's page pickers 4) and font (the citation editor uses `-apple-system`). Their
insides use bare buttons and fields: the footnote's "Delete Note" in title case, read
aloud's capitalised READ button and native select, the Reader's bare checkbox. Read
aloud doesn't close on Escape or a click outside.

| Option | What it is | Serves | Costs |
|---|---|---|---|
| **A** | Control | — | — |
| **B** | Their shells on `Popover`: the surface, layer, motion and keys you pick in 1–3. Their insides stay as they are. The Reader's `<details>` becomes a button that opens a Popover | §9 "don't write one-off menus"; one place for behaviour | Five call sites. The footnote and Typeset's pickers anchor to a place in the text, so `Popover` takes a rect as well as an element. The citation editor is plain DOM and takes the surface's classes |
| **C** | B, and their insides on `src/ui`: read aloud's `SelectMenu`, `Field`, hint and `filled` Read button (its live waveform stays, as its signature); the footnote's `TextArea`, a `destructive` "Delete note" and a `filled` Done with its ⌘↩ shown; the Reader's rows as `FormRow`s with a `Toggle`. Typeset's page pickers keep their insides (they're page-design tools, for the panels round) | §9; §11 sentence case; the guardrails | Larger: three sets of insides rewritten. Read aloud's status box becomes a quiet hint |

Two of the five can't be screenshotted through the mock: Typeset's page pickers and the
citation editor (see `surfaces.json` → `unreachable`). Both are prototyped.

## 5. A pop-up's title

Does a pop-up say what it is? Read aloud has an accent-coloured "READ ALOUD" over its
voice. Print options starts with a field labelled "Print", and the others have no title.
A Menu's groups have typewriter eyebrows (`MenuLabel`, "UNITS"). DESIGN.md is silent.

| Option | What it is | Serves | Costs |
|---|---|---|---|
| **A** | Control: read aloud's title only | — | — |
| **B** | No titles: the control that opened a pop-up names it. Read aloud's title goes and its voice line stays | §10 "show only the essentials" | Read aloud loses its name |
| **C** | An eyebrow (`.ib-eyebrow`, as dialogs and panels have) over every pop-up of more than one control: Read aloud, Footnote, Cell fill, Card colour, Print options, Print sides, Reader, and Typeset's pickers ("Chapter number", "Running head"). Not Go to page (one line) or the » strip | The eyebrow as the family's kicker (§5, round 01's 1B) | Taller pop-ups. Read aloud's title becomes muted rather than accent-coloured |

---

## Recommendation

This is my reading of the evidence. Every decision is yours.

1. **B.** It's the rule `Popover.css` already has for this. 12px is what Print options
   and Print sides have today, and a form needs that room more than a picker needs
   compactness. One rule for every pop-up, on the documented layer.
2. **C.** §7 already says popovers take `--dur-base`, and since round 01 dialogs leave
   the way they came. A pop-up that vanishes would be the family's one gap.
3. **C.** Go to page and Print options are forms. Under B, Tab closes them before you
   reach the Go or Print… button. Measured under C, focus lands inside every popover,
   Tab stays inside, and Escape returns focus to the control that opened it (today Go
   to page drops it on the page).
4. **C.** B fixes the shells, but leaves a capitalised READ, title-case "Delete Note"
   and bare controls behind, so §9 and §11 would still be broken inside. If C's size
   worries you, B now and C later is safe.
5. **C.** Most pop-ups open from an icon (the paint bucket, the speaker, »), so the
   eyebrow names what the icon only implies. It's the same kicker dialogs and panels
   carry. B is the quieter choice if you'd rather the opener speak for itself.

Mixed, as a link: `?mock&variant=popups:1B,2C,3C,4C,5C`.

## Noticed while measuring (not decisions)

- **Dialog's focus trap counts roving items.** `useFocusTrap` treats every button in a
  roving group (InkPicker's swatches) as a Tab stop, so if the active swatch isn't the
  last one, Tab can walk out of a dialog. The 3C prototype counts only what Tab reaches
  (`tabIndex >= 0`). Whichever 3 you pick, the same fix belongs in `useFocusTrap`.
- **Read aloud lives inside the » strip.** A click inside its pop-up closes » (the
  click is outside »), which unmounts read aloud. That's the same today. It's for
  round 02b, with the » decision.

## Picks

Picked by the design lead on 2026-10-21:

| Decision | Pick |
|---|---|
| 1. Surface and layer | **B**: `.ib-popover` on `--z-popover`, hairline edge, 12px owned by the surface |
| 2. Motion | **C**: popovers in over `--dur-base`, menus over `--dur-fast`; both leave the way they came |
| 3. Focus and keys | **C**: focus the first control, Tab cycles inside, focus back to the opener |
| 4. The bespoke pop-ups | **C**: their shells on Popover and their insides on `src/ui` |
| 5. A pop-up's title | **C**: an eyebrow over every pop-up of more than one control |

All five together: `?mock&variant=popups:1B,2C,3C,4C,5C`.

## Applied

Applied on `design/round-02-popups`, 2026-10-21. `Popover` is the one pop-up shell and
`.ui-popover` is gone (DESIGN.md §9 → *Pop-ups*).

- **1B:** `.ib-popover` on `--z-popover`, a hairline edge and 12px owned by the surface.
  Five call sites lost their own padding.
- **2C:** popovers float in over `--dur-base`, menus over `--dur-fast`, and both leave
  through `useExitAnimation`. The citation editor (plain DOM) plays the same exit.
- **3C:** focus goes to the first control, Tab stays inside, and Escape returns focus to
  the opener. `trapTab` in `src/ui/hooks.js` is now the one Tab trap, for dialogs too. It
  counts a roving group as one stop, which fixes Tab escaping a dialog through an
  InkPicker (noted above).
- **4C:** read aloud, the footnote editor, the e-book Reader and Typeset's page pickers
  are Popovers, and the citation editor wears the same classes. Their insides are on
  `src/ui`, except Typeset's pickers, as the option said. Read aloud keeps its waveform.
- **5C:** eyebrows on Read aloud, Footnote, Cell fill, Card colour, Print options, Print
  sides, Reader, Citation and Typeset's pickers.
- **A pop-up inside a dialog** renders in the dialog's layer (`src/ui/layer.js`), and
  Escape closes it before the dialog, as the round said it would.

Recaptured against round 01's head (`r01`): 42 of 348 screenshots changed, and every one
is a pop-up this round changed. Cell fill, Card colour, Print options, Go to page, »,
read aloud, the footnote editor and the e-book bar's Reader button (now with a chevron)
all changed. Three editor surfaces (the table, Alignment and a conversation) leave » open
in their shot, so they show »'s new padding. Nothing outside a pop-up changed. The new
`typeset-reader` surface has no counterpart in `r01`.

Two corrections, against the board:

1. **The board's 4C Reader was broken.** The prototype passed the shared `Segmented` its
   options in the wrong shape, so the board showed the labels with no controls. The
   applied Reader follows the option's text: `FormRow`s with a `Toggle` and three
   `Segmented`s.
2. **The footnote focused its field twice.** Its own focus ran before the Popover was
   placed, which moved the editor's selection (the toolbar read "Heading 1"). Popover
   owns first focus now, and the footnote's shot matches `r01` outside the pop-up.

Measured (`r02-applied/measure.json`): all eight popovers are on `--z-popover` at 12px,
float in over `--dur-base`, animate out, take focus, keep Tab inside and hand focus back
to the opener (the footnote to the text). Reduced motion stills every one. Read aloud
hands focus to », because Escape also closes the » strip it lives in (round 02b).

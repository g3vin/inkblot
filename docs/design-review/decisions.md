# Design review — decisions

One entry per decision the design lead has picked, appended when a round is applied
(`/design-review apply`). Read this before proposing anything: a decided question is
not asked again.

Each entry: id, family, the options considered, the pick, the reason in the design
lead's words, the date, and the commit sha.

## Round 01: Modals (family: modals)

### 01.1 Header anatomy

- **Options:** A control (Sheets: 15px title only; Dialog: eyebrow, title, description) · B Dialog's header everywhere, with eyebrows · C title only at --text-lg, no eyebrows
- **Pick:** B
- **Reason:** not given
- **Date:** 2026-10-20
- **Commit:** `8eada1e` on `design/round-01-modals`

### 01.2 How you close it

- **Options:** A control (× on Dialog only) · B × on every modal · C × only where the footer has no way out
- **Pick:** C
- **Reason:** not given
- **Date:** 2026-10-20
- **Commit:** `8eada1e` on `design/round-01-modals`

### 01.3 Footer layout

- **Options:** A control (left on three sheets, right on the rest) · B actions at the trailing edge · C B, and a small two-button decision shares the width
- **Pick:** C, for every small dialog whose footer is two buttons (confirmed after apply: not decisions only)
- **Reason:** not given
- **Date:** 2026-10-20
- **Commit:** `8eada1e` on `design/round-01-modals`

### 01.4 Layer, scrim and motion

- **Options:** A control (z 2000 vs --z-dialog; exits instant) · B Dialog's layer and timing everywhere · C B with §7's timing and an exit
- **Pick:** C
- **Reason:** not given
- **Date:** 2026-10-20
- **Commit:** `8eada1e` on `design/round-01-modals`

### 01.5 Focus and the app behind

- **Options:** A control · B Dialog's trap and an inert app everywhere (Customize toolbar exempt) · C B with one first-focus rule
- **Pick:** B; first focus is never the × (confirmed after apply)
- **Reason:** not given
- **Date:** 2026-10-20
- **Commit:** `8eada1e` on `design/round-01-modals`

### 01.6 Widths

- **Options:** A control (ten widths) · B two sizes, 460/720 · C three sizes, 400/560/720
- **Pick:** C
- **Reason:** not given
- **Date:** 2026-10-20
- **Commit:** `8eada1e` on `design/round-01-modals`

## Round 02: Pop-ups (family: pop-ups)

### 02.1 Surface and layer

- **Options:** A control (`.ui-popover`, z 2100, call sites' own padding) · B `.ib-popover` on `--z-popover`, 12px owned by the surface · C B at 8px
- **Pick:** B
- **Reason:** not given
- **Date:** 2026-10-21
- **Commit:** `d54b327` on `design/round-02-popups`

### 02.2 Motion

- **Options:** A control (only menus animate; nothing leaves) · B a menu's float-in everywhere over `--dur-fast` · C popovers over `--dur-base`, menus over `--dur-fast`, and both leave the way they came
- **Pick:** C
- **Reason:** not given
- **Date:** 2026-10-21
- **Commit:** `d54b327` on `design/round-02-popups`

### 02.3 Focus and keys

- **Options:** A control (a popover leaves focus where it was) · B a menu's: focus in, Tab closes, back to the opener · C a dialog's without the scrim: focus in, Tab stays inside, back to the opener
- **Pick:** C
- **Reason:** not given
- **Date:** 2026-10-21
- **Commit:** `d54b327` on `design/round-02-popups`

### 02.4 The bespoke pop-ups

- **Options:** A control · B their shells on Popover · C B, and their insides on `src/ui` (Typeset's page pickers keep theirs)
- **Pick:** C (the board's Reader shot for C was broken; applied per the option's text)
- **Reason:** not given
- **Date:** 2026-10-21
- **Commit:** `d54b327` on `design/round-02-popups`

### 02.5 A pop-up's title

- **Options:** A control (read aloud's title only) · B no titles · C an eyebrow over every pop-up of more than one control
- **Pick:** C
- **Reason:** not given
- **Date:** 2026-10-21
- **Commit:** `d54b327` on `design/round-02-popups`

## Round 02b: Menus ([02b-menus.md](rounds/02b-menus.md))

### 02b.1 Native or in-page menus

- **Options:** A control (mixed) · B right-click menus native, every menu a button opens an in-page `Menu` · C every menu native
- **Pick:** B
- **Reason:** not given
- **Date:** 2026-10-21
- **Commit:** `0e717c3` on `design/round-02b-menus`

### 02b.2 The » strip

- **Options:** A control (a strip of icons) · B a labelled list · C tiles, three across
- **Pick:** B
- **Reason:** not given
- **Date:** 2026-10-21
- **Commit:** `0e717c3` on `design/round-02b-menus`

### 02b.3 A pop-up opened from a pop-up

- **Options:** A control (a click inside closes both) · B they stack · C the inner one takes the outer's place · D the outer becomes the inner: its button stays pressed, the others go, the pop-up grows; that button again goes back
- **Pick:** D, the design lead's own proposal, confirmed after it was prototyped
- **Reason:** not given
- **Date:** 2026-10-21
- **Commit:** `0e717c3` on `design/round-02b-menus`

### 02b.4 The command palette

- **Options:** A control (its own scrim and motion) · B a Dialog's scrim and behaviour · C no scrim, a launcher on the pop-up layer
- **Pick:** B
- **Reason:** not given
- **Date:** 2026-10-21
- **Commit:** `0e717c3` on `design/round-02b-menus`

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

# Round 03b: The dynamic toolbar

Asked for by the design lead on 2026-10-22, while round 03 was being applied:

> I also really don't like the "more" button in the toolbar, it doesn't match the style
> of all the other icons. Also, i think i want all toolbar pop-ups to be like the new
> find in document thing which appears in the toolbar. Basically we're creating a
> dynamic toolbar. Not everything necessarily needs to take up the entire toolbar, but
> all settings/configs for the button that are there already should be there.

This round turns that into decisions. It reopens two picks from round 02b: 02b.2 (» as
a labelled list) and 02b.3 (a pop-up opened inside a pop-up), through decision 4.

- **Board:** `design-review/out/round-03b/board.html`, light over dark, with live links.
- **Branch:** `design/round-03b-dynamic-toolbar`, stacked on round 03 (PRs #79, #80,
  #84 and #86 aren't merged yet). The baseline is round 03's head, `5e454af`: the
  capture `r03-applied`, plus `r03b-A` for the two surfaces this round adds (Typeset's
  toolbar Export menu, the map's Zoom menu).
- **Prototype:** `src/dev/variants/dockFamily.js`, `Docked.jsx` and `dock.css`, behind
  `?variant=dock:…`, which only dev builds load. `Popover`, `MenuButton` and
  `ToolbarHost` read it behind `import.meta.env.DEV`. With no variant, the app renders
  pixel-identical to the baseline (52 of 52).
- **Live:** run `npx vite --port 5181` in the worktree, then open
  `http://localhost:5181/?mock&variant=dock:1B,2D,3B,4B`.

**What the card's toolbar opens today:**
- **Pop-ups:** », read aloud and Card colour.
- **In-page menus:** Alignment; Typeset's Edition, Insert, Zoom and Export; the map's
  Zoom and View; the canvas's Zoom.
- **The system's own pickers:** Font, Size and Paragraph style are native lists, and Text
  colour and Highlight open the OS colour panel. These aren't in this round; see the
  end of this file.

Decisions 2–4 depend on each other: a menu can only open in the toolbar if menus become
rows. Each says what the others are held at on the board.

---

## 1. The » glyph

» is a typed character at 600 weight on a 28px button, with a smaller radius and its own
colours. Every other button in the row is a Phosphor Light icon on a 26px button.

| Option | What it is | Serves | Costs |
|---|---|---|---|
| **A** | Control: the typed character | — | — |
| **B** | `more` (⋯), as a toolbar button | §8, one meaning, one glyph: every other More is ⋯ | »'s "what didn't fit" and a panel's "rarer options" become one glyph |
| **C** | » drawn from the icon set (Phosphor CaretDoubleRight, Light), as a toolbar button | Keeps the » meaning, in the toolbar's style | A new icon name (`overflow`) |

## 2. How a toolbar pop-up opens

Today a pop-up floats under its button and a menu drops below it. Find (03.4) takes the
toolbar.

| Option | What it is | Serves | Costs |
|---|---|---|---|
| **A** | Control: below the button | — | — |
| **B** | It takes the toolbar, as find does: its title (the eyebrow), its controls in a row, and close. Escape or close brings the tools back | One way, find's | A swatch row or a three-item menu hides the whole toolbar |
| **C** | In place: it opens beside its button, which stays pressed, pushing what follows along and behind ». If it doesn't fit, it takes the toolbar | The toolbar around it stays in view | The row reflows while it's open. Long menus (Export) never fit, so they take the toolbar anyway |
| **D** | By kind: a **form** (a field to fill in: read aloud's voice) takes the toolbar; a **choice** (swatches, a menu's items) opens in place, or takes the toolbar if it doesn't fit | Your note: not everything needs the whole toolbar; a form needs the room | Two behaviours to learn, but each follows from what's in the pop-up |

In every option, the pop-up keeps every setting it has today. Focus goes to its first
control and back to the button; Escape closes it.

A pop-up opened from a panel or the text (the footnote, Cell fill, a citation) still
floats. Only the card's toolbar is dynamic.

## 3. Menus from the toolbar

| Option | What it is | Serves | Costs |
|---|---|---|---|
| **A** | Control: a toolbar button's menu stays an in-page menu under it (02b.1) | — | Menus and pop-ups from the same toolbar behave differently |
| **B** | Its items become a row of buttons in the toolbar, groups apart, and the checked item is pressed. It opens as decision 2 says | "All toolbar pop-ups", as you asked; one toolbar behaviour | A submenu becomes a labelled group in the row. A long menu (Export, 7 items) needs the whole toolbar |

## 4. » in a dynamic toolbar

| Option | What it is | Serves | Costs |
|---|---|---|---|
| **A** | Control: the labelled list under » (02b.2B). An item's pop-up opens inside it (02b.3D) | — | A pop-up from the toolbar that doesn't open in the toolbar |
| **B** | The toolbar's second page: the row shows the items that didn't fit in place of those that did, with ‹ first to go back (or Escape). Their pop-ups open as decision 2 says | The toolbar is one place; nothing floats from it | Replaces 02b.2B and, for the toolbar, 02b.3D. Popover's opened-inside mechanism may have no user left; if so, the apply removes it |

---

## Recommendation

This is my reading of the evidence. Every decision is yours.

1. **B.** It's the toolbar's style, and it uses the glyph every other More already uses,
   with no new icon. C is right if you want » to keep meaning "what didn't fit".
2. **D.** It's what you described. Read aloud gets the whole row it needs. Swatches and
   short menus open beside their button, so the rest of the toolbar stays in view.
3. **B.** You asked for all toolbar pop-ups, and menus are most of them. A leaves the
   toolbar half dynamic.
4. **B.** A pop-up list from the toolbar is the one thing left floating otherwise. The
   second page keeps everything in the row.

Mixed, as a link: `?mock&variant=dock:1B,2D,3B,4B`.

---

## Not in this round

- **Font, Size and Paragraph style** are the system's own `<select>` lists. Font holds
  every installed font, which doesn't fit a row. Making them dynamic would mean
  in-page menus first. Say if you want that as its own round.
- **Text colour and Highlight** open the OS colour panel. That's against DESIGN.md §3
  ("anything a writer colours uses an ink id"). Moving them to an `InkPicker` changes
  what's stored in the document (an ink, not a hex colour), so it's a data change as
  well as a design one. I'd give it its own round.

## Picks

Picked by the design lead on 2026-10-22:

| Decision | Pick |
|---|---|
| 1. The » glyph | **C**: » drawn from the icon set (Phosphor CaretDoubleRight, Light), as a toolbar button |
| 2. How a toolbar pop-up opens | **D**: a form takes the toolbar; a choice opens in place, or takes the toolbar if it doesn't fit |
| 3. Menus from the toolbar | **B**: a toolbar button's menu opens as a row of its items |
| 4. » in a dynamic toolbar | **B**: the toolbar's second page, with ‹ to go back. Replaces 02b.2B and, for the toolbar, 02b.3D |

All four together: `?mock&variant=dock:1C,2D,3B,4B`.

## Applied

Applied on `design/round-03b-dynamic-toolbar`, 2026-10-22. The prototype is gone, and no
family is left behind the variant switch.

- **1C:** a new icon name, `overflow` (Phosphor CaretDoubleRight), drawn in » as a
  `--size-capsule` toolbar button. DESIGN.md §8's table gains the meaning.
- **2D:** `Popover` opens in the toolbar wherever a `ToolbarDockContext` (`layer.js`) holds
  its anchor; `ToolbarHost` provides one. A form (an `input`, `select` or `textarea`
  inside) takes the whole toolbar, with its eyebrow and a close button. Anything else
  opens in place, beside its item. It moves to the whole toolbar if the row pushes its item
  behind ». The button stays pressed while it's open.
- **3B:** `MenuButton` opens a `MenuRow` (`toolbar/MenuRow.jsx`) in a Popover: the menu's
  items as buttons, groups apart, ←/→ between them. It no longer calls `popUpMenu`.
- **4B:** » turns the row to its second page, with ‹ first (and Escape) to come back;
  focus follows the button that turns it back. The » list pop-up is gone. So is Popover's
  opened-inside mechanism (`PopoverNestContext`, `data-morphed`, `.ib-popover-slot`),
  which only » used.

Recaptured against round 03's head (`r03-applied`): 274 of 364 screenshots differ, and I
checked where each one does.

- **242 differ only in the toolbar row,** at »'s place. That's the new glyph (1C): 238 of
  them are under the comparison's noise floor.
- **The rest change in the middle of the window:**
  - Card colour and Typeset Insert open in the toolbar (2D, 3B).
  - The » shots (more toolbar items, Alignment, the table, a conversation, read aloud)
    now show the second page (4B). Alignment opens in place (3B) and read aloud takes the
    toolbar (2D).
  - The table's own Cell fill and More pop-ups change only in the toolbar row: their
    steps pass through », which is now on its second page.
- **Two, by a few dozen pixels:** iPad Go to page (»'s glyph and the corner antialiasing
  of round 03) and the iPad Earth map (»'s glyph and the globe's WebGL noise).

One regression was found and fixed before committing. On iPad with both sidebars docked,
the card's toolbar is 212px wide. Read aloud's row squeezed its voice field under the Read
button, and nothing could be reached. Now a docked form's controls keep their size and
the row scrolls, as the toolbar's own row does. Close stays in view. Under 480px the
eyebrow gives its room to the controls.

A docked pop-up has no exit motion: the toolbar comes back as it closes.
